import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import {
  type AgentEvent as AcpAgentEvent,
  type AgentRunInput as AcpAgentRunInput,
  type AgentRunMessage as AcpAgentRunMessage,
  type ManagedAgentRunContext,
} from '@tutti-os/agent-acp-kit';
import type { AgentEvent } from './claude-stream.js';
import { DEFAULT_AGENT_ID, type AgentRegistry } from './agents.js';
import {
  createFileOutputProtocolParser,
  type FileOutputProtocolEvent,
} from './file-output-protocol.js';
import { agentRegistry as defaultAgentRegistry } from './runtimes/index.js';
import {
  listConversationMessages,
  updateConversationResumeMetadata,
  type StoredConversationMessage,
} from './conversations.js';
import { composeSystemPrompt, type ComposeInput } from './prompts/system.js';
import { localAgentRuntime } from './local-agent-runtime.js';
import { findSkillById, listSkills, type SkillInfo } from './skills.js';
import { resolveTuttiAgentSkillBundle, tuttiCliEnv } from './tutti-agent-skill-bundle.js';
import {
  readAvailableDesignSystemDetail,
  resolveDesignSystemAssets,
} from './design-systems.js';
import { getProjectFromStore, listProjectFilesFromStore, upsertProjectFileInStore } from './sqlite-store.js';
import type { ChatRun, ChatRunService } from './types/run.js';

export interface AgentRunRequest {
  [key: string]: unknown;
}

export interface AgentRunPaths {
  projectsDir: string;
  appDataDir?: string;
  userSkillsRoot: string;
  builtInSkillsRoot: string;
  userDesignSystemsRoot?: string;
  builtInDesignSystemsRoot?: string;
}

export interface LocalAgentRuntime {
  run(input: AcpAgentRunInput): AsyncGenerator<AcpAgentEvent>;
  cancel(runId: string): Promise<void>;
}

export interface StartAgentRunInput {
  run: ChatRun;
  runs: ChatRunService;
  request: AgentRunRequest;
  paths: AgentRunPaths;
  registry?: AgentRegistry;
  agentRuntime?: LocalAgentRuntime;
  managedAgentRunContext?: ManagedAgentRunContext;
}

const defaultAgentRuntime: LocalAgentRuntime = localAgentRuntime;

const MAX_AGENT_STDERR_REASON_CHARS = 4_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_MESSAGE_CHARS = 6_000;

export async function startAgentRun(input: StartAgentRunInput): Promise<void> {
  const { run, runs, request, paths } = input;
  const registry = input.registry ?? defaultAgentRegistry;
  const agentRuntime = input.agentRuntime ?? defaultAgentRuntime;
  const agentId = readString(request.agentId) ?? run.agentId ?? DEFAULT_AGENT_ID;
  const agent = registry.getAgentDef(agentId);

  if (!agent) {
    runs.fail(run, 'AGENT_UNAVAILABLE', `unknown agent: ${agentId}`);
    return;
  }

  const userPrompt = readUserPrompt(request);
  if (!userPrompt) {
    runs.fail(run, 'BAD_REQUEST', 'prompt is required');
    return;
  }

  const projectId = readString(request.projectId) ?? run.projectId;
  const projectWorkspaceDir = projectId ? join(paths.projectsDir, projectId) : paths.projectsDir;
  await mkdir(projectWorkspaceDir, { recursive: true });
  const managedAgentInvocation = input.managedAgentRunContext?.managedAgentInvocation;
  const agentCwd = input.managedAgentRunContext?.cwd ?? projectWorkspaceDir;
  const sanitizeManagedEventPayload = createManagedEventPayloadSanitizer(
    input.managedAgentRunContext?.cwd,
    projectWorkspaceDir,
  );

  const locale = readString(request.locale) ?? undefined;
  const skill = await resolveRequestedSkill(request, paths);
  const activeDesignSystem = await resolveProjectDesignSystem(projectId, paths, locale);
  const systemPrompt = composeSystemPrompt({
    agentId,
    skillBody: skill?.body,
    skillName: skill?.name,
    skillMode: skill?.mode as ComposeInput['skillMode'],
    skillDir: skill?.dir,
    locale,
    metadata: readRecord(request.metadata),
    mediaExecution: request.mediaExecution as ComposeInput['mediaExecution'],
    designSystemTitle: activeDesignSystem?.title,
    designSystemUsageMd: activeDesignSystem?.usageMd,
    designSystemBody: activeDesignSystem?.body,
    designSystemTokensCss: activeDesignSystem?.tokensCss,
    designSystemComponentsManifest: activeDesignSystem?.componentsManifest,
    designSystemFixtureHtml: activeDesignSystem?.fixtureHtml,
    designSystemImportMode: activeDesignSystem?.importMode,
    projectWorkspaceDir,
  });
  const prompt = [
    userPrompt,
    ...formatAttachedFilesSection(request.attachments, projectWorkspaceDir),
    ...formatSelectedDesignFilesSection(request.context, projectWorkspaceDir, projectId, paths.projectsDir),
    ...formatAttachedPreviewCommentsSection(request.commentAttachments),
  ].join('\n');
  const history = await buildConversationHistory(paths.projectsDir, run, userPrompt);
  const resume = buildProviderResume(run);
  const tuttiSkillBundle = await resolveTuttiAgentSkillBundle({
    agentSessionId: run.id,
    cwd: resolveTuttiWorkspaceCwd(projectWorkspaceDir),
    provider: agentId,
  });
  const runtimeSystemPrompt = [
    tuttiSkillBundle.recommendedSystemPrompt?.content,
    systemPrompt,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n\n');
  const agentEnv = tuttiCliEnv();

  run.status = 'running';
  run.updatedAt = Date.now();
  runs.emit(run, 'start', {
    runId: run.id,
    agentId,
    provider: agentId,
    projectId,
    cwd: projectWorkspaceDir,
    runtime: 'agent-acp-kit',
  });

  const controller = new AbortController();
  run.acpSession = {
    abort: async () => {
      controller.abort();
      await agentRuntime.cancel(run.id);
    },
  };

  try {
    let stderrTail = '';
    let sawErrorEvent = false;
    let sawInlineQuestionForm = false;
    let sawStructuredUserInputAsk = false;
    const fileOutputParser = createFileOutputProtocolParser();

    const emitVisibleTextDelta = async (delta: string): Promise<boolean> => {
      if (!delta) return false;
      const data: AgentEvent = { type: 'text_delta', delta };
      runs.emit(run, 'text_delta', sanitizeManagedEventPayload(data) as AgentEvent);
      const normalizedDelta = delta.toLowerCase();
      sawInlineQuestionForm ||= normalizedDelta.includes('<question-form');
      if (sawInlineQuestionForm && normalizedDelta.includes('</question-form>')) {
        sawStructuredUserInputAsk = true;
        controller.abort();
        await agentRuntime.cancel(run.id);
        runs.finish(run, 'succeeded', 0);
        return true;
      }
      return false;
    };

    const handleFileOutputProtocolEvent = async (parsed: FileOutputProtocolEvent): Promise<boolean> => {
      if (parsed.type === 'text') {
        return emitVisibleTextDelta(parsed.delta);
      }
      if (parsed.type !== 'file:end') {
        return false;
      }

      const materializedFile = await materializeProjectFileContent(
        paths.projectsDir,
        projectId,
        projectWorkspaceDir,
        parsed.path,
        parsed.fullContent,
        parsed.mime,
      );
      if (materializedFile) {
        runs.emit(run, 'generated_file', {
          type: 'generated_file',
          name: materializedFile.name,
          artifactType: materializedFile.mime,
        });
      }
      return false;
    };

    const flushFileOutputProtocol = async (): Promise<boolean> => {
      for (const parsed of fileOutputParser.flush()) {
        if (await handleFileOutputProtocolEvent(parsed)) {
          return true;
        }
      }
      return false;
    };

    const agentRunInput: AcpAgentRunInput = {
      runId: run.id,
      provider: agentId,
      cwd: agentCwd,
      prompt,
      systemPrompt: runtimeSystemPrompt,
      ...(history.length > 0 ? { history } : {}),
      ...(readString(request.model) ? { model: readString(request.model) ?? undefined } : {}),
      ...(readString(request.reasoning) ? { reasoning: readString(request.reasoning) ?? undefined } : {}),
      ...(managedAgentInvocation ? { managedAgentInvocation } : {}),
      ...(tuttiSkillBundle.skills.length > 0 ? { skillManifest: tuttiSkillBundle.skills } : {}),
      ...(Object.keys(agentEnv).length > 0 ? { env: agentEnv } : {}),
      signal: controller.signal,
      resume,
    };

    for await (const event of agentRuntime.run(agentRunInput)) {
      if (event.type === 'file_write') {
        const materializedFile = await materializeAcpFileWrite(
          paths.projectsDir,
          projectId,
          projectWorkspaceDir,
          event.path,
        );
        if (materializedFile) {
          runs.emit(run, 'generated_file', {
            type: 'generated_file',
            name: materializedFile.name,
            artifactType: materializedFile.mime,
          });
        }
        continue;
      }

      if (event.type === 'text_delta') {
        for (const parsed of fileOutputParser.feed(event.text)) {
          if (await handleFileOutputProtocolEvent(parsed)) {
            return;
          }
        }
        continue;
      }

      if (event.type === 'tool_call') {
        const materializedFile = await materializeAcpWriteToolCall(
          paths.projectsDir,
          projectId,
          projectWorkspaceDir,
          event,
        );
        if (materializedFile) {
          runs.emit(run, 'generated_file', {
            type: 'generated_file',
            name: materializedFile.name,
            artifactType: materializedFile.mime,
          });
        }
      }

      if (event.type === 'stderr') {
        stderrTail = appendStderrTail(stderrTail, event.text);
      }
      const projected = projectAcpAgentEvent(event);
      if (!projected) {
        continue;
      }

      if (projected.kind === 'finish') {
        if (await flushFileOutputProtocol()) {
          return;
        }
        if (projected.status === 'failed' && !sawErrorEvent) {
          const message = readString(stderrTail);
          if (message) {
            runs.emit(run, 'error', {
              code: 'AGENT_EXECUTION_FAILED',
              message: sanitizeManagedEventPayload(message) as string,
            });
            sawErrorEvent = true;
          }
        }
        await persistRunResumeMetadata(paths.projectsDir, run, {
          providerSessionId: projected.providerSessionId,
          resumeToken: projected.resumeToken,
        });
        runs.finish(run, projected.status, projected.exitCode);
        return;
      }

      if (projected.kind === 'error') {
        sawErrorEvent = true;
        runs.fail(run, projected.code, sanitizeManagedEventPayload(projected.message) as string);
        return;
      }

      const projectedData = sanitizeManagedEventPayload(projected.data) as AgentEvent;
      runs.emit(run, projected.event, projectedData);
      const sanitizedProjected = { ...projected, data: projectedData } as ProjectedAcpEvent;
      if (
        sanitizedProjected.kind === 'emit' &&
        sanitizedProjected.event === 'tool_use' &&
        sanitizedProjected.data.type === 'tool_use'
      ) {
        sawStructuredUserInputAsk ||= isUserInputToolName(sanitizedProjected.data.name);
      }
      if (
        sanitizedProjected.kind === 'emit' &&
        sanitizedProjected.event === 'text_delta' &&
        sanitizedProjected.data.type === 'text_delta'
      ) {
        const delta = sanitizedProjected.data.delta.toLowerCase();
        sawInlineQuestionForm ||= delta.includes('<question-form');
      }
      if (shouldStopAfterUserInputAsk(sanitizedProjected, sawInlineQuestionForm)) {
        controller.abort();
        await agentRuntime.cancel(run.id);
        runs.finish(run, 'succeeded', 0);
        return;
      }
    }

    if (runs.isTerminal(run.status)) {
      return;
    }

    runs.finish(run, run.cancelRequested ? 'canceled' : 'succeeded', 0);
  } catch (error) {
    if (runs.isTerminal(run.status)) {
      return;
    }

    if (controller.signal.aborted || run.cancelRequested) {
      runs.finish(run, 'canceled', null, 'SIGTERM');
      return;
    }

    runs.fail(run, 'AGENT_EXECUTION_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    run.acpSession = null;
  }
}

function createManagedEventPayloadSanitizer(
  managedCwd: string | undefined,
  projectWorkspaceDir: string,
): (value: unknown) => unknown {
  if (!managedCwd || managedCwd === projectWorkspaceDir) {
    return (value) => value;
  }

  const normalizedManagedCwd = normalize(managedCwd);
  const replacements = new Set([managedCwd, normalizedManagedCwd]);
  return (value) => replaceManagedPathInPayload(value, replacements, projectWorkspaceDir);
}

function replaceManagedPathInPayload(
  value: unknown,
  managedPaths: Set<string>,
  replacement: string,
): unknown {
  if (typeof value === 'string') {
    let next = value;
    for (const managedPath of managedPaths) {
      if (managedPath) {
        next = next.split(managedPath).join(replacement);
      }
    }
    return next;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceManagedPathInPayload(item, managedPaths, replacement));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      replaceManagedPathInPayload(entry, managedPaths, replacement),
    ]),
  );
}

function shouldStopAfterUserInputAsk(projected: ProjectedAcpEvent, sawInlineQuestionForm: boolean): boolean {
  if (projected.kind !== 'emit') {
    return false;
  }

  if (projected.event === 'tool_use' && projected.data.type === 'tool_use') {
    return isUserInputToolName(projected.data.name);
  }

  if (projected.event === 'text_delta' && projected.data.type === 'text_delta') {
    return sawInlineQuestionForm && projected.data.delta.toLowerCase().includes('</question-form>');
  }

  return false;
}

function isUserInputToolName(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }

  const normalized = name.trim().toLowerCase();
  return normalized === 'askuserquestion' ||
    normalized === 'ask_user_question' ||
    normalized === 'request_user_input';
}

type ProjectedAcpEvent =
  | { kind: 'emit'; event: string; data: AgentEvent }
  | {
      kind: 'finish';
      status: 'succeeded' | 'failed' | 'canceled';
      exitCode?: number | null;
      providerSessionId?: string;
      resumeToken?: string;
    }
  | { kind: 'error'; code: string; message: string };

function projectAcpAgentEvent(event: AcpAgentEvent): ProjectedAcpEvent | null {
  switch (event.type) {
    case 'status':
      return {
        kind: 'emit',
        event: 'status',
        data: {
          type: 'status',
          label: event.message ?? event.status ?? event.stage ?? 'running',
        },
      };
    case 'thinking_delta':
      return { kind: 'emit', event: 'thinking_delta', data: { type: 'thinking_delta', delta: event.text } };
    case 'thinking':
      return { kind: 'emit', event: 'thinking_delta', data: { type: 'thinking_delta', delta: event.text } };
    case 'text_delta':
      return { kind: 'emit', event: 'text_delta', data: { type: 'text_delta', delta: event.text } };
    case 'tool_call':
      return {
        kind: 'emit',
        event: 'tool_use',
        data: { type: 'tool_use', id: event.id, name: event.name, input: event.input },
      };
    case 'tool_result':
      return {
        kind: 'emit',
        event: 'tool_result',
        data: {
          type: 'tool_result',
          toolUseId: event.id,
          content: stringifyAcpToolOutput(event),
          isError: event.isError === true || event.status === 'failed',
        },
      };
    case 'usage':
      return {
        kind: 'emit',
        event: 'usage',
        data: { type: 'usage', usage: event.usage, costUsd: undefined, durationMs: undefined, stopReason: undefined },
      };
    case 'stderr':
      return { kind: 'emit', event: 'stderr', data: { type: 'raw', line: event.text } };
    case 'file_write':
      return {
        kind: 'emit',
        event: 'tool_result',
        data: {
          type: 'tool_result',
          toolUseId: `file_write:${event.path}`,
          content: event.path,
          isError: false,
        },
      };
    case 'error':
      return { kind: 'error', code: event.code, message: event.message };
    case 'done':
      return {
        kind: 'finish',
        status: event.status === 'failed' ? 'failed' : event.status === 'canceled' ? 'canceled' : 'succeeded',
        exitCode: event.exitCode,
        providerSessionId: event.sessionId,
        resumeToken: event.resumeToken,
      };
    default:
      return null;
  }
}

function buildProviderResume(run: ChatRun): AcpAgentRunInput['resume'] {
  const providerSessionId = readString(run.providerSessionId);
  const resumeToken = readString(run.resumeToken);
  if (!providerSessionId && !resumeToken) {
    return { mode: 'fresh' };
  }

  return {
    mode: 'provider',
    ...(providerSessionId ? { providerSessionId } : {}),
    ...(resumeToken ? { resumeToken } : {}),
  };
}

function resolveTuttiWorkspaceCwd(fallback: string): string {
  return process.env.TUTTI_WORKSPACE_ROOT?.trim() || process.env.VIBE_WORKSPACE_ROOT?.trim() || fallback;
}

async function buildConversationHistory(
  projectsDir: string,
  run: ChatRun,
  currentPrompt: string,
): Promise<AcpAgentRunMessage[]> {
  if (!run.projectId || !run.conversationId) {
    return [];
  }

  if (readString(run.providerSessionId) || readString(run.resumeToken)) {
    return [];
  }

  const messages = await listConversationMessages(projectsDir, run.projectId, run.conversationId);
  if (!messages) {
    return [];
  }

  const currentAssistantIndex = run.assistantMessageId
    ? messages.findIndex((message) => message.id === run.assistantMessageId)
    : -1;
  const candidates = currentAssistantIndex >= 0 ? messages.slice(0, currentAssistantIndex) : [...messages];
  const currentPromptIndex = lastCurrentPromptMessageIndex(candidates, currentPrompt);
  const priorMessages = currentPromptIndex >= 0
    ? candidates.slice(0, currentPromptIndex)
    : candidates;

  return priorMessages
    .flatMap((message): AcpAgentRunMessage[] => {
      const content = conversationHistoryContent(message);
      if (!content) return [];
      return [{ role: message.role, content }];
    })
    .slice(-MAX_HISTORY_MESSAGES);
}

function lastCurrentPromptMessageIndex(messages: StoredConversationMessage[], currentPrompt: string): number {
  const normalizedPrompt = currentPrompt.trim();
  if (!normalizedPrompt) {
    return -1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') {
      continue;
    }
    return message.content.trim() === normalizedPrompt ? index : -1;
  }

  return -1;
}

function conversationHistoryContent(message: StoredConversationMessage): string | null {
  const content = boundedHistoryContent(message.content);
  if (content) {
    return content;
  }

  if (message.role !== 'assistant') {
    return null;
  }

  const eventContent = assistantHistoryContentFromEvents(message.events);
  return eventContent ? boundedHistoryContent(eventContent) : null;
}

function assistantHistoryContentFromEvents(events: unknown[]): string | null {
  const parts: string[] = [];

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }
    if (event.type === 'text_delta') {
      const delta = readString(event.delta) ?? readString(event.text);
      if (delta) parts.push(delta);
      continue;
    }
    if (event.type === 'tool_use' && isUserInputToolName(event.name)) {
      const askSummary = summarizeAskUserQuestionInput(event.input);
      if (askSummary) parts.push(askSummary);
    }
  }

  const content = parts.join('').trim();
  return content || null;
}

function summarizeAskUserQuestionInput(input: unknown): string | null {
  const questions = askUserQuestionRecords(input);
  const summaries = questions.flatMap((question): string[] => {
    const text = readString(question.question);
    if (!text) {
      return [];
    }
    const optionLabels = askUserQuestionOptionLabels(question.options);
    return [`Asked the user: ${text}${optionLabels.length > 0 ? `\nOptions: ${optionLabels.join(', ')}` : ''}`];
  });
  return summaries.length > 0 ? summaries.join('\n') : null;
}

function askUserQuestionRecords(input: unknown): Record<string, unknown>[] {
  if (!isRecord(input)) {
    return [];
  }
  if (Array.isArray(input.questions)) {
    return input.questions.filter(isRecord);
  }
  return [input];
}

function askUserQuestionOptionLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option): string[] => {
    if (typeof option === 'string' && option.trim()) {
      return [option.trim()];
    }
    if (!isRecord(option)) {
      return [];
    }
    const label = readString(option.label);
    return label ? [label] : [];
  });
}

function boundedHistoryContent(content: string): string | null {
  const trimmed = content.trim();
  return trimmed ? trimmed.slice(0, MAX_HISTORY_MESSAGE_CHARS) : null;
}

async function materializeAcpFileWrite(
  projectsDir: string,
  projectId: string | null | undefined,
  cwd: string,
  rawPath: unknown,
  mimeOverride?: string | null,
): Promise<{ name: string; mime: string } | null> {
  if (!projectId || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return null;
  }

  const sourcePath = resolveWorkspaceWritePath(cwd, rawPath);
  if (!sourcePath) {
    return null;
  }

  const name = basename(sourcePath);
  if (!isSafeMaterializedFileName(name)) {
    return null;
  }

  const sourceStats = await stat(sourcePath).catch(() => null);
  if (!sourceStats?.isFile()) {
    return null;
  }

  const assetsDir = join(projectsDir, projectId, 'assets');
  const assetPath = join(assetsDir, name);
  await mkdir(assetsDir, { recursive: true });
  if (sourcePath !== assetPath) {
    await copyFile(sourcePath, assetPath);
  }

  const mime = mimeOverride?.trim() || materializedFileMime(name);
  upsertProjectFileInStore(projectsDir, projectId, {
    name,
    path: `assets/${name}`,
    size: sourceStats.size,
    mime,
  });

  return { name, mime };
}

async function materializeProjectFileContent(
  projectsDir: string,
  projectId: string | null | undefined,
  cwd: string,
  rawPath: unknown,
  content: string,
  mimeOverride?: string | null,
): Promise<{ name: string; mime: string } | null> {
  const sourcePath = typeof rawPath === 'string' ? resolveWorkspaceWritePath(cwd, rawPath) : null;
  if (!sourcePath) {
    return null;
  }

  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, content, 'utf8');
  return materializeAcpFileWrite(projectsDir, projectId, cwd, sourcePath, mimeOverride);
}

async function materializeAcpWriteToolCall(
  projectsDir: string,
  projectId: string | null | undefined,
  cwd: string,
  event: AcpAgentEvent,
): Promise<{ name: string; mime: string } | null> {
  if (event.type !== 'tool_call' || !isWriteToolName(event.name) || !isRecord(event.input)) {
    return null;
  }

  const rawPath = readString(event.input.file_path);
  const content = typeof event.input.content === 'string' ? event.input.content : null;
  if (!rawPath || content === null) {
    return null;
  }

  return materializeProjectFileContent(projectsDir, projectId, cwd, rawPath, content);
}

function resolveWorkspaceWritePath(cwd: string, rawPath: string): string | null {
  const sourcePath = resolveProjectWorkspacePath(cwd, rawPath);
  const relativePath = relative(cwd, sourcePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }

  return sourcePath;
}

function resolveProjectWorkspacePath(cwd: string, rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (trimmedPath === '/workspace') {
    return cwd;
  }
  if (trimmedPath.startsWith('/workspace/')) {
    return resolve(cwd, trimmedPath.slice('/workspace/'.length));
  }
  return isAbsolute(trimmedPath) ? resolve(trimmedPath) : resolve(cwd, trimmedPath);
}

function isWriteToolName(name: unknown): boolean {
  return typeof name === 'string' && name.trim().toLowerCase() === 'write';
}

function isSafeMaterializedFileName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 255 &&
    basename(name) === name &&
    !/^\.+$/.test(name)
  );
}

function materializedFileMime(name: string): string {
  const extension = extname(name).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'text/html';
  if (extension === '.css') return 'text/css';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript';
  if (extension === '.json') return 'application/json';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.txt') return 'text/plain';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function persistRunResumeMetadata(
  projectsDir: string,
  run: ChatRun,
  input: { providerSessionId?: string; resumeToken?: string },
): Promise<void> {
  const providerSessionId = readString(input.providerSessionId);
  const resumeToken = readString(input.resumeToken);
  if (!providerSessionId && !resumeToken) {
    return;
  }

  run.providerSessionId = providerSessionId ?? run.providerSessionId;
  run.resumeToken = resumeToken ?? run.resumeToken;
  if (!run.projectId || !run.conversationId) {
    return;
  }

  await updateConversationResumeMetadata(projectsDir, run.projectId, run.conversationId, {
    providerSessionId,
    resumeToken,
  });
}

function stringifyAcpToolOutput(event: Extract<AcpAgentEvent, { type: 'tool_result' }>): string {
  if (typeof event.summary === 'string') {
    return event.summary;
  }

  if (typeof event.error === 'string') {
    return event.error;
  }

  const output = event.output;
  if (typeof output === 'string') {
    return output;
  }

  if (isRecord(output) && typeof output.output === 'string') {
    return output.output;
  }

  return output === undefined ? '' : JSON.stringify(output);
}

async function resolveRequestedSkill(
  request: AgentRunRequest,
  paths: AgentRunPaths,
): Promise<SkillInfo | undefined> {
  const skillId = readString(request.skillId) ?? readRunContextSkillIds(request.context)[0];
  if (!skillId) {
    return undefined;
  }

  const skills = await listSkills([paths.userSkillsRoot, paths.builtInSkillsRoot]);
  return findSkillById(skills, skillId);
}

function formatSelectedDesignFilesSection(
  value: unknown,
  cwd: string,
  projectId: string | null | undefined,
  projectsDir: string,
): string[] {
  const files = readSelectedDesignFiles(value, projectId, projectsDir);
  if (files.length === 0) {
    return [];
  }

  return [
    '',
    '# Selected design files',
    '',
    'The user selected these project files as context. Inspect the local paths before editing or using their contents.',
    '',
    ...files.map((file, index) => {
      const parts = [
        `${index + 1}. ${file.name}`,
        `kind=${file.kind}`,
        `path=${file.path}`,
        `localPath=${resolve(cwd, file.path)}`,
      ];
      if (file.mime) parts.push(`mimeType=${file.mime}`);
      if (typeof file.size === 'number') parts.push(`size=${file.size}`);
      return parts.join(' | ');
    }),
  ];
}

function readSelectedDesignFiles(
  value: unknown,
  projectId: string | null | undefined,
  projectsDir: string,
): Array<{ name: string; path: string; kind: string; mime: string; size: number }> {
  if (!projectId || !isRecord(value)) {
    return [];
  }

  const selectedPaths = new Set(
    readStringArray(value.designFilePaths)
      .map(normalizeProjectAttachmentPath)
      .filter((path): path is string => path !== null),
  );
  const selectedIds = new Set(readStringArray(value.designFileIds));
  if (selectedPaths.size === 0 && selectedIds.size === 0) {
    return [];
  }

  return listProjectFilesFromStore(projectsDir, projectId)
    .filter((file) =>
      selectedPaths.has(file.path) ||
      selectedPaths.has(file.name) ||
      selectedIds.has(file.path) ||
      selectedIds.has(file.name)
    )
    .map((file) => ({
      name: file.name,
      path: file.path,
      kind: file.kind,
      mime: file.mime,
      size: file.size,
    }))
    .slice(0, 20);
}

function readRunContextSkillIds(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return readStringArray(value.skillIds);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const stringValue = readString(item);
    if (!stringValue || seen.has(stringValue)) {
      continue;
    }

    seen.add(stringValue);
    values.push(stringValue);
  }
  return values;
}

async function resolveProjectDesignSystem(
  projectId: string | null | undefined,
  paths: AgentRunPaths,
  locale?: string,
): Promise<{
  title: string;
  body: string;
  usageMd?: string;
  tokensCss?: string;
  componentsManifest?: string;
  fixtureHtml?: string;
  importMode?: ComposeInput['designSystemImportMode'];
} | null> {
  if (!projectId || !paths.builtInDesignSystemsRoot || !paths.userDesignSystemsRoot) {
    return null;
  }

  const project = getProjectFromStore(paths.projectsDir, projectId);
  const designSystemId = project?.designSystemId;
  if (!designSystemId) {
    return null;
  }

  const roots = {
    builtInRoot: paths.builtInDesignSystemsRoot,
    userRoot: paths.userDesignSystemsRoot,
    id: designSystemId,
    locale,
  };
  const detail = await readAvailableDesignSystemDetail(roots);
  if (!detail) {
    return null;
  }

  const assets = await resolveDesignSystemAssets(roots);
  return {
    title: detail.title,
    body: detail.body,
    usageMd: assets.usageMd,
    tokensCss: assets.tokensCss,
    componentsManifest: assets.componentsManifest,
    fixtureHtml: assets.fixtureHtml,
    importMode: assets.importMode,
  };
}

function readUserPrompt(request: AgentRunRequest): string | null {
  return readString(request.prompt) ?? readString(request.message) ?? readString(request.currentPrompt);
}

function appendStderrTail(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length > MAX_AGENT_STDERR_REASON_CHARS
    ? next.slice(next.length - MAX_AGENT_STDERR_REASON_CHARS)
    : next;
}

function formatAttachedFilesSection(value: unknown, cwd: string): string[] {
  const attachments = readPromptAttachments(value, cwd);
  if (attachments.length === 0) {
    return [];
  }

  return [
    '',
    '# Attached files',
    '',
    'The user uploaded these files. They are available in the project workspace; inspect the local paths when you need the file contents or image details.',
    '',
    ...attachments.map((attachment, index) => {
      const parts = [
        `${index + 1}. ${attachment.name}`,
        `kind=${attachment.kind}`,
        `path=${attachment.path}`,
        `localPath=${attachment.localPath}`,
      ];
      if (attachment.mimeType) parts.push(`mimeType=${attachment.mimeType}`);
      if (attachment.size !== null) parts.push(`size=${attachment.size}`);
      return parts.join(' | ');
    }),
  ];
}

function formatAttachedPreviewCommentsSection(value: unknown): string[] {
  const attachments = readPreviewCommentAttachments(value);
  if (attachments.length === 0) {
    return [];
  }

  return [
    '',
    '# Attached preview comments',
    '',
    'Scope: apply the user request to these preview targets by default. For visual marks, inspect the screenshot and modify the marked region first. Preserve unrelated areas.',
    '',
    ...attachments.map((attachment) => {
      const parts = [
        `targetKind=${attachment.targetKind}`,
        `selectionKind=${attachment.selectionKind}`,
        `file=${attachment.filePath}`,
        `targetId=${attachment.targetId}`,
        `selector=${attachment.selector || '(none)'}`,
        `label=${attachment.label || '(unlabeled)'}`,
        `position=${formatPromptPosition(attachment.position)}`,
        `currentText=${attachment.currentText || '(empty)'}`,
        `htmlHint=${attachment.htmlHint || '(none)'}`,
        `computedStyle=${formatPromptStyle(attachment.computedStyle)}`,
        `comment=${attachment.comment}`,
      ];
      if (attachment.screenshotPath) parts.push(`screenshot=${attachment.screenshotPath}`);
      if (attachment.markKind) parts.push(`markKind=${attachment.markKind}`);
      if (attachment.intent) parts.push(`intent=${attachment.intent}`);
      return parts.join(' | ');
    }),
  ];
}

interface PromptAttachment {
  name: string;
  kind: string;
  path: string;
  localPath: string;
  mimeType: string | null;
  size: number | null;
}

interface PreviewCommentAttachmentPrompt {
  order: number;
  targetKind: string;
  selectionKind: string;
  filePath: string;
  targetId: string;
  selector: string;
  label: string;
  position: PromptPosition | null;
  currentText: string;
  htmlHint: string;
  computedStyle: Record<string, string>;
  comment: string;
  screenshotPath: string | null;
  markKind: string | null;
  intent: string | null;
}

interface PromptPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readPreviewCommentAttachments(value: unknown): PreviewCommentAttachmentPrompt[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 20).flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    const targetKind = readString(entry.source) ?? readString(entry.targetKind);
    const selectionKind = readString(entry.selectionKind);
    const filePath = readString(entry.filePath);
    const targetId = readString(entry.targetId);
    const comment = readCompactString(entry.comment);
    if (!targetKind || !selectionKind || !filePath || !targetId || !comment) {
      return [];
    }

    return [
      {
        order: readFiniteNumber(entry.order) ?? index + 1,
        targetKind: compactPromptValue(targetKind, 80),
        selectionKind: compactPromptValue(selectionKind, 40),
        filePath: compactPromptValue(filePath, 240),
        targetId: compactPromptValue(targetId, 160),
        selector: readCompactString(entry.selector) ?? '',
        label: readCompactString(entry.label) ?? '',
        position: readPromptPosition(entry.pagePosition ?? entry.position),
        currentText: readCompactString(entry.currentText) ?? '',
        htmlHint: readCompactString(entry.htmlHint) ?? '',
        computedStyle: readPromptStyle(entry.computedStyle ?? entry.style),
        comment,
        screenshotPath: readScreenshotPromptPath(entry.screenshotPath),
        markKind: readCompactString(entry.markKind),
        intent: readCompactString(entry.intent),
      },
    ];
  });
}

function readCompactString(value: unknown, maxLength = 240): string | null {
  return typeof value === 'string' ? compactPromptValue(value, maxLength) : null;
}

function readScreenshotPromptPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (/^\s*data:/i.test(value)) {
    return '(inline screenshot omitted)';
  }
  return compactPromptValue(value, 240);
}

function compactPromptValue(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function readPromptPosition(value: unknown): PromptPosition | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = readFiniteNumber(value.x);
  const y = readFiniteNumber(value.y);
  const width = readFiniteNumber(value.width);
  const height = readFiniteNumber(value.height);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function readPromptStyle(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([key, rawValue]) => {
    const styleValue = readCompactString(rawValue, 120);
    if (!styleValue) {
      return [];
    }
    return [[compactPromptValue(key, 80), styleValue] as const];
  });

  return Object.fromEntries(entries.slice(0, 12));
}

function formatPromptPosition(position: PromptPosition | null): string {
  if (!position) {
    return 'unknown';
  }
  return `x=${position.x},y=${position.y},width=${position.width},height=${position.height}`;
}

function formatPromptStyle(style: Record<string, string>): string {
  const entries = Object.entries(style);
  if (entries.length === 0) {
    return '(none)';
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join('; ');
}

function readPromptAttachments(value: unknown, cwd: string): PromptAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const name = readString(entry.name);
    const rawPath = readString(entry.path);
    if (!name || !rawPath) {
      return [];
    }

    const projectPath = normalizeProjectAttachmentPath(rawPath);
    if (!projectPath) {
      return [];
    }

    return [
      {
        name,
        kind: readString(entry.kind) ?? 'file',
        path: projectPath,
        localPath: resolve(cwd, projectPath),
        mimeType: readString(entry.mimeType) ?? readString(entry.mime),
        size: typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : null,
      },
    ];
  });
}

function normalizeProjectAttachmentPath(value: string): string | null {
  if (isAbsolute(value)) {
    return null;
  }

  const normalized = normalize(value);
  if (normalized === '.' || normalized.startsWith('..')) {
    return null;
  }

  return normalized;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRecord(value: unknown): ComposeInput['metadata'] {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ComposeInput['metadata'])
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
