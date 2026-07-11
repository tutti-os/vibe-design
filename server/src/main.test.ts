import { request as httpRequest, type Server } from 'node:http';
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER,
  type DetectContext,
  type ManagedAgentRunContext,
} from '@tutti-os/agent-acp-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, resolveRuntimeConfig } from './main';
import {
  createConversationInStore,
  getProjectFromStore,
  getStore,
  listProjectFilesFromStore,
  listPublicAssetsFromStore,
  upsertMessageInStore,
  upsertPreviewCommentInStore,
  upsertProjectFileInStore,
  writeProjectToStore,
} from './sqlite-store';
import type { ChatRun, ChatRunService } from './types/run';

let server: Server | undefined;
const tempRoots: string[] = [];
let runtimeDir: string | undefined;
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

type TestCreateServer = (options?: {
  runtimeDir?: string;
  builtInDesignSystemsRoot?: string;
  userDesignSystemsRoot?: string;
  detectAgentAvailability?: (context?: DetectContext) => Promise<Array<{
    id: string;
    label: string;
    available: boolean;
    unavailableReason?: string;
  }>>;
  detectAgentModelCatalog?: (context?: DetectContext) => Promise<Array<{
    id: string;
    label: string;
    models: Array<{ id: string; label: string; description?: string }>;
  }>>;
  installClaudeCode?: () => Promise<void>;
  openApp?: (input: { route: string; projectId?: string }) => Promise<void> | void;
  startAgentRun?: (input: {
    run: ChatRun;
    runs: ChatRunService;
    request: Record<string, unknown>;
    managedAgentRunContext?: ManagedAgentRunContext;
  }) => Promise<void> | void;
}) => Server;

function createTestServer(options?: Parameters<TestCreateServer>[0]): Server {
  return (createServer as TestCreateServer)({
    detectAgentAvailability: async () => [
      { id: 'codex', label: 'Codex', available: true },
      { id: 'claude', label: 'Claude Code', available: true },
    ],
    startAgentRun: () => {},
    ...options,
  });
}

async function createRuntimeDir(): Promise<string> {
  runtimeDir = await mkdtemp(join(tmpdir(), 'vibe-design-server-'));
  return runtimeDir;
}

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server?.listening) {
      server = undefined;
      resolve();
      return;
    }

    server.close((error) => {
      server = undefined;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));

  if (runtimeDir) {
    await rm(runtimeDir, { recursive: true, force: true });
    runtimeDir = undefined;
  }
});

function listenOnRandomPort(candidate: Server): Promise<number> {
  server = candidate;

  return new Promise((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(0, '127.0.0.1', () => {
      const address = candidate.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function projectRowExists(runtimeRoot: string, projectId: string): boolean {
  return Boolean(getProjectFromStore(join(runtimeRoot, 'projects'), projectId));
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibe-design-skills-api-'));
  tempRoots.push(root);
  return root;
}

async function writeDesignSystem(
  root: string,
  slug: string,
  input: {
    title?: string;
    category?: string;
    summary?: string;
    designBody?: string;
    tokensCss?: string;
    usageMd?: string;
    componentsHtml?: string;
    manifest?: Record<string, unknown>;
  },
): Promise<string> {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'DESIGN.md'),
    input.designBody ?? [
      `# ${input.title ?? slug}`,
      '',
      `> Category: ${input.category ?? 'Reference'}`,
      '',
      input.summary ?? 'A compact test design system.',
      '',
      '## Colors',
      '',
      '- Canvas: #f7f0e8',
      '- Ink: #111111',
    ].join('\n'),
    'utf8',
  );

  if (input.tokensCss !== undefined) {
    await writeFile(join(dir, 'tokens.css'), input.tokensCss, 'utf8');
  }
  if (input.usageMd !== undefined) {
    await writeFile(join(dir, 'USAGE.md'), input.usageMd, 'utf8');
  }
  if (input.componentsHtml !== undefined) {
    await writeFile(join(dir, 'components.html'), input.componentsHtml, 'utf8');
  }
  if (input.manifest !== undefined) {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(input.manifest, null, 2), 'utf8');
  }
  return dir;
}

async function writeSkill(
  root: string,
  slug: string,
  input: { name?: string; description?: string; body?: string; sourceMarker?: string },
): Promise<string> {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${JSON.stringify(input.name ?? slug)}`,
      `description: ${JSON.stringify(input.description ?? `${slug} description`)}`,
      'triggers:',
      `  - ${JSON.stringify(slug)}`,
      '---',
      input.body ?? `# ${slug}\n${input.sourceMarker ?? 'body'}`,
    ].join('\n'),
    'utf8',
  );
  return dir;
}

async function startSkillsApi(options?: { userRoot?: string; builtInRoot?: string }) {
  const userRoot = options?.userRoot ?? (await createTempRoot());
  const builtInRoot = options?.builtInRoot ?? (await createTempRoot());
  const port = await listenOnRandomPort(createServer({ userSkillsRoot: userRoot, builtInSkillsRoot: builtInRoot }));

  return {
    builtInRoot,
    port,
    userRoot,
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
  };
}

async function postCli(
  port: number,
  command: string,
  input: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}/tutti/cli/${command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function postCliStatus(port: number, command: string, input: Record<string, unknown> = {}): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/tutti/cli/${command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  await response.text();
  return response.status;
}

async function postJsonWithHeaders(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode ?? 0,
            body: text ? JSON.parse(text) as Record<string, unknown> : {},
          });
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function readInitialDataFromHtml(html: string): Record<string, unknown> {
  const match = /window\.__VIBE_DESIGN_INITIAL__=(.*?);<\/script>/s.exec(html);
  if (!match) {
    throw new Error('Missing Prototype Design initial data script.');
  }
  return JSON.parse(match[1] ?? '{}') as Record<string, unknown>;
}

describe('createServer', () => {
  it('resolves Tutti workspace app runtime configuration before standalone defaults', () => {
    const config = resolveRuntimeConfig({
      HOST: '0.0.0.0',
      TUTTI_APP_DATA_DIR: '/tmp/tutti-vibe-data',
      TUTTI_APP_HOST: '127.0.0.42',
      TUTTI_APP_PORT: '41234',
      PORT: '3001',
    });

    expect(config).toEqual({
      host: '127.0.0.42',
      port: 41234,
      runtimeDir: '/tmp/tutti-vibe-data',
    });
  });

  it('serves the Tutti app healthcheck endpoint', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);

    expect(response.status).toBe(204);
  });

  it('includes local agent availability in the project editor initial data', async () => {
    const runtimeRoot = await createRuntimeDir();
    writeProjectToStore(join(runtimeRoot, 'projects'), {
      id: 'project-agent-status',
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: {
        title: 'Agent status',
        prompt: 'Check local agents.',
        projectKind: 'prototype',
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentAvailability: async () => [
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
        ],
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/project/project-agent-status`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(readInitialDataFromHtml(html)).toMatchObject({
      projectEditor: {
        agentAvailability: [
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
        ],
      },
    });
  });

  it('passes the managed agent credential header to SSR availability detection without leaking it', async () => {
    const runtimeRoot = await createRuntimeDir();
    const observedContexts: Array<DetectContext | undefined> = [];
    writeProjectToStore(join(runtimeRoot, 'projects'), {
      id: 'project-managed-agent-ssr',
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: {
        title: 'Managed agent SSR',
        prompt: 'Check managed agents.',
        projectKind: 'prototype',
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentAvailability: async (context) => {
          observedContexts.push(context);
          return [
            { id: 'codex', label: 'Codex', available: true },
            { id: 'claude', label: 'Claude Code', available: true },
          ];
        },
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/project/project-managed-agent-ssr`, {
      headers: { [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-ssr-1' },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(observedContexts[0]?.env).not.toHaveProperty('TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL');
    expect(observedContexts[0]?.managedAgentInvocation).toEqual({
      credential: 'credential-ssr-1',
      cwd: runtimeRoot,
    });
    expect(html).not.toContain('credential-ssr-1');
    expect(JSON.stringify(readInitialDataFromHtml(html))).not.toContain('credential-ssr-1');
  });

  it('does not reuse managed agent availability detection across credential headers', async () => {
    const runtimeRoot = await createRuntimeDir();
    let detectCalls = 0;
    writeProjectToStore(join(runtimeRoot, 'projects'), {
      id: 'project-managed-agent-availability-cache',
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: {
        title: 'Managed agent availability cache',
        prompt: 'Check managed agents.',
        projectKind: 'prototype',
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentAvailability: async () => {
          detectCalls += 1;
          if (detectCalls > 1) {
            return [
              {
                id: 'codex',
                label: 'Codex',
                available: false,
                unavailableReason: 'Unable to run codex --version: context canceled',
              },
              { id: 'claude', label: 'Claude Code', available: true },
            ];
          }
          return [
            { id: 'codex', label: 'Codex', available: true },
            { id: 'claude', label: 'Claude Code', available: true },
          ];
        },
      }),
    );

    const first = await fetch(`http://127.0.0.1:${port}/project/project-managed-agent-availability-cache`, {
      headers: { [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-ssr-cache-1' },
    });
    const second = await fetch(`http://127.0.0.1:${port}/project/project-managed-agent-availability-cache`, {
      headers: { [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-ssr-cache-2' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(detectCalls).toBe(2);
    expect(readInitialDataFromHtml(await second.text())).toMatchObject({
      projectEditor: {
        agentAvailability: [
          {
            id: 'codex',
            label: 'Codex',
            available: false,
            unavailableReason: 'Unable to run codex --version: context canceled',
          },
          { id: 'claude', label: 'Claude Code', available: true },
        ],
      },
    });
  });

  it('lists model catalogs from agent runtime detection', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentModelCatalog: async () => [
          {
            id: 'claude',
            label: 'Claude Code',
            models: [
              { id: 'default', label: 'Default (recommended)' },
              { id: 'opus[1m]', label: 'Opus 4.7 (1M context)', description: 'Detected by Claude.' },
            ],
          },
          {
            id: 'codex',
            label: 'Codex',
            models: [
              { id: 'default', label: 'Default (CLI config)' },
              { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Detected by Codex.' },
            ],
          },
        ],
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/agents/models`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agents: [
        {
          id: 'claude',
          label: 'Claude Code',
          models: [
            { id: 'default', label: 'Default (recommended)' },
            { id: 'opus[1m]', label: 'Opus 4.7 (1M context)', description: 'Detected by Claude.' },
          ],
        },
        {
          id: 'codex',
          label: 'Codex',
          models: [
            { id: 'default', label: 'Default (CLI config)' },
            { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Detected by Codex.' },
          ],
        },
      ],
    });
  });

  it('passes an explicit managed agent credential header to model catalog detection without leaking it', async () => {
    const observedContexts: Array<DetectContext | undefined> = [];
    const runtimeRoot = await createRuntimeDir();
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentModelCatalog: async (context) => {
          observedContexts.push(context);
          return [
            {
              id: 'codex',
              label: 'Codex',
              models: [{ id: 'default', label: 'Default' }],
            },
          ];
        },
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/agents/models`, {
      headers: { [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-models-1' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(observedContexts[0]?.env).not.toHaveProperty('TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL');
    expect(observedContexts[0]?.managedAgentInvocation).toEqual({
      credential: 'credential-models-1',
      cwd: runtimeRoot,
    });
    expect(JSON.stringify(body)).not.toContain('credential-models-1');
  });

  it('does not reuse managed agent model catalog detection across credential headers', async () => {
    let detectCalls = 0;
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentModelCatalog: async () => {
          detectCalls += 1;
          return [
            {
              id: 'codex',
              label: 'Codex',
              models: [
                {
                  id: detectCalls === 1 ? 'gpt-5.5' : 'transient-fallback',
                  label: detectCalls === 1 ? 'GPT-5.5' : 'Transient fallback',
                },
              ],
            },
          ];
        },
      }),
    );

    const first = await fetch(`http://127.0.0.1:${port}/api/agents/models`, {
      headers: { [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-model-cache-1' },
    });
    const second = await fetch(`http://127.0.0.1:${port}/api/agents/models`, {
      headers: { [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-model-cache-2' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(detectCalls).toBe(2);
    expect(await second.json()).toMatchObject({
      agents: [
        {
          id: 'codex',
          models: [{ id: 'transient-fallback', label: 'Transient fallback' }],
        },
      ],
    });
  });

  it('reports an assistant message as running while its run is still live', async () => {
    const runtimeRoot = await createRuntimeDir();
    const projectId = 'project-live-run';
    writeProjectToStore(join(runtimeRoot, 'projects'), {
      id: projectId,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: { title: 'Live run', prompt: 'Generate a page.', projectKind: 'prototype' },
    });
    // The default no-op startAgentRun leaves the run live (non-terminal) without
    // ever writing an end event, mirroring a project reopened mid-generation.
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: runtimeRoot }));

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, prompt: 'Generate a page.', provider: 'codex' }),
    });
    expect(runResponse.status).toBe(202);
    const run = (await runResponse.json()) as { assistantMessageId: string };

    const editorResponse = await fetch(`http://127.0.0.1:${port}/project/${projectId}`);
    const initial = readInitialDataFromHtml(await editorResponse.text());
    const messages = (initial.projectEditor as { messages: Array<{ id: string; runStatus?: string }> }).messages;
    const assistant = messages.find((message) => message.id === run.assistantMessageId);

    // Persisted status lags at 'queued'; reconciliation against the live run
    // surfaces 'running' so the client reattaches and resumes streaming.
    expect(assistant?.runStatus).toBe('running');
  });

  it('collapses an orphaned non-terminal run to failed when no live run remains', async () => {
    const runtimeRoot = await createRuntimeDir();
    const projectsDir = join(runtimeRoot, 'projects');
    const projectId = 'project-orphan-run';
    const conversationId = 'conversation-orphan';
    writeProjectToStore(projectsDir, {
      id: projectId,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: { title: 'Orphan run', prompt: 'Generate a page.', projectKind: 'prototype' },
    });
    createConversationInStore(projectsDir, projectId, conversationId, 'Main thread');
    upsertMessageInStore(projectsDir, projectId, conversationId, {
      id: 'assistant-orphan',
      role: 'assistant',
      content: 'partial output',
      runId: 'run-gone',
      runStatus: 'queued',
    });
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: runtimeRoot }));

    const editorResponse = await fetch(`http://127.0.0.1:${port}/project/${projectId}`);
    const initial = readInitialDataFromHtml(await editorResponse.text());
    const messages = (initial.projectEditor as { messages: Array<{ id: string; runStatus?: string }> }).messages;
    const assistant = messages.find((message) => message.id === 'assistant-orphan');

    // The run vanished without an end event (server restart mid-run); it must not
    // remain a permanent "in progress" zombie.
    expect(assistant?.runStatus).toBe('failed');
  });

  it('installs Claude Code and returns refreshed local agent availability', async () => {
    const installCalls: string[] = [];
    let detectCalls = 0;
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        installClaudeCode: async () => {
          installCalls.push('claude');
        },
        detectAgentAvailability: async () => {
          detectCalls += 1;
          return detectCalls === 1
            ? [
                { id: 'codex', label: 'Codex', available: true },
                { id: 'claude', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
              ]
            : [
                { id: 'codex', label: 'Codex', available: true },
                { id: 'claude', label: 'Claude Code', available: true },
              ];
        },
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/agents/claude/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agentAvailability: [
        { id: 'codex', label: 'Codex', available: true },
        { id: 'claude', label: 'Claude Code', available: true },
      ],
    });
    expect(installCalls).toEqual(['claude']);
    expect(detectCalls).toBe(2);
  });

  it('exposes project context through Tutti CLI handlers without destructive project tools', async () => {
    const testRuntimeDir = await createRuntimeDir();
    const projectsDir = join(testRuntimeDir, 'projects');
    const projectId = 'project-cli-readonly';
    const conversationId = 'conversation-cli-readonly';
    writeProjectToStore(projectsDir, {
      id: projectId,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: {
        title: 'Landing redesign',
        prompt: 'Create a new landing page direction.',
        projectKind: 'prototype',
      },
    });
    createConversationInStore(projectsDir, projectId, conversationId, 'Main thread');
    upsertMessageInStore(projectsDir, projectId, conversationId, {
      id: 'message-user-1',
      role: 'user',
      content: 'Revise the hero.',
    });
    await mkdir(join(projectsDir, projectId, 'assets'), { recursive: true });
    await writeFile(join(projectsDir, projectId, 'assets', 'hero.html'), '<section>Hero</section>');
    upsertProjectFileInStore(projectsDir, projectId, {
      name: 'hero.html',
      path: 'assets/hero.html',
      size: '<section>Hero</section>'.length,
      mime: 'text/html',
    });
    upsertPreviewCommentInStore(projectsDir, projectId, {
      target: {
        filePath: 'assets/hero.html',
        targetId: 'hero-title',
        selector: '[data-od-id="hero-title"]',
        label: 'Hero title',
        text: 'Hero',
        position: { x: 10, y: 20, width: 240, height: 80 },
      },
      note: 'Make the headline sharper.',
    });

    const openRequests: Array<{ route: string; projectId?: string }> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: testRuntimeDir,
        openApp: (input) => {
          openRequests.push(input);
        },
      }),
    );

    const projects = await postCli(port, 'projects');
    expect(projects.status).toBe(200);
    expect(projects.body.value).toMatchObject({ projects: [{ id: projectId, title: 'Landing redesign' }] });

    const openDashboard = await postCli(port, 'open');
    expect(openDashboard.status).toBe(200);
    expect(openDashboard.body.value).toMatchObject({ openRequested: true, route: '/' });

    const openProject = await postCli(port, 'open', { 'project-id': projectId });
    expect(openProject.status).toBe(200);
    expect(openProject.body.value).toMatchObject({ openRequested: true, projectId, route: `/project/${projectId}` });
    expect(openRequests).toEqual([
      { route: '/' },
      { projectId, route: `/project/${projectId}` },
    ]);

    const missingProject = await postCli(port, 'open', { 'project-id': 'missing-project' });
    expect(missingProject.status).toBe(404);
    expect(missingProject.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
    expect(projectRowExists(testRuntimeDir, 'missing-project')).toBe(false);

    const nonRoutableProjectId = 'client.v1';
    writeProjectToStore(projectsDir, {
      id: nonRoutableProjectId,
      designSystemId: null,
      createdAt: 3,
      updatedAt: 3,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: {
        title: 'Client v1',
        prompt: 'Existing project with a legacy id.',
        projectKind: 'prototype',
      },
    });
    const nonRoutableProject = await postCli(port, 'open', { 'project-id': nonRoutableProjectId });
    expect(nonRoutableProject.status).toBe(400);
    expect(nonRoutableProject.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(openRequests).toEqual([
      { route: '/' },
      { projectId, route: `/project/${projectId}` },
    ]);

    const conversations = await postCli(port, 'conversations', { 'project-id': projectId });
    expect(conversations.status).toBe(200);
    expect(conversations.body.value).toMatchObject({ conversations: [{ id: conversationId, title: 'Main thread' }] });

    const messages = await postCli(port, 'conversation-messages', { 'project-id': projectId, 'conversation-id': conversationId });
    expect(messages.status).toBe(200);
    expect(messages.body.value).toMatchObject({ messages: [{ id: 'message-user-1', content: 'Revise the hero.' }] });

    const files = await postCli(port, 'files', { 'project-id': projectId });
    expect(files.status).toBe(200);
    expect(files.body.value).toMatchObject({
      files: [
        {
          name: 'hero.html',
          mime: 'text/html',
          url: `http://127.0.0.1:${port}/static/projects/${projectId}/assets/hero.html`,
        },
      ],
    });
    const listedAbsolutePath = (files.body.value as { files: Array<{ absolutePath: string }> }).files[0].absolutePath;
    expect(isAbsolute(listedAbsolutePath)).toBe(true);
    expect(listedAbsolutePath.endsWith(`projects/${projectId}/assets/hero.html`)).toBe(true);

    const staticFile = await fetch(`http://127.0.0.1:${port}/static/projects/${projectId}/assets/hero.html`);
    expect(staticFile.status).toBe(200);
    expect(await staticFile.text()).toBe('<section>Hero</section>');

    const fileContent = await postCli(port, 'file-get', { 'project-id': projectId, name: 'hero.html' });
    expect(fileContent.status).toBe(200);
    expect(fileContent.body.value).toMatchObject({
      content: '<section>Hero</section>',
      encoding: 'utf8',
      file: { name: 'hero.html' },
    });
    const fetchedAbsolutePath = (fileContent.body.value as { file: { absolutePath: string } }).file.absolutePath;
    expect(isAbsolute(fetchedAbsolutePath)).toBe(true);
    expect(fetchedAbsolutePath).toBe(listedAbsolutePath);

    const comments = await postCli(port, 'comments', { 'project-id': projectId });
    expect(comments.status).toBe(200);
    expect(comments.body.value).toMatchObject({ comments: [{ note: 'Make the headline sharper.', status: 'open' }] });

    const removedCommands = [
      'project-get',
      'project-delete',
      'project-data',
      'conversation-create',
      'conversation-rename',
      'comment-create',
      'comment-update',
      'comment-delete',
      'file-create',
      'file-delete',
      'file-rename',
    ];
    for (const command of removedCommands) {
      await expect(postCliStatus(port, command, { 'project-id': projectId, 'conversation-id': conversationId })).resolves.toBe(404);
    }
  });

  it('creates and updates projects through Tutti CLI handlers', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const created = await postCli(port, 'project-create', {
      prompt: 'Generate a polished analytics dashboard.',
      title: 'Analytics dashboard',
      projectKind: 'prototype',
    });

    expect(created.status).toBe(200);
    expect(created.body.value).toMatchObject({
      project: {
        id: expect.any(String),
        metadata: {
          title: 'Analytics dashboard',
          prompt: 'Generate a polished analytics dashboard.',
          projectKind: 'prototype',
        },
      },
      conversationId: expect.stringMatching(/^conversation-[0-9a-f-]{8}$/),
      resolvedDir: expect.any(String),
    });

    const projectId = ((created.body.value as Record<string, unknown>).project as { id: string }).id;
    const updated = await postCli(port, 'project-update', {
      'project-id': projectId,
      title: 'Updated analytics dashboard',
    });

    expect(updated.status).toBe(200);
    expect(updated.body.value).toMatchObject({
      project: {
        id: projectId,
        metadata: {
          title: 'Updated analytics dashboard',
          prompt: 'Generate a polished analytics dashboard.',
          projectKind: 'prototype',
        },
      },
      resolvedDir: expect.any(String),
    });
  });

  it('summarizes CLI-created project titles to 20 characters when title is omitted', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const created = await postCli(port, 'project-create', {
      prompt: '制作一个安全、合规的登录页面产品原型。要求包含邮箱、密码、第三方登录和错误状态。',
      projectKind: 'prototype',
    });

    expect(created.status).toBe(200);
    expect(created.body.value).toMatchObject({
      project: {
        metadata: {
          title: '制作一个安全、合规的登录页面产品原型',
          prompt: '制作一个安全、合规的登录页面产品原型。要求包含邮箱、密码、第三方登录和错误状态。',
          projectKind: 'prototype',
        },
      },
    });
  });

  it('limits explicit project titles to 20 characters when creating projects', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const longTitle = '一个非常非常非常长的项目名称应该被截断处理掉';

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: longTitle,
        prompt: '生成一个项目。',
        projectKind: 'prototype',
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { project: { metadata: Record<string, unknown> } };
    expect(created.project.metadata).toMatchObject({
      title: Array.from(longTitle).slice(0, 20).join(''),
      prompt: '生成一个项目。',
      projectKind: 'prototype',
    });
  });

  it('starts Tutti CLI sessions with local files uploaded as run attachments', async () => {
    const testRuntimeDir = await createRuntimeDir();
    const localFilePath = join(testRuntimeDir, 'reference.png');
    await writeFile(localFilePath, 'local-image-bytes', 'utf8');
    const startedRequests: Record<string, unknown>[] = [];
    const startedRuns: ChatRun[] = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: testRuntimeDir,
        startAgentRun: ({ run, runs, request }) => {
          startedRuns.push(run);
          startedRequests.push(request);
          runs.finish(run, 'succeeded');
        },
      }),
    );
    const createdProject = await postCli(port, 'project-create', {
      prompt: 'Create a visual direction.',
      projectKind: 'prototype',
    });
    const projectId = ((createdProject.body.value as Record<string, unknown>).project as { id: string }).id;
    const conversationId = (createdProject.body.value as { conversationId: string }).conversationId;

    const started = await postCli(port, 'session-start', {
      'project-id': projectId,
      'conversation-id': conversationId,
      prompt: 'Use the uploaded reference image.',
      agentId: 'claude',
      attachments: [
        {
          path: 'assets/existing.md',
          name: 'existing.md',
          kind: 'file',
          size: 12,
          mimeType: 'text/markdown',
        },
      ],
      localFiles: [
        {
          path: localFilePath,
          name: 'reference.png',
        },
      ],
      mediaExecution: {
        mode: 'enabled',
        allowedSurfaces: ['image'],
      },
      toolBundle: {
        id: 'media-tools',
      },
    });

    expect(started.status).toBe(200);
    expect(started.body.value).toMatchObject({
      runId: expect.stringMatching(/[0-9a-f-]{36}/),
      conversationId,
      assistantMessageId: expect.stringMatching(/^assistant-[0-9a-f-]{8}$/),
      provider: 'claude',
      status: 'succeeded',
    });
    // session-start runs synchronously and returns the agent conversation verbatim.
    const sessionMessages = (started.body.value as { messages: Array<{ role: string; content: string }> }).messages;
    expect(Array.isArray(sessionMessages)).toBe(true);
    expect(sessionMessages).toContainEqual(
      expect.objectContaining({ role: 'user', content: 'Use the uploaded reference image.' }),
    );
    await expect(readFile(join(testRuntimeDir, 'projects', projectId, 'assets', 'reference.png'), 'utf8')).resolves.toBe('local-image-bytes');
    expect(startedRuns[0]).not.toHaveProperty('managedAgentInvocationCredential');
    expect(startedRequests[0]).not.toHaveProperty('managedAgentInvocationCredential');
    expect(startedRequests).toEqual([
      expect.objectContaining({
        projectId,
        conversationId,
        prompt: 'Use the uploaded reference image.',
        agentId: 'claude',
        mediaExecution: {
          mode: 'enabled',
          allowedSurfaces: ['image'],
        },
        toolBundle: {
          id: 'media-tools',
        },
        attachments: [
          {
            path: 'assets/existing.md',
            name: 'existing.md',
            kind: 'file',
            size: 12,
            mimeType: 'text/markdown',
          },
          {
            path: 'assets/reference.png',
            name: 'reference.png',
            kind: 'image',
            size: 'local-image-bytes'.length,
            mimeType: 'image/png',
          },
        ],
      }),
    ]);

    const messages = await postCli(port, 'conversation-messages', {
      'project-id': projectId,
      'conversation-id': conversationId,
    });
    const messagePayload = messages.body.value as {
      messages: Array<{ role: string; content: string; attachments?: unknown[] }>;
    };
    expect(messagePayload.messages[0]).toMatchObject({
      role: 'user',
      content: 'Use the uploaded reference image.',
      attachments: [
        { name: 'existing.md' },
        { name: 'reference.png', path: 'assets/reference.png', kind: 'image' },
      ],
    });
    expect(messagePayload.messages[1]).toMatchObject({ role: 'assistant' });
  });

  it('falls back to Claude Code before the run when codex is unavailable up front', async () => {
    const startedAgents: Array<string | null> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentAvailability: async () => [
          { id: 'codex', label: 'Codex', available: false, unavailableReason: 'Codex is not authenticated.' },
          { id: 'claude-code', label: 'Claude Code', available: true },
        ],
        startAgentRun: ({ run, runs, request }) => {
          startedAgents.push((request.agentId as string | undefined) ?? null);
          runs.finish(run, 'succeeded');
        },
      }),
    );
    const createdProject = await postCli(port, 'project-create', { prompt: 'A login page' });
    const projectId = ((createdProject.body.value as Record<string, unknown>).project as { id: string }).id;

    const started = await postCli(port, 'session-start', {
      'project-id': projectId,
      prompt: 'Build a modern login page',
    });

    expect(started.status).toBe(200);
    expect(started.body.value).toMatchObject({
      provider: 'claude-code',
      status: 'succeeded',
      agentFallback: {
        from: 'codex',
        to: 'claude-code',
        stage: 'pre-session',
        reason: 'Codex is not authenticated.',
      },
    });
    // Codex is never started; only Claude Code runs.
    expect(startedAgents).toEqual(['claude-code']);
  });

  it('retries on Claude Code in a new conversation when a codex run breaks mid-session', async () => {
    const startedAgents: Array<string | null> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentAvailability: async () => [
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude-code', label: 'Claude Code', available: true },
        ],
        startAgentRun: ({ run, runs, request }) => {
          const agentId = (request.agentId as string | undefined) ?? null;
          startedAgents.push(agentId);
          if (agentId === 'codex') {
            runs.fail(run, 'AGENT_EXECUTION_FAILED', '401 Unauthorized: Missing bearer or basic authentication');
            return;
          }
          runs.finish(run, 'succeeded');
        },
      }),
    );
    const createdProject = await postCli(port, 'project-create', { prompt: 'A login page' });
    const projectId = ((createdProject.body.value as Record<string, unknown>).project as { id: string }).id;
    const codexConversationId = (createdProject.body.value as { conversationId: string }).conversationId;

    const started = await postCli(port, 'session-start', {
      'project-id': projectId,
      'conversation-id': codexConversationId,
      'agent-id': 'codex',
      prompt: 'Build a modern login page',
    });

    expect(started.status).toBe(200);
    expect(started.body.value).toMatchObject({
      provider: 'claude-code',
      status: 'succeeded',
      agentFallback: {
        from: 'codex',
        to: 'claude-code',
        stage: 'in-session',
      },
    });
    // The fallback runs in a fresh conversation, not the codex-locked one.
    expect((started.body.value as { conversationId: string }).conversationId).not.toBe(codexConversationId);
    expect(startedAgents).toEqual(['codex', 'claude-code']);
  });

  it('reports no fallback and surfaces the failure when codex breaks and Claude Code is unavailable', async () => {
    const startedAgents: Array<string | null> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentAvailability: async () => [
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude-code', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
        ],
        startAgentRun: ({ run, runs, request }) => {
          startedAgents.push((request.agentId as string | undefined) ?? null);
          runs.fail(run, 'AGENT_EXECUTION_FAILED', '401 Unauthorized: Missing bearer or basic authentication');
        },
      }),
    );
    const createdProject = await postCli(port, 'project-create', { prompt: 'A login page' });
    const projectId = ((createdProject.body.value as Record<string, unknown>).project as { id: string }).id;

    const started = await postCli(port, 'session-start', {
      'project-id': projectId,
      'agent-id': 'codex',
      prompt: 'Build a modern login page',
    });

    expect(started.status).toBe(200);
    expect(started.body.value).toMatchObject({
      provider: 'codex',
      status: 'failed',
      agentFallback: null,
    });
    // Codex runs once; there is no usable provider to fall back to.
    expect(startedAgents).toEqual(['codex']);
  });

  it('starts a new conversation when the requested provider differs from a locked conversation', async () => {
    const startedAgents: Array<string | null> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentAvailability: async () => [
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude', label: 'Claude Code', available: true },
        ],
        startAgentRun: ({ run, runs, request }) => {
          startedAgents.push((request.agentId as string | undefined) ?? null);
          runs.finish(run, 'succeeded');
        },
      }),
    );
    const createdProject = await postCli(port, 'project-create', { prompt: 'A login page' });
    const projectId = ((createdProject.body.value as Record<string, unknown>).project as { id: string }).id;
    const codexConversationId = (createdProject.body.value as { conversationId: string }).conversationId;

    // First run locks the conversation to codex.
    await postCli(port, 'session-start', {
      'project-id': projectId,
      'conversation-id': codexConversationId,
      'agent-id': 'codex',
      prompt: 'Build with codex',
    });

    // Re-targeting the same conversation with Claude Code would collide with the codex lock; the
    // call transparently runs in a fresh conversation instead of failing.
    const started = await postCli(port, 'session-start', {
      'project-id': projectId,
      'conversation-id': codexConversationId,
      'agent-id': 'claude',
      prompt: 'Now build with Claude Code',
    });

    expect(started.status).toBe(200);
    expect(started.body.value).toMatchObject({
      provider: 'claude',
      status: 'succeeded',
      agentFallback: {
        from: 'codex',
        to: 'claude',
        stage: 'conversation-locked',
      },
    });
    expect((started.body.value as { conversationId: string }).conversationId).not.toBe(codexConversationId);
    expect(startedAgents).toEqual(['codex', 'claude']);
  });

  it('serves the dashboard page at the root route', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Prototype Design');
    expect(html).toContain('New prototype');
    expect(html).toContain('Search designs');
  });

  it('serves the project editor page under /project/:projectId', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/project/demo-project`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('demo-project');
    expect(html).toContain('vibe-design-chat-ui');
    expect(html).toContain('Chat composer');
    expect(html).toContain('Project Canvas Workspace');
    expect(html).toContain('Design Files');
    expect(html).toContain('/client.js');
    expect(html).toContain('"files":[]');
    expect(html).not.toContain('landing.html');
  });

  it('serves the client bundle without browser caching', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/client.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('text/javascript');
  });

  it('returns 404 for unknown app routes', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/missing`);

    expect(response.status).toBe(404);
  });

  it('serves the web SSR page at /index.html', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/index.html`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Prototype Design');
    expect(html).toContain('New prototype');
  });

  it('lists skills from temporary user and built-in roots as JSON', async () => {
    const api = await startSkillsApi();
    await writeSkill(api.builtInRoot, 'built-in-skill', { sourceMarker: 'built-in' });
    await writeSkill(api.userRoot, 'user-skill', { sourceMarker: 'user' });

    const response = await fetch(api.url('/api/skills'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(payload.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'built-in-skill', source: 'built-in' }),
        expect.objectContaining({ id: 'user-skill', source: 'user' }),
      ]),
    );
  });

  it('finds a skill by id through alias-aware lookup', async () => {
    const api = await startSkillsApi();
    await writeSkill(api.builtInRoot, 'vibe-design-landing', {
      name: 'vibe-design-landing',
      body: '# Landing skill',
    });

    const response = await fetch(api.url('/api/skills/editorial-collage'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({ id: 'vibe-design-landing' }));
  });

  it('lists bundled design systems without exposing full bodies', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'atelier-zero', {
      title: 'Atelier Zero',
      category: 'Editorial',
      summary: 'Warm paper, restrained contrast, and editorial rhythm.',
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/design-systems`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.designSystems).toEqual([
      expect.objectContaining({
        id: 'atelier-zero',
        title: 'Atelier Zero',
        category: 'Editorial',
        summary: 'Warm paper, restrained contrast, and editorial rhythm.',
        source: 'built-in',
        status: 'published',
        isEditable: false,
        swatches: ['#f7f0e8', '#111111'],
      }),
    ]);
    expect(body.designSystems[0]).not.toHaveProperty('body');
  });

  it('localizes bundled design systems from the requested locale', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'atelier-zero', {
      title: 'Atelier Zero',
      category: 'Editorial',
      summary: 'Warm paper, restrained contrast, and editorial rhythm.',
      manifest: {
        schemaVersion: 'vibe-design-system/v1',
        id: 'atelier-zero',
        name: 'Atelier Zero',
        category: 'Editorial',
        description: 'Warm paper, restrained contrast, and editorial rhythm.',
        i18n: {
          'zh-CN': {
            name: '零号工作室',
            category: '编辑设计',
            description: '温暖纸感、克制对比和编辑节奏。',
          },
        },
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/design-systems?locale=zh-CN`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.designSystems).toEqual([
      expect.objectContaining({
        id: 'atelier-zero',
        title: '零号工作室',
        category: '编辑设计',
        summary: '温暖纸感、克制对比和编辑节奏。',
      }),
    ]);
  });

  it('uses explicit English design system locale overrides for regional English requests', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'atelier-zero', {
      title: 'Atelier Zero',
      category: 'Editorial',
      summary: 'Warm paper, restrained contrast, and editorial rhythm.',
      manifest: {
        schemaVersion: 'vibe-design-system/v1',
        id: 'atelier-zero',
        name: 'Atelier Zero',
        category: 'Editorial',
        description: 'Warm paper, restrained contrast, and editorial rhythm.',
        i18n: {
          en: {
            name: 'Atelier Zero English',
            category: 'Editorial English',
            description: 'English override from the locale map.',
          },
        },
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/design-systems?locale=en-US`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.designSystems[0]).toEqual(expect.objectContaining({
      title: 'Atelier Zero English',
      category: 'Editorial English',
      summary: 'English override from the locale map.',
    }));
  });

  it('uses Accept-Language when no design system locale query is provided', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'atelier-zero', {
      title: 'Atelier Zero',
      category: 'Editorial',
      summary: 'Warm paper, restrained contrast, and editorial rhythm.',
      manifest: {
        schemaVersion: 'vibe-design-system/v1',
        id: 'atelier-zero',
        name: 'Atelier Zero',
        category: 'Editorial',
        description: 'Warm paper, restrained contrast, and editorial rhythm.',
        i18n: {
          'zh-CN': {
            name: '零号工作室',
            category: '编辑设计',
            description: '温暖纸感、克制对比和编辑节奏。',
          },
        },
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/design-systems`, {
      headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.designSystems[0]).toEqual(expect.objectContaining({
      title: '零号工作室',
      category: '编辑设计',
      summary: '温暖纸感、克制对比和编辑节奏。',
    }));
  });

  it('lists the bundled palette design styles', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: join(repoRoot, 'design-systems'),
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/design-systems`);
    const body = await response.json() as {
      designSystems: Array<{ id: string; title: string; source: string; isEditable: boolean; swatches: string[] }>;
    };

    expect(response.status).toBe(200);

    // Every bundled style is a non-editable built-in.
    expect(body.designSystems.length).toBeGreaterThanOrEqual(15);
    for (const designSystem of body.designSystems) {
      expect(designSystem.source).toBe('built-in');
      expect(designSystem.isEditable).toBe(false);
    }

    expect(body.designSystems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'clarity', title: 'Clarity', source: 'built-in', isEditable: false }),
      expect.objectContaining({ id: 'vanguard', title: 'Vanguard', source: 'built-in', isEditable: false }),
      expect.objectContaining({ id: 'spritz', title: 'Spritz', source: 'built-in', isEditable: false }),
      expect.objectContaining({ id: 'nebula', title: 'Nebula', source: 'built-in', isEditable: false }),
      expect.objectContaining({ id: 'ember', title: 'Ember', source: 'built-in', isEditable: false }),
    ]));

    // Each style leads with its own distinct signature accent swatch.
    const leadSwatches = body.designSystems.map((designSystem) => designSystem.swatches[0]);
    expect(new Set(leadSwatches).size).toBe(leadSwatches.length);
  });

  it('returns design-system detail and renders an HTML preview', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'signal', {
      title: 'Signal System',
      category: 'Application',
      tokensCss: ':root { --vd-bg: #101820; --vd-accent: #4fd1c5; }',
      usageMd: 'Use Signal System tokens before inventing visual rules.',
      componentsHtml: '<button class="button-primary">Launch</button>',
      manifest: {
        schemaVersion: 'vibe-design-system/v1',
        id: 'signal',
        name: 'Signal System',
        category: 'Application',
        files: {
          design: 'DESIGN.md',
          tokens: 'tokens.css',
          components: 'components.html',
        },
        usage: 'USAGE.md',
        importMode: 'hybrid',
      },
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/design-systems/signal`);
    const detail = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detail.designSystem).toMatchObject({
      id: 'signal',
      title: 'Signal System',
      category: 'Application',
      body: expect.stringContaining('# Signal System'),
      packageInfo: {
        manifest: expect.objectContaining({
          importMode: 'hybrid',
          usage: 'USAGE.md',
        }),
      },
    });

    const previewResponse = await fetch(`http://127.0.0.1:${port}/api/design-systems/signal/preview`);
    const preview = await previewResponse.text();

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get('content-type')).toContain('text/html');
    expect(preview).toContain('Signal System');
    expect(preview).toContain('#101820');
  });

  it('creates, updates, and deletes user design systems with a user-prefixed id', async () => {
    const builtInRoot = await createTempRoot();
    const userRoot = await createTempRoot();
    await writeDesignSystem(builtInRoot, 'default', {
      title: 'Default System',
      category: 'Application',
      summary: 'Built-in default.',
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: builtInRoot,
        userDesignSystemsRoot: userRoot,
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/design-systems`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Acme Core',
        category: 'Productivity',
        summary: 'A user-authored product design system.',
        body: '# Acme Core\n\nA user-authored product design system.\n\n## Color\n\n- Accent: #3366ff',
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      designSystem: { id: string; title: string; source: string; status: string; isEditable: boolean };
    };
    expect(created.designSystem).toMatchObject({
      id: 'user:acme-core',
      title: 'Acme Core',
      source: 'user',
      status: 'draft',
      isEditable: true,
    });

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/design-systems`);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { designSystems: Array<{ id: string; title: string }> };
    expect(listBody.designSystems.map((system) => system.id)).toEqual(['user:acme-core', 'default']);

    const updateResponse = await fetch(
      `http://127.0.0.1:${port}/api/design-systems/${encodeURIComponent('user:acme-core')}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Acme Core 2026',
          status: 'published',
          body: '# Acme Core 2026\n\nUpdated rules.\n\n## Color\n\n- Accent: #22c55e',
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json() as {
      designSystem: { id: string; title: string; status: string; body: string };
    };
    expect(updated.designSystem).toMatchObject({
      id: 'user:acme-core',
      title: 'Acme Core 2026',
      status: 'published',
    });
    expect(updated.designSystem.body).toContain('#22c55e');

    const deleteBuiltInResponse = await fetch(`http://127.0.0.1:${port}/api/design-systems/default`, {
      method: 'DELETE',
    });
    expect(deleteBuiltInResponse.status).toBe(404);

    const deleteResponse = await fetch(
      `http://127.0.0.1:${port}/api/design-systems/${encodeURIComponent('user:acme-core')}`,
      { method: 'DELETE' },
    );
    expect(deleteResponse.status).toBe(204);

    const finalListResponse = await fetch(`http://127.0.0.1:${port}/api/design-systems`);
    const finalList = await finalListResponse.json() as { designSystems: Array<{ id: string }> };
    expect(finalList.designSystems.map((system) => system.id)).toEqual(['default']);
  });

  it('rejects malformed percent-encoded skill ids without returning 500', async () => {
    const api = await startSkillsApi();

    const response = await fetch(api.url('/api/skills/%E0%A4%A'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('imports posted skills into the user root without writing the built-in root', async () => {
    const api = await startSkillsApi();

    const response = await fetch(api.url('/api/skills'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Custom Skill',
        description: 'A user-authored skill.',
        body: '# Custom workflow',
        triggers: ['custom workflow'],
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual(
      expect.objectContaining({
        id: 'custom-skill',
        slug: 'custom-skill',
      }),
    );
    await expect(readFile(join(api.userRoot, 'custom-skill', 'SKILL.md'), 'utf8')).resolves.toContain(
      '# Custom workflow',
    );
    await expect(readFile(join(api.builtInRoot, 'custom-skill', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  it('deletes only user-source skills', async () => {
    const api = await startSkillsApi();
    const userDir = await writeSkill(api.userRoot, 'user-owned', {});
    await writeSkill(api.builtInRoot, 'built-in-owned', {});

    const deleteUser = await fetch(api.url('/api/skills/user-owned'), { method: 'DELETE' });
    const deleteBuiltIn = await fetch(api.url('/api/skills/built-in-owned'), { method: 'DELETE' });

    expect(deleteUser.status).toBe(204);
    await expect(readFile(join(userDir, 'SKILL.md'), 'utf8')).rejects.toThrow();
    expect(deleteBuiltIn.status).toBe(403);
    expect(await deleteBuiltIn.json()).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('rejects non-JSON and invalid skill import bodies without crashing', async () => {
    const api = await startSkillsApi();

    const nonJson = await fetch(api.url('/api/skills'), {
      method: 'POST',
      headers: { 'content-type': 'text/plain; note=application/json' },
      body: JSON.stringify({
        name: 'Wrong Media Type',
        body: '# Should not import',
      }),
    });
    const invalidJson = await fetch(api.url('/api/skills'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Missing Body' }),
    });

    expect(nonJson.status).toBe(400);
    expect(invalidJson.status).toBe(400);
    expect(await nonJson.json()).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(await invalidJson.json()).toEqual(expect.objectContaining({ error: expect.any(String) }));
    await expect(readFile(join(api.userRoot, 'wrong-media-type', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  it('rejects oversized JSON skill import bodies before importing', async () => {
    const api = await startSkillsApi();

    const response = await fetch(api.url('/api/skills'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Oversized Skill',
        body: '# Oversized\n' + 'x'.repeat(1024 * 1024),
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload).toEqual(expect.objectContaining({ error: expect.any(String) }));
    await expect(readFile(join(api.userRoot, 'oversized-skill', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  it('creates runs and exposes status, cancellation, feedback, and SSE replay routes', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ run, runs }) => {
          runs.emit(run, 'status', { label: 'running' });
          runs.finish(run, 'succeeded', 0, null);
        },
      }),
    );

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects/project-1`);
    expect(projectResponse.status).toBe(200);
    const conversationResponse = await fetch(`http://127.0.0.1:${port}/api/projects/project-1/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'conversation-1', title: 'Run test' }),
    });
    expect(conversationResponse.status).toBe(201);

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        prompt: 'Build a small page',
        agentId: 'claude',
        assistantMessageId: 'assistant-1',
      }),
    });

    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as {
      runId: string;
      conversationId: string | null;
      assistantMessageId: string | null;
    };
    expect(created.runId).toMatch(/[0-9a-f-]{36}/);
    expect(created.conversationId).toBe('conversation-1');
    expect(created.assistantMessageId).toBe('assistant-1');

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}`);
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      id: created.runId,
      projectId: 'project-1',
      agentId: 'claude',
    });

    const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/events`);
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream');
    const eventsText = await eventsResponse.text();
    expect(eventsText).toContain('event: status');
    expect(eventsText).toContain('event: end');
    expect(readSseEvents(eventsText).find((event) => event.event === 'status')?.data).toMatchObject({
      label: 'running',
    });
    expect(readSseEvents(eventsText).find((event) => event.event === 'end')?.data).toEqual({
      code: 0,
      signal: null,
      status: 'succeeded',
    });

    const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/cancel`, {
      method: 'POST',
    });
    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.json()).toEqual({ ok: true });

    const feedbackResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rating: 'positive',
        reasonCodes: ['matched_request', 'unknown_reason', 'matched_request'],
      }),
    });
    expect(feedbackResponse.status).toBe(202);
    expect(await feedbackResponse.json()).toEqual({ status: 'skipped_no_sink' });

    const missingRunFeedbackResponse = await fetch(`http://127.0.0.1:${port}/api/runs/missing-run/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'positive' }),
    });
    expect(missingRunFeedbackResponse.status).toBe(404);

    const toolResultResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/tool-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'A' }),
    });
    expect(toolResultResponse.status).toBe(400);
    expect(await toolResultResponse.json()).toMatchObject({
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('delegates /api/runs execution to the configured agent starter', async () => {
    const startedRequests: Record<string, unknown>[] = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ request }) => {
          startedRequests.push(request);
        },
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        prompt: 'Build a small page',
        agentId: 'claude',
        model: 'claude:opus',
        skillId: 'landing',
      }),
    });

    expect(createResponse.status).toBe(202);
    expect(startedRequests).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        prompt: 'Build a small page',
        agentId: 'claude',
        model: 'claude:opus',
        skillId: 'landing',
      }),
    ]);
  });

  it('keeps managed agent invocation credentials out of starter requests and status responses', async () => {
    const started: Array<{
      run: ChatRun;
      request: Record<string, unknown>;
      managedAgentRunContext?: ManagedAgentRunContext;
    }> = [];
    const observedContexts: Array<DetectContext | undefined> = [];
    const runtimeRoot = await createRuntimeDir();
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentAvailability: async (context) => {
          observedContexts.push(context);
          return [
            { id: 'codex', label: 'Codex', available: true },
            { id: 'claude', label: 'Claude Code', available: true },
          ];
        },
        startAgentRun: ({ run, request, managedAgentRunContext }) => {
          started.push({ run, request, managedAgentRunContext });
        },
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-header-1',
      },
      body: JSON.stringify({
        projectId: 'project-managed-agent',
        prompt: 'Build a small page',
        agentId: 'codex',
        managedAgentInvocationCredential: 'credential-run-body-ignored',
      }),
    });

    expect(createResponse.status).toBe(202);
    const created = await createResponse.json() as { runId: string };
    expect(started).toHaveLength(1);
    expect(observedContexts[0]?.env).not.toHaveProperty('TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL');
    expect(observedContexts[0]?.managedAgentInvocation).toEqual({
      credential: 'credential-header-1',
      cwd: runtimeRoot,
    });
    expect(started[0]?.run).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.request).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.managedAgentRunContext?.managedAgentInvocation).toEqual({
      credential: 'credential-header-1',
      cwd: started[0]?.managedAgentRunContext?.cwd,
    });
    expect(started[0]?.managedAgentRunContext?.cwd).toContain(join(runtimeRoot, '.agent-runs', 'codex-'));

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}`);
    expect(statusResponse.status).toBe(200);
    const statusBody = JSON.stringify(await statusResponse.json());
    expect(statusBody).not.toContain('credential-header-1');
    expect(statusBody).not.toContain('credential-run-body-ignored');
  });

  it('uses managed agent invocation credentials from request headers when creating runs', async () => {
    const started: Array<{
      run: ChatRun;
      request: Record<string, unknown>;
      managedAgentRunContext?: ManagedAgentRunContext;
    }> = [];
    const observedContexts: Array<DetectContext | undefined> = [];
    const runtimeRoot = await createRuntimeDir();
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentAvailability: async (context) => {
          observedContexts.push(context);
          return [
            { id: 'codex', label: 'Codex', available: true },
          ];
        },
        startAgentRun: ({ run, request, managedAgentRunContext }) => {
          started.push({ run, request, managedAgentRunContext });
        },
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-run-header-1',
      },
      body: JSON.stringify({
        projectId: 'project-managed-agent-header',
        prompt: 'Build a small page',
        agentId: 'codex',
      }),
    });

    expect(createResponse.status).toBe(202);
    const created = await createResponse.json() as { runId: string };
    expect(started).toHaveLength(1);
    expect(observedContexts[0]?.env).not.toHaveProperty('TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL');
    expect(observedContexts[0]?.managedAgentInvocation).toEqual({
      credential: 'credential-run-header-1',
      cwd: runtimeRoot,
    });
    expect(started[0]?.run).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.request).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.managedAgentRunContext?.managedAgentInvocation).toEqual({
      credential: 'credential-run-header-1',
      cwd: started[0]?.managedAgentRunContext?.cwd,
    });
    expect(started[0]?.managedAgentRunContext?.cwd).toContain(join(runtimeRoot, '.agent-runs', 'codex-'));

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}`);
    expect(statusResponse.status).toBe(200);
    expect(JSON.stringify(await statusResponse.json())).not.toContain('credential-run-header-1');
  });

  it('ignores legacy chat body managed agent invocation credentials', async () => {
    const started: Array<{ run: ChatRun; request: Record<string, unknown> }> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ run, runs, request }) => {
          started.push({ run, request });
          runs.finish(run, 'succeeded');
        },
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-managed-agent-chat',
        prompt: 'Build a small page',
        agentId: 'codex',
        managedAgentInvocationCredential: 'credential-chat-body-ignored',
      }),
    });
    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(started).toHaveLength(1);
    expect(started[0]?.run).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.request).not.toHaveProperty('managedAgentInvocationCredential');
    expect(streamText).not.toContain('credential-chat-body-ignored');
  });

  it('uses managed agent invocation credentials from request headers for legacy chat', async () => {
    const started: Array<{
      run: ChatRun;
      request: Record<string, unknown>;
      managedAgentRunContext?: ManagedAgentRunContext;
    }> = [];
    const observedContexts: Array<DetectContext | undefined> = [];
    const runtimeRoot = await createRuntimeDir();
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        detectAgentAvailability: async (context) => {
          observedContexts.push(context);
          return [
            { id: 'codex', label: 'Codex', available: true },
          ];
        },
        startAgentRun: ({ run, runs, request, managedAgentRunContext }) => {
          started.push({ run, request, managedAgentRunContext });
          runs.finish(run, 'succeeded');
        },
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER]: 'credential-chat-header-1',
      },
      body: JSON.stringify({
        projectId: 'project-managed-agent-chat-header',
        prompt: 'Build a small page',
        agentId: 'codex',
      }),
    });
    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(started).toHaveLength(1);
    expect(observedContexts[0]?.env).not.toHaveProperty('TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL');
    expect(observedContexts[0]?.managedAgentInvocation).toEqual({
      credential: 'credential-chat-header-1',
      cwd: runtimeRoot,
    });
    expect(started[0]?.run).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.request).not.toHaveProperty('managedAgentInvocationCredential');
    expect(started[0]?.managedAgentRunContext?.managedAgentInvocation).toEqual({
      credential: 'credential-chat-header-1',
      cwd: started[0]?.managedAgentRunContext?.cwd,
    });
    expect(started[0]?.managedAgentRunContext?.cwd).toContain(join(runtimeRoot, '.agent-runs', 'codex-'));
    expect(streamText).not.toContain('credential-chat-header-1');
  });

  it('keeps a conversation provider locked while updating its remembered model for same-provider runs', async () => {
    const startedRequests: Record<string, unknown>[] = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ request }) => {
          startedRequests.push(request);
        },
      }),
    );

    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-model-lock',
        prompt: 'Build a small page',
        agentId: 'codex',
        model: 'codex:gpt-5.4',
      }),
    });
    expect(firstResponse.status).toBe(202);
    const firstRun = (await firstResponse.json()) as { conversationId: string };

    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-model-lock',
        conversationId: firstRun.conversationId,
        prompt: 'Try a newer Codex model',
        agentId: 'codex',
        model: 'codex:gpt-5.5',
      }),
    });

    expect(secondResponse.status).toBe(202);
    expect(startedRequests).toEqual([
      expect.objectContaining({ agentId: 'codex', model: 'codex:gpt-5.4' }),
      expect.objectContaining({ agentId: 'codex', model: 'codex:gpt-5.5' }),
    ]);

    const conversationsResponse = await fetch(`http://127.0.0.1:${port}/api/projects/project-model-lock/conversations`);
    expect(conversationsResponse.status).toBe(200);
    expect(await conversationsResponse.json()).toMatchObject({
      conversations: [
        expect.objectContaining({
          id: firstRun.conversationId,
          provider: 'codex',
          model: 'codex:gpt-5.5',
        }),
      ],
    });
  });

  it('rejects /api/runs when the requested local agent is unavailable', async () => {
    const startedRequests: Record<string, unknown>[] = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        detectAgentAvailability: async () => [
          { id: 'codex', label: 'Codex', available: true },
          { id: 'claude', label: 'Claude Code', available: false, unavailableReason: 'Claude Code is not installed.' },
        ],
        startAgentRun: ({ request }) => {
          startedRequests.push(request);
        },
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        prompt: 'Build a small page',
        agentId: 'claude',
      }),
    });

    expect(createResponse.status).toBe(409);
    expect(await createResponse.json()).toMatchObject({
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: 'Claude Code is not installed.',
      },
    });
    expect(startedRequests).toEqual([]);
  });

  it('defaults /api/runs execution to codex when no agent is provided', async () => {
    const startedRuns: Array<{ agentId: string | null; request: Record<string, unknown> }> = [];
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ run, request }) => {
          startedRuns.push({ agentId: run.agentId, request });
        },
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        prompt: 'Build a small page',
      }),
    });

    expect(createResponse.status).toBe(202);
    expect(startedRuns).toEqual([
      {
        agentId: 'codex',
        request: expect.objectContaining({
          projectId: 'project-1',
          prompt: 'Build a small page',
        }),
      },
    ]);
  });

  it('writes tool results to stream-json stdin and closes it when no host answers remain', async () => {
    const stdinWrites: string[] = [];
    const fakeChild = {
      exitCode: null,
      signalCode: null,
      stdin: {
        destroyed: false,
        writableEnded: false,
        write: (chunk: string | Buffer) => {
          stdinWrites.push(String(chunk));
          return true;
        },
        end: () => {
          fakeChild.stdin.writableEnded = true;
        },
      },
      kill: () => true,
    };
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ run }) => {
          run.child = fakeChild as never;
          run.stdinOpen = true;
          run.pendingHostAnswers.add('tool-1');
        },
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        prompt: 'Build a small page',
        agentId: 'claude',
      }),
    });
    const created = (await createResponse.json()) as { runId: string };

    const toolResultResponse = await fetch(`http://127.0.0.1:${port}/api/runs/${created.runId}/tool-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolUseId: 'tool-1', content: 'Use option A' }),
    });

    expect(toolResultResponse.status).toBe(200);
    expect(await toolResultResponse.json()).toEqual({ ok: true });
    expect(JSON.parse(stdinWrites[0] ?? '{}')).toMatchObject({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'Use option A',
          },
        ],
      },
    });
    expect(fakeChild.stdin.writableEnded).toBe(true);
  });

  it('rejects unsafe chat and cross-origin API requests', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const missingProjectResponse = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(missingProjectResponse.status).toBe(400);
    expect(await missingProjectResponse.json()).toMatchObject({
      error: { code: 'BAD_REQUEST' },
    });

    const previewProxyOriginResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:33793',
      },
      body: JSON.stringify({ prompt: 'hello through preview proxy', projectKind: 'prototype' }),
    });
    expect(previewProxyOriginResponse.status).toBe(201);

    const remotePreviewHostResponse = await postJsonWithHeaders(
      port,
      '/api/projects',
      {
        host: '33793-i4vtfk8xfk5cmnenyetku.e2b.app',
        origin: 'http://localhost:33793',
        'sec-fetch-site': 'same-origin',
      },
      { prompt: 'hello through remote preview host', projectKind: 'prototype' },
    );
    expect(remotePreviewHostResponse.status).toBe(201);

    const wildcardPreviewHostResponse = await postJsonWithHeaders(
      port,
      '/api/projects',
      {
        host: '0.0.0.0:33793',
        origin: 'http://localhost:33793',
      },
      { prompt: 'hello through wildcard preview host', projectKind: 'prototype' },
    );
    expect(wildcardPreviewHostResponse.status).toBe(201);

    const spoofedPreviewOriginResponse = await postJsonWithHeaders(
      port,
      '/api/projects',
      {
        host: '33793-i4vtfk8xfk5cmnenyetku.e2b.app',
        origin: 'http://localhost:33793',
        'sec-fetch-site': 'cross-site',
      },
      { prompt: 'hello through spoofed preview origin', projectKind: 'prototype' },
    );
    expect(spoofedPreviewOriginResponse.status).toBe(403);
    expect(spoofedPreviewOriginResponse.body).toMatchObject({
      error: { code: 'FORBIDDEN_ORIGIN' },
    });

    const crossOriginResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.com',
      },
      body: JSON.stringify({ projectId: 'project-1', prompt: 'hello' }),
    });
    expect(crossOriginResponse.status).toBe(403);
    expect(await crossOriginResponse.json()).toMatchObject({
      error: { code: 'FORBIDDEN_ORIGIN' },
    });
  });

  it('persists project tabs-state and supports flat project file CRUD', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const baseUrl = `http://127.0.0.1:${port}/api/projects/project-1`;

    const tabsState = {
      tabs: [
        { kind: 'file', name: 'index.html', key: 'file:index.html' },
        { kind: 'live-artifact', id: 'artifact-1', label: 'Preview', key: 'live:artifact-1' },
      ],
      activeTabKey: 'file:index.html',
    };
    const tabsResponse = await fetch(`${baseUrl}/tabs-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tabsState),
    });
    expect(tabsResponse.status).toBe(200);
    expect(await tabsResponse.json()).toEqual({ ok: true });

    const badTabsResponse = await fetch(`${baseUrl}/tabs-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tabs: [{ kind: 'file', key: 'missing-name' }],
        activeTabKey: 'missing-name',
      }),
    });
    expect(badTabsResponse.status).toBe(400);

    const projectResponse = await fetch(baseUrl);
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: {
        id: 'project-1',
        designSystemId: null,
        tabsState,
      },
    });

    const createFileResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'index.html', content: '<main>Track 1</main>' }),
    });
    expect(createFileResponse.status).toBe(200);
    const createFilePayload = await createFileResponse.json();
    expect(createFilePayload).toMatchObject({
      file: { name: 'index.html', kind: 'html' },
    });
    expect(createFilePayload.file.url).toBe(`http://127.0.0.1:${port}/static/projects/project-1/assets/index.html`);

    const markdownFileResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'design.md', content: '# Design brief\n' }),
    });
    expect(markdownFileResponse.status).toBe(200);
    expect(await markdownFileResponse.json()).toMatchObject({
      file: { name: 'design.md', kind: 'text', mime: 'text/markdown; charset=utf-8' },
    });

    const formData = new FormData();
    formData.set('file', new Blob(['body { color: red; }'], { type: 'text/css' }), 'style.css');
    const multipartResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      body: formData,
    });
    expect(multipartResponse.status).toBe(200);
    expect(await multipartResponse.json()).toMatchObject({
      file: { name: 'style.css', kind: 'css' },
    });

    const unicodeFormData = new FormData();
    unicodeFormData.set('file', new Blob(['name,value\n主题,设计'], { type: 'text/csv' }), '中文.csv');
    const unicodeMultipartResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      body: unicodeFormData,
    });
    expect(unicodeMultipartResponse.status).toBe(200);
    expect(await unicodeMultipartResponse.json()).toMatchObject({
      file: { name: '中文.csv', kind: 'file', mime: 'text/csv' },
    });

    const listResponse = await fetch(`${baseUrl}/files`);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      files: [
        {
          name: 'design.md',
          kind: 'text',
          url: `http://127.0.0.1:${port}/static/projects/project-1/assets/design.md`,
        },
        {
          name: 'index.html',
          kind: 'html',
          url: `http://127.0.0.1:${port}/static/projects/project-1/assets/index.html`,
        },
        {
          name: 'style.css',
          kind: 'css',
          url: `http://127.0.0.1:${port}/static/projects/project-1/assets/style.css`,
        },
        {
          name: '中文.csv',
          kind: 'file',
          url: `http://127.0.0.1:${port}/static/projects/project-1/assets/${encodeURIComponent('中文.csv')}`,
        },
      ],
    });

    const rawResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('index.html')}`);
    expect(rawResponse.status).toBe(200);
    expect(await rawResponse.text()).toBe('<main>Track 1</main>');

    const staticResponse = await fetch(`http://127.0.0.1:${port}/static/projects/project-1/assets/index.html`);
    expect(staticResponse.status).toBe(200);
    expect(staticResponse.headers.get('content-type')).toContain('text/html');
    expect(await staticResponse.text()).toBe('<main>Track 1</main>');

    const unicodeRawResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('中文.csv')}`);
    expect(unicodeRawResponse.status).toBe(200);
    expect(await unicodeRawResponse.text()).toBe('name,value\n主题,设计');

    const previewResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('index.html')}?vdPreviewScrollbar=1`);
    const previewHtml = await previewResponse.text();
    expect(previewResponse.status).toBe(200);
    expect(previewHtml).toContain('data-vd-preview-scrollbar');
    expect(previewHtml).toContain('scrollbar-width:none');
    expect(previewHtml).toContain("thumb.setAttribute('data-vd-preview-scrollbar','thumb')");

    const renameResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('index.html')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'home.html' }),
    });
    expect(renameResponse.status).toBe(200);
    expect(await renameResponse.json()).toMatchObject({
      file: { name: 'home.html', kind: 'html' },
    });

    const deleteResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('home.html')}`, {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });
  });

  it('stores uploaded file contents under project assets and keeps only metadata in sqlite', async () => {
    const currentRuntimeDir = await createRuntimeDir();
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: currentRuntimeDir }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Asset project', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { project: { id: string } };
    const baseUrl = `http://127.0.0.1:${port}/api/projects/${created.project.id}`;

    const firstForm = new FormData();
    firstForm.set('file', new Blob(['first-image'], { type: 'image/png' }), 'hero.png');
    const firstResponse = await fetch(`${baseUrl}/files`, { method: 'POST', body: firstForm });
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      file: { name: 'hero.png', kind: 'image', size: 11, mime: 'image/png' },
    });

    const secondForm = new FormData();
    secondForm.set('file', new Blob(['second-image'], { type: 'image/png' }), 'hero.png');
    const secondResponse = await fetch(`${baseUrl}/files`, { method: 'POST', body: secondForm });
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({
      file: { name: 'hero-2.png', kind: 'image', size: 12, mime: 'image/png' },
    });

    await expect(readFile(join(currentRuntimeDir, 'projects', created.project.id, 'assets', 'hero.png'), 'utf8')).resolves.toBe('first-image');
    await expect(readFile(join(currentRuntimeDir, 'projects', created.project.id, 'assets', 'hero-2.png'), 'utf8')).resolves.toBe('second-image');

    const projectsDir = join(currentRuntimeDir, 'projects');
    const columns = getStore(projectsDir).prepare('PRAGMA table_info(project_files)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('content');
    expect(listProjectFilesFromStore(projectsDir, created.project.id)).toEqual([
      { name: 'hero-2.png', path: 'assets/hero-2.png', size: 12, mtime: expect.any(String), mime: 'image/png', kind: 'image' },
      { name: 'hero.png', path: 'assets/hero.png', size: 11, mtime: expect.any(String), mime: 'image/png', kind: 'image' },
    ]);

    const rawFirstResponse = await fetch(`${baseUrl}/files/${encodeURIComponent('hero.png')}`);
    expect(rawFirstResponse.status).toBe(200);
    expect(rawFirstResponse.headers.get('content-type')).toBe('image/png');
    expect(await rawFirstResponse.text()).toBe('first-image');
  });

  it('stores no-project uploaded files under public assets with sqlite metadata', async () => {
    const currentRuntimeDir = await createRuntimeDir();
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: currentRuntimeDir }));

    const firstForm = new FormData();
    firstForm.set('file', new Blob(['public-first'], { type: 'image/png' }), 'reference.png');
    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/assets`, { method: 'POST', body: firstForm });
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      file: { name: 'reference.png', path: 'assets/reference.png', kind: 'image', size: 12, mime: 'image/png' },
    });

    const secondForm = new FormData();
    secondForm.set('file', new Blob(['public-second'], { type: 'image/png' }), 'reference.png');
    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/assets`, { method: 'POST', body: secondForm });
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({
      file: { name: 'reference-2.png', path: 'assets/reference-2.png', kind: 'image', size: 13, mime: 'image/png' },
    });

    await expect(readFile(join(currentRuntimeDir, 'assets', 'reference.png'), 'utf8')).resolves.toBe('public-first');
    await expect(readFile(join(currentRuntimeDir, 'assets', 'reference-2.png'), 'utf8')).resolves.toBe('public-second');

    const projectsDir = join(currentRuntimeDir, 'projects');
    const columns = getStore(projectsDir).prepare('PRAGMA table_info(public_assets)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('content');
    expect(listPublicAssetsFromStore(projectsDir)).toEqual([
      { name: 'reference-2.png', path: 'assets/reference-2.png', size: 13, mtime: expect.any(String), mime: 'image/png', kind: 'image' },
      { name: 'reference.png', path: 'assets/reference.png', size: 12, mtime: expect.any(String), mime: 'image/png', kind: 'image' },
    ]);

    const rawResponse = await fetch(`http://127.0.0.1:${port}/api/assets/${encodeURIComponent('reference.png')}`);
    expect(rawResponse.status).toBe(200);
    expect(rawResponse.headers.get('content-type')).toBe('image/png');
    expect(await rawResponse.text()).toBe('public-first');
  });

  it('creates a project from dashboard input metadata', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '我想生成一个登陆页',
        projectKind: 'prototype',
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: {
        id: string;
        metadata: Record<string, unknown>;
      };
      conversationId: string;
    };
    expect(created.project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(created.conversationId).toMatch(/^conversation-[0-9a-f-]{8}$/);
    expect(created.project.metadata).toMatchObject({
      title: '我想生成一个登陆页',
      prompt: '我想生成一个登陆页',
      projectKind: 'prototype',
    });

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`);
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: {
        id: created.project.id,
        metadata: {
          title: '我想生成一个登陆页',
          prompt: '我想生成一个登陆页',
          projectKind: 'prototype',
        },
      },
    });

    const conversationsResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations`,
    );
    expect(conversationsResponse.status).toBe(200);
    expect(await conversationsResponse.json()).toMatchObject({
      conversations: [
        {
          id: created.conversationId,
          projectId: created.project.id,
          title: 'New conversation',
        },
      ],
    });

    const messagesResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/${created.conversationId}/messages`,
    );
    expect(messagesResponse.status).toBe(200);
    expect(await messagesResponse.json()).toMatchObject({
      messages: [],
    });

    expect((await stat(join(runtimeDir ?? '', 'vibe-design.sqlite'))).isFile()).toBe(true);
    await expect(access(join(runtimeDir ?? '', 'projects', created.project.id))).rejects.toThrow();
  });

  it('creates a default empty conversation when project title differs from prompt', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '品牌官网项目',
        prompt: '先做一个科技品牌官网首页。第二句话用于补充视觉方向。',
        projectKind: 'prototype',
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: {
        id: string;
        metadata: Record<string, unknown>;
      };
      conversationId: string;
    };
    expect(created.project.metadata).toMatchObject({
      title: '品牌官网项目',
      prompt: '先做一个科技品牌官网首页。第二句话用于补充视觉方向。',
    });

    const conversationsResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations`,
    );
    expect(conversationsResponse.status).toBe(200);
    expect(await conversationsResponse.json()).toMatchObject({
      conversations: [
        {
          id: created.conversationId,
          title: 'New conversation',
        },
      ],
    });

    const messagesResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/${created.conversationId}/messages`,
    );
    expect(messagesResponse.status).toBe(200);
    expect(await messagesResponse.json()).toMatchObject({ messages: [] });
  });

  it('creates a project bound to a known design system', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'atelier-zero', {
      title: 'Atelier Zero',
      category: 'Editorial',
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a branded dashboard',
        projectKind: 'prototype',
        designSystemId: 'atelier-zero',
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: { id: string; designSystemId: string | null };
    };
    expect(created.project.designSystemId).toBe('atelier-zero');

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`);
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: { id: created.project.id, designSystemId: 'atelier-zero' },
    });
  });

  it('updates a project design system when the selected system is known', async () => {
    const designSystemsRoot = await createTempRoot();
    await writeDesignSystem(designSystemsRoot, 'atelier-zero', {
      title: 'Atelier Zero',
      category: 'Editorial',
    });
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: designSystemsRoot,
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a branded dashboard',
        projectKind: 'prototype',
      }),
    });
    const created = (await createResponse.json()) as {
      project: { id: string; designSystemId: string | null };
    };

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: 'atelier-zero' }),
    });

    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      project: { id: created.project.id, designSystemId: 'atelier-zero' },
    });

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`);
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: { id: created.project.id, designSystemId: 'atelier-zero' },
    });
  });

  it('updates a project title without changing existing metadata', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a branded dashboard',
        projectKind: 'prototype',
      }),
    });
    const created = (await createResponse.json()) as {
      project: { id: string; metadata: Record<string, unknown> };
    };

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated dashboard' }),
    });

    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      project: {
        id: created.project.id,
        metadata: {
          title: 'Updated dashboard',
          prompt: 'Create a branded dashboard',
          projectKind: 'prototype',
        },
      },
    });

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`);
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: {
        id: created.project.id,
        metadata: {
          title: 'Updated dashboard',
          prompt: 'Create a branded dashboard',
          projectKind: 'prototype',
        },
      },
    });
  });

  it('rejects unknown design systems when updating a project', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: await createTempRoot(),
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a branded dashboard',
        projectKind: 'prototype',
      }),
    });
    const created = (await createResponse.json()) as {
      project: { id: string; designSystemId: string | null };
    };

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: 'missing-system' }),
    });

    expect(updateResponse.status).toBe(400);
    expect(await updateResponse.json()).toMatchObject({
      error: {
        code: 'DESIGN_SYSTEM_NOT_FOUND',
        message: 'design system not found',
      },
    });
  });

  it('rejects unknown design systems when creating a project', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        builtInDesignSystemsRoot: await createTempRoot(),
        userDesignSystemsRoot: await createTempRoot(),
      }),
    );

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a branded dashboard',
        projectKind: 'prototype',
        designSystemId: 'missing-system',
      }),
    });

    expect(createResponse.status).toBe(400);
    expect(await createResponse.json()).toMatchObject({
      error: {
        code: 'DESIGN_SYSTEM_NOT_FOUND',
        message: 'design system not found',
      },
    });
  });

  it('persists chat turns and assistant run events into the project conversation', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ run, runs }) => {
          runs.emit(run, 'agent', { type: 'text_delta', delta: '收到，开始设计。' });
          runs.emit(run, 'text_delta', { type: 'text_delta', delta: '继续完善。' });
          runs.emit(run, 'agent', { type: 'thinking_delta', delta: '布局优先。' });
          runs.finish(run, 'succeeded', 0, null);
        },
      }),
    );

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '生成一个项目管理页', projectKind: 'prototype' }),
    });
    expect(projectResponse.status).toBe(201);
    const projectPayload = (await projectResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };
    const baseCommentAttachment = {
      order: 1.6,
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      comment: 'Tighten the hero spacing'.repeat(80),
      currentText: 'Current heading text'.repeat(20),
      pagePosition: { x: 4.4, y: -2, width: 320.2, height: 80.9 },
      htmlHint: '<h1 id="hero-title">Current heading text</h1>'.repeat(8),
      style: { color: 'rgb(10, 20, 30)', fontSize: 24, unknown: 'drop me' },
      selectionKind: 'element',
      source: 'board-batch',
    };

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectPayload.project.id,
        prompt: '加一个表格和筛选器',
        agentId: 'claude',
        attachments: [
          {
            path: 'assets/reference.png',
            name: 'reference.png',
            kind: 'image',
            size: 128,
            mimeType: 'image/png',
          },
        ],
        messageContext: {
          selectedDesignFiles: [
            {
              id: 'file-1',
              name: 'design-preview-navy-coral.html',
              path: 'design-preview-navy-coral.html',
              size: 2048,
              mtime: 1,
              kind: 'html',
              mime: 'text/html',
            },
          ],
        },
        commentAttachments: [
          ...Array.from({ length: 30 }, () => ({ id: 'missing-required-fields' })),
          'ignore-me',
          null,
          { id: 'visual-without-mark', order: 2, filePath: 'index.html', targetId: 'mark', selector: '#mark', label: 'Mark', comment: 'Fix', currentText: 'Text', pagePosition: { x: 1, y: 1, width: 1, height: 1 }, htmlHint: '<div>Text</div>', selectionKind: 'visual', source: 'visual-mark' },
          {
            id: 'saved-visual-comment',
            order: 1,
            filePath: 'index.html',
            targetId: 'visual-mark',
            selector: 'body',
            label: 'Marked area',
            comment: 'Adjust this saved visual comment',
            currentText: '',
            pagePosition: { x: 11.2, y: 22.8, width: 33.1, height: 44.9 },
            htmlHint: '',
            selectionKind: 'visual',
            source: 'saved-comment',
            markKind: ' box ',
            screenshotPath: 'screenshots/saved-visual.png',
            intent: 'Tune the highlighted region',
          },
          { ...baseCommentAttachment, id: 'empty-context', currentText: '', htmlHint: '' },
          ...Array.from({ length: 25 }, (_, index) => ({ ...baseCommentAttachment, id: `comment-${index + 1}` })),
        ],
      }),
    });

    expect(runResponse.status).toBe(202);
    const runPayload = (await runResponse.json()) as {
      runId: string;
      conversationId: string;
      assistantMessageId: string;
    };
    expect(runPayload.conversationId).toBe(projectPayload.conversationId);
    expect(runPayload.assistantMessageId).toMatch(/^assistant-[0-9a-f-]{8}$/);

    const messagesResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${projectPayload.project.id}/conversations/${runPayload.conversationId}/messages`,
    );
    expect(messagesResponse.status).toBe(200);
    const messagesPayload = (await messagesResponse.json()) as {
      messages: Array<{ commentAttachments?: unknown[] }>;
    };
    expect(messagesPayload.messages[0]?.commentAttachments).toHaveLength(20);
    expect(messagesPayload.messages[0]?.commentAttachments?.[0]).toMatchObject({
      id: 'saved-visual-comment',
      source: 'saved-comment',
      selectionKind: 'visual',
      markKind: 'box',
      screenshotPath: 'screenshots/saved-visual.png',
      intent: 'Tune the highlighted region',
      pagePosition: { x: 11, y: 23, width: 33, height: 45 },
    });
    expect(messagesPayload.messages[0]?.commentAttachments?.[1]).toMatchObject({
      id: 'empty-context',
      currentText: '',
      htmlHint: '',
    });
    expect(messagesPayload.messages[0]?.commentAttachments?.[2]).toMatchObject({
      id: 'comment-1',
      order: 2,
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      comment: 'Tighten the hero spacing'.repeat(80).slice(0, 1000),
      currentText: 'Current heading text'.repeat(20).slice(0, 160),
      pagePosition: { x: 4, y: 0, width: 320, height: 81 },
      htmlHint: '<h1 id="hero-title">Current heading text</h1>'.repeat(8).slice(0, 180),
      style: { color: 'rgb(10, 20, 30)' },
      selectionKind: 'element',
      source: 'board-batch',
    });
    expect(messagesPayload.messages[0]?.commentAttachments?.at(-1)).toMatchObject({ id: 'comment-18' });
    expect(messagesPayload).toMatchObject({
      messages: [
        {
          role: 'user',
          content: '加一个表格和筛选器',
          attachments: [
            {
              path: 'assets/reference.png',
              name: 'reference.png',
              kind: 'image',
              size: 128,
              mimeType: 'image/png',
            },
          ],
          context: {
            selectedDesignFiles: [
              {
                id: 'file-1',
                name: 'design-preview-navy-coral.html',
                path: 'design-preview-navy-coral.html',
                size: 2048,
                mtime: 1,
                kind: 'html',
                mime: 'text/html',
              },
            ],
          },
          position: 1,
        },
        {
          id: runPayload.assistantMessageId,
          role: 'assistant',
          content: '收到，开始设计。继续完善。',
          runId: runPayload.runId,
          runStatus: 'succeeded',
          position: 2,
          events: [
            { type: 'text_delta', eventId: 1, delta: '收到，开始设计。' },
            { type: 'text_delta', eventId: 2, delta: '继续完善。' },
            { type: 'thinking_delta', eventId: 3, delta: '布局优先。' },
            { type: 'end', eventId: 4, status: 'succeeded' },
          ],
        },
      ],
    });
  });

  it('materializes streamed HTML artifacts as project files even without a browser save callback', async () => {
    const runtimeRoot = await createRuntimeDir();
    const artifactHtml = '<!doctype html><html><body><main>Festival Guide</main></body></html>';
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: runtimeRoot,
        startAgentRun: ({ run, runs }) => {
          runs.emit(run, 'text_delta', {
            type: 'text_delta',
            delta:
              'Here is the page.\n<artifact identifier="music-festival-guide" type="text/html" title="音乐节指南 — Festival Guide">',
          });
          runs.emit(run, 'text_delta', { type: 'text_delta', delta: artifactHtml });
          runs.emit(run, 'text_delta', { type: 'text_delta', delta: '</artifact>' });
          runs.finish(run, 'succeeded', 0, null);
        },
      }),
    );

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '生成一个音乐节指南', projectKind: 'prototype' }),
    });
    expect(projectResponse.status).toBe(201);
    const projectPayload = (await projectResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectPayload.project.id,
        conversationId: projectPayload.conversationId,
        prompt: 'Build the festival guide page',
      }),
    });
    expect(runResponse.status).toBe(202);

    const filesResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${projectPayload.project.id}/files`);
    expect(filesResponse.status).toBe(200);
    await expect(filesResponse.json()).resolves.toMatchObject({
      files: [
        {
          name: 'music-festival-guide.html',
          path: 'assets/music-festival-guide.html',
          kind: 'html',
          mime: 'text/html',
        },
      ],
    });
    await expect(
      readFile(join(runtimeRoot, 'projects', projectPayload.project.id, 'assets', 'music-festival-guide.html'), 'utf8'),
    ).resolves.toBe(artifactHtml);
  });

  it('backfills project files from persisted artifact events when opening an existing project', async () => {
    const runtimeRoot = await createRuntimeDir();
    const projectsDir = join(runtimeRoot, 'projects');
    const projectId = 'legacy-artifact-project';
    const conversationId = 'conversation-legacy';
    const artifactHtml = '<!doctype html><html><body><main>Legacy Festival Guide</main></body></html>';
    writeProjectToStore(projectsDir, {
      id: projectId,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: { title: 'Legacy artifact project', prompt: 'Build a festival guide', projectKind: 'prototype' },
    });
    createConversationInStore(projectsDir, projectId, conversationId, 'Legacy artifact');
    upsertMessageInStore(projectsDir, projectId, conversationId, {
      id: 'assistant-legacy',
      role: 'assistant',
      content: `Here is the page.\n${artifactHtml}`,
      runId: 'run-legacy',
      runStatus: 'succeeded',
      events: [
        {
          type: 'text_delta',
          delta:
            'Here is the page.\n<artifact identifier="legacy-festival-guide" type="text/html" title="Legacy Festival Guide">',
        },
        { type: 'text_delta', delta: artifactHtml },
        { type: 'text_delta', delta: '</artifact>' },
        { type: 'end', status: 'succeeded' },
      ],
    });
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: runtimeRoot }));

    const response = await fetch(`http://127.0.0.1:${port}/project/${projectId}`);

    expect(response.status).toBe(200);
    expect(listProjectFilesFromStore(projectsDir, projectId)).toMatchObject([
      {
        name: 'legacy-festival-guide.html',
        path: 'assets/legacy-festival-guide.html',
        kind: 'html',
        mime: 'text/html',
      },
    ]);
    await expect(
      readFile(join(runtimeRoot, 'projects', projectId, 'assets', 'legacy-festival-guide.html'), 'utf8'),
    ).resolves.toBe(artifactHtml);
  });

  it('does not overwrite edited project files when backfilling persisted artifact events', async () => {
    const runtimeRoot = await createRuntimeDir();
    const projectsDir = join(runtimeRoot, 'projects');
    const projectId = 'edited-artifact-project';
    const conversationId = 'conversation-edited';
    const artifactHtml = '<!doctype html><html><body><main>Legacy Festival Guide</main></body></html>';
    const editedHtml = '<!doctype html><html><body><main style="background-image: url(&quot;/room.png&quot;)">Edited Festival Guide</main></body></html>';
    const fileName = 'legacy-festival-guide.html';
    const assetPath = join(runtimeRoot, 'projects', projectId, 'assets', fileName);
    writeProjectToStore(projectsDir, {
      id: projectId,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      tabsState: { tabs: [], activeTabKey: null },
      metadata: { title: 'Edited artifact project', prompt: 'Build a festival guide', projectKind: 'prototype' },
    });
    createConversationInStore(projectsDir, projectId, conversationId, 'Edited artifact');
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, editedHtml, 'utf8');
    upsertProjectFileInStore(projectsDir, projectId, {
      name: fileName,
      path: `assets/${fileName}`,
      size: Buffer.byteLength(editedHtml),
      kind: 'html',
      mime: 'text/html',
    });
    upsertMessageInStore(projectsDir, projectId, conversationId, {
      id: 'assistant-edited',
      role: 'assistant',
      content: `Here is the page.\n${artifactHtml}`,
      runId: 'run-edited',
      runStatus: 'succeeded',
      events: [
        {
          type: 'text_delta',
          delta:
            'Here is the page.\n<artifact identifier="legacy-festival-guide" type="text/html" title="Legacy Festival Guide">',
        },
        { type: 'text_delta', delta: artifactHtml },
        { type: 'text_delta', delta: '</artifact>' },
        { type: 'end', status: 'succeeded' },
      ],
    });
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: runtimeRoot }));

    const response = await fetch(`http://127.0.0.1:${port}/project/${projectId}`);

    expect(response.status).toBe(200);
    await expect(readFile(assetPath, 'utf8')).resolves.toBe(editedHtml);
    expect(listProjectFilesFromStore(projectsDir, projectId)).toMatchObject([
      {
        name: fileName,
        path: `assets/${fileName}`,
        kind: 'html',
        mime: 'text/html',
        size: Buffer.byteLength(editedHtml),
      },
    ]);
  });

  it('rejects run requests with missing or mismatched conversation ids without persisting', async () => {
    const runtimeRoot = await createRuntimeDir();
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: runtimeRoot }));
    const createProject = async (prompt: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, projectKind: 'prototype' }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { project: { id: string }; conversationId: string };
    };

    const projectA = await createProject('Build project A');
    const projectB = await createProject('Build project B');

    const mismatched = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectA.project.id,
        conversationId: projectB.conversationId,
        prompt: 'This should not persist',
      }),
    });
    expect(mismatched.status).toBe(404);
    await expect(mismatched.json()).resolves.toMatchObject({ error: { code: 'CONVERSATION_NOT_FOUND' } });

    const missing = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectA.project.id,
        conversationId: 'conversation-missing',
        prompt: 'This should not persist either',
      }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: 'CONVERSATION_NOT_FOUND' } });

    const rejectedRunProjectId = 'project-rejected-run';
    const missingForNewProject = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: rejectedRunProjectId,
        conversationId: 'conversation-missing',
        prompt: 'This should not create a project',
      }),
    });
    expect(missingForNewProject.status).toBe(404);
    await expect(missingForNewProject.json()).resolves.toMatchObject({
      error: { code: 'CONVERSATION_NOT_FOUND' },
    });
    expect(projectRowExists(runtimeRoot, rejectedRunProjectId)).toBe(false);

    const rejectedChatProjectId = 'project-rejected-chat';
    const mismatchedForNewProject = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: rejectedChatProjectId,
        conversationId: projectB.conversationId,
        prompt: 'This should not create a project either',
      }),
    });
    expect(mismatchedForNewProject.status).toBe(404);
    await expect(mismatchedForNewProject.json()).resolves.toMatchObject({
      error: { code: 'CONVERSATION_NOT_FOUND' },
    });
    expect(projectRowExists(runtimeRoot, rejectedChatProjectId)).toBe(false);
  });

  it('locks a conversation to the first selected provider and returns provider metadata', async () => {
    const port = await listenOnRandomPort(
      createTestServer({
        runtimeDir: await createRuntimeDir(),
        startAgentRun: ({ run, runs }) => {
          run.providerSessionId = `${run.agentId}-session-1`;
          runs.finish(run, 'succeeded', 0, null);
        },
      }),
    );

    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Build a dashboard', projectKind: 'prototype' }),
    });
    expect(projectResponse.status).toBe(201);
    const projectPayload = (await projectResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };

    const firstRunResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectPayload.project.id,
        conversationId: projectPayload.conversationId,
        prompt: 'Use Claude first',
        agentId: 'claude',
      }),
    });
    expect(firstRunResponse.status).toBe(202);
    await expect(firstRunResponse.json()).resolves.toMatchObject({
      conversationId: projectPayload.conversationId,
      provider: 'claude',
    });

    const conversationsResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${projectPayload.project.id}/conversations`,
    );
    expect(conversationsResponse.status).toBe(200);
    await expect(conversationsResponse.json()).resolves.toMatchObject({
      conversations: [{ id: projectPayload.conversationId, provider: 'claude' }],
    });

    const lockedRunResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectPayload.project.id,
        conversationId: projectPayload.conversationId,
        prompt: 'Try switching',
        agentId: 'codex',
      }),
    });

    expect(lockedRunResponse.status).toBe(409);
    await expect(lockedRunResponse.json()).resolves.toMatchObject({
      error: { code: 'CONVERSATION_PROVIDER_LOCKED' },
    });
  });

  it('lists projects from persisted project metadata with the latest project first', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createProject = async (prompt: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, projectKind: 'prototype' }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { project: { id: string } };
    };

    const first = await createProject('第一个项目');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createProject('最新项目');

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      projects: [
        { id: second.project.id, title: '最新项目', prompt: '最新项目', projectKind: 'prototype' },
        { id: first.project.id, title: '第一个项目', prompt: '第一个项目', projectKind: 'prototype' },
      ],
    });
  });

  it('uses a preferred image project file as the dashboard cover URL', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '带截图的项目', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { project: { id: string } };
    const baseUrl = `http://127.0.0.1:${port}/api/projects/${created.project.id}`;

    const htmlResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'index.html', content: '<main>Preview</main>' }),
    });
    expect(htmlResponse.status).toBe(200);

    const tabsResponse = await fetch(`${baseUrl}/tabs-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tabs: [{ kind: 'file', name: 'index.html', key: 'file:index.html' }],
        activeTabKey: 'file:index.html',
      }),
    });
    expect(tabsResponse.status).toBe(200);

    const fileBody = [
      '--cover-boundary',
      'Content-Disposition: form-data; name="file"; filename="cover.png"',
      'Content-Type: image/png',
      '',
      'fake-png',
      '--cover-boundary--',
      '',
    ].join('\r\n');
    const uploadResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=cover-boundary' },
      body: fileBody,
    });
    expect(uploadResponse.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const laterImageBody = [
      '--visual-boundary',
      'Content-Disposition: form-data; name="file"; filename="visual-comment.svg"',
      'Content-Type: image/svg+xml',
      '',
      '<svg />',
      '--visual-boundary--',
      '',
    ].join('\r\n');
    const laterUploadResponse = await fetch(`${baseUrl}/files`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=visual-boundary' },
      body: laterImageBody,
    });
    expect(laterUploadResponse.status).toBe(200);

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      projects: [
        {
          id: created.project.id,
          coverUrl: `/api/projects/${encodeURIComponent(created.project.id)}/files/cover.png`,
        },
      ],
    });
  });

  it('only includes a dashboard cover URL when the active project tab is an html file', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '带封面限制的项目', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { project: { id: string } };
    const baseUrl = `http://127.0.0.1:${port}/api/projects/${created.project.id}`;

    for (const file of [
      { name: 'index.html', content: '<main>Preview</main>' },
      { name: 'notes.txt', content: 'Notes' },
      { name: 'cover.png', content: Buffer.from('fake-png').toString('base64'), encoding: 'base64' },
    ]) {
      const fileResponse = await fetch(`${baseUrl}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(file),
      });
      expect(fileResponse.status).toBe(200);
    }

    const textTabState = {
      tabs: [
        { kind: 'file', name: 'index.html', key: 'file:index.html' },
        { kind: 'file', name: 'notes.txt', key: 'file:notes.txt' },
      ],
      activeTabKey: 'file:notes.txt',
    };
    const textTabResponse = await fetch(`${baseUrl}/tabs-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(textTabState),
    });
    expect(textTabResponse.status).toBe(200);

    const textActiveListResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
    expect(textActiveListResponse.status).toBe(200);
    const textActiveList = (await textActiveListResponse.json()) as { projects: Array<Record<string, unknown>> };
    expect(textActiveList.projects[0]).toMatchObject({ id: created.project.id });
    expect(textActiveList.projects[0]).not.toHaveProperty('coverUrl');

    const htmlTabResponse = await fetch(`${baseUrl}/tabs-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...textTabState, activeTabKey: 'file:index.html' }),
    });
    expect(htmlTabResponse.status).toBe(200);

    const htmlActiveListResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
    expect(htmlActiveListResponse.status).toBe(200);
    expect(await htmlActiveListResponse.json()).toMatchObject({
      projects: [
        {
          id: created.project.id,
          coverUrl: `/api/projects/${encodeURIComponent(created.project.id)}/files/cover.png`,
        },
      ],
    });
  });

  it('renders recent projects from persisted project metadata on the dashboard', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '最新首页项目', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);

    const dashboardResponse = await fetch(`http://127.0.0.1:${port}/`);
    expect(dashboardResponse.status).toBe(200);
    const html = await dashboardResponse.text();
    expect(html).toContain('最新首页项目');
  });

  it('renders more than four recent projects on the dashboard browser grid', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    for (const prompt of ['项目 1', '项目 2', '项目 3', '项目 4', '项目 5']) {
      const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, projectKind: 'prototype' }),
      });
      expect(createResponse.status).toBe(201);
    }

    const dashboardResponse = await fetch(`http://127.0.0.1:${port}/`);
    expect(dashboardResponse.status).toBe(200);
    const html = await dashboardResponse.text();
    expect(html).toContain('项目 1');
    expect(html).toContain('项目 5');
  });

  it('creates a project from the dashboard form and redirects to the workspace', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));

    const createResponse = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST',
      body: new URLSearchParams({
        prompt: '我想生成一个仪表盘',
        projectKind: 'prototype',
      }),
      redirect: 'manual',
    });

    expect(createResponse.status).toBe(303);
    const location = createResponse.headers.get('location');
    expect(location).toMatch(/^\/project\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const projectId = location?.split('/').pop();
    expect(projectId).toBeTruthy();
    const projectResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}`);
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: {
        id: projectId,
        metadata: {
          title: '我想生成一个仪表盘',
          prompt: '我想生成一个仪表盘',
          projectKind: 'prototype',
        },
      },
    });

    const conversationsResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/conversations`);
    expect(conversationsResponse.status).toBe(200);
    const conversationsPayload = (await conversationsResponse.json()) as { conversations: Array<{ id: string }> };
    const conversationId = conversationsPayload.conversations[0]?.id;
    expect(conversationId).toMatch(/^conversation-[0-9a-f-]{8}$/);
    expect(conversationsPayload.conversations[0]).toMatchObject({ title: 'New conversation' });

    const messagesResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${projectId}/conversations/${conversationId}/messages`,
    );
    expect(messagesResponse.status).toBe(200);
    expect(await messagesResponse.json()).toMatchObject({ messages: [] });
  });

  it('renders project workspace data from persisted sqlite records', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '真实项目', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };

    const fileResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'home.html',
        content: '<main><h1>来自 SQLite 的页面</h1></main>',
        encoding: 'utf8',
      }),
    });
    expect(fileResponse.status).toBe(200);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: created.project.id,
        conversationId: created.conversationId,
        prompt: '把真实文件显示出来',
      }),
    });
    expect(runResponse.status).toBe(202);

    const workspaceResponse = await fetch(`http://127.0.0.1:${port}/project/${created.project.id}`);
    expect(workspaceResponse.status).toBe(200);
    const html = await workspaceResponse.text();
    expect(html).toContain('/client.js');
    expect(html).toContain('home.html');
    expect(html).toContain('来自 SQLite 的页面');
    expect(html).toContain('真实项目');
    expect(html).toContain('把真实文件显示出来');
    expect(html).not.toContain('design-notes.txt');
  });

  it('reconciles generated workspace files from disk into the design files list', async () => {
    const currentRuntimeDir = await createRuntimeDir();
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: currentRuntimeDir }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Legacy generated file project', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { project: { id: string } };
    const projectDir = join(currentRuntimeDir, 'projects', created.project.id);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'legacy-output.html'), '<!doctype html><html><body>Recovered</body></html>');

    expect(listProjectFilesFromStore(join(currentRuntimeDir, 'projects'), created.project.id)).toEqual([]);

    const filesResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/files`);

    expect(filesResponse.status).toBe(200);
    await expect(filesResponse.json()).resolves.toMatchObject({
      files: [
        {
          name: 'legacy-output.html',
          path: 'assets/legacy-output.html',
          kind: 'html',
          mime: 'text/html; charset=utf-8',
        },
      ],
    });
    await expect(readFile(join(projectDir, 'assets', 'legacy-output.html'), 'utf8')).resolves.toBe(
      '<!doctype html><html><body>Recovered</body></html>',
    );
    expect(listProjectFilesFromStore(join(currentRuntimeDir, 'projects'), created.project.id)).toMatchObject([
      {
        name: 'legacy-output.html',
        path: 'assets/legacy-output.html',
        kind: 'html',
      },
    ]);
  });

  it('initializes image files with raw URLs and keeps svg document contents for preview', async () => {
    const currentRuntimeDir = await createRuntimeDir();
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: currentRuntimeDir }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Image project', projectKind: 'image' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { project: { id: string } };

    const formData = new FormData();
    formData.set('file', new Blob(['binary-image-content'], { type: 'image/png' }), 'hero.png');
    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/files`, {
      method: 'POST',
      body: formData,
    });
    expect(uploadResponse.status).toBe(200);

    const svgFormData = new FormData();
    svgFormData.set(
      'file',
      new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml,preview"/></svg>'], {
        type: 'image/svg+xml',
      }),
      'cover.svg',
    );
    const svgUploadResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/files`, {
      method: 'POST',
      body: svgFormData,
    });
    expect(svgUploadResponse.status).toBe(200);

    const workspaceResponse = await fetch(`http://127.0.0.1:${port}/project/${created.project.id}`);
    expect(workspaceResponse.status).toBe(200);
    const html = await workspaceResponse.text();
    expect(html).toContain('hero.png');
    expect(html).toContain(`/api/projects/${created.project.id}/files/hero.png`);
    expect(html).not.toContain('binary-image-content');
    expect(html).toContain('cover.svg');
    expect(html).toContain(`/api/projects/${created.project.id}/files/cover.svg`);
    expect(html).toContain('\\u003csvg xmlns=');
    expect(html).toContain('data:image/svg+xml,preview');
  });

  it('updates conversation titles through the project conversation endpoint', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '初始标题', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };

    const renameResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/${created.conversationId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '重命名后的会话' }),
      },
    );
    expect(renameResponse.status).toBe(200);

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations`);
    expect(await listResponse.json()).toMatchObject({
      conversations: [{ id: created.conversationId, title: '重命名后的会话' }],
    });
  });

  it('deletes conversations through the project conversation endpoint', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '初始标题', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };

    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'conversation-delete-target', title: '待删除会话' }),
    });
    expect(secondResponse.status).toBe(201);

    const deleteResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/conversation-delete-target`,
      { method: 'DELETE' },
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations`);
    expect(await listResponse.json()).toMatchObject({
      conversations: [{ id: created.conversationId }],
    });
    const missingMessagesResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/conversation-delete-target/messages`,
    );
    expect(missingMessagesResponse.status).toBe(404);

    const secondDeleteResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/conversation-delete-target`,
      { method: 'DELETE' },
    );
    expect(secondDeleteResponse.status).toBe(404);
  });

  it('rejects deleting the only project conversation', async () => {
    const port = await listenOnRandomPort(createTestServer({ runtimeDir: await createRuntimeDir() }));
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '初始标题', projectKind: 'prototype' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      project: { id: string };
      conversationId: string;
    };

    const deleteResponse = await fetch(
      `http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations/${created.conversationId}`,
      { method: 'DELETE' },
    );

    expect(deleteResponse.status).toBe(409);
    expect(await deleteResponse.json()).toMatchObject({
      error: { code: 'LAST_CONVERSATION' },
    });

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/projects/${created.project.id}/conversations`);
    expect(await listResponse.json()).toMatchObject({
      conversations: [{ id: created.conversationId }],
    });
  });

  it('serves the chat UI stylesheet asset', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/assets/chat-ui.css`);
    const css = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(css).toContain('.pane');
  });

  it('serves the installed UI-system stylesheet asset', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/assets/@tutti-os/ui-system/styles.css`);
    const css = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(css).toContain('@import "./theme.css"');
  });

  it('serves bundled agent provider icon assets', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/assets/agent-icons/workspace-dock-agent-codex.png`);
    const body = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('serves bundled brand image assets', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/assets/brand/vibedesign.png`);
    const body = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('serves the bundled app icon asset', async () => {
    const port = await listenOnRandomPort(createServer({ runtimeDir: await createRuntimeDir() }));

    const response = await fetch(`http://127.0.0.1:${port}/icon.png`);
    const body = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(body.byteLength).toBeGreaterThan(0);
  });
});

function readSseEvents(text: string): Array<{ event: string; data: unknown }> {
  return text
    .trim()
    .split(/\n\n+/)
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? '';
      const dataText = /^data: (.+)$/m.exec(chunk)?.[1] ?? 'null';
      return { event, data: JSON.parse(dataText) as unknown };
    });
}
