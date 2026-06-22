import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVibeClaudeProvider, parseClaudeAuthStatus, parseVibeClaudeStreamEvent } from './local-claude-provider.js';

const CLAUDE_ENV_TEST_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
] as const;

function captureClaudeEnv(): Record<string, string | undefined> {
  return Object.fromEntries(CLAUDE_ENV_TEST_KEYS.map((key) => [key, process.env[key]]));
}

function clearClaudeEnv(): void {
  for (const key of CLAUDE_ENV_TEST_KEYS) {
    delete process.env[key];
  }
}

function restoreClaudeEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of CLAUDE_ENV_TEST_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('createVibeClaudeProvider', () => {
  it('uses a Tutti app-local Claude home for runs when TUTTI_APP_DATA_DIR is set', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-tutti-data-'));
    const previousDataDir = process.env.TUTTI_APP_DATA_DIR;
    const previousClaudeEnv = captureClaudeEnv();
    const claudeHome = join(tempDir, 'claude-home');
    const userClaudeHome = join(tempDir, 'user-home');
    await mkdir(join(claudeHome, '.claude'), { recursive: true });
    await mkdir(join(userClaudeHome, '.claude'), { recursive: true });
    await writeFile(join(claudeHome, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'app-local-key',
        ANTHROPIC_BASE_URL: 'https://llm.example.test/anthropic',
      },
    }));

    try {
      clearClaudeEnv();
      process.env.TUTTI_APP_DATA_DIR = tempDir;
      const provider = createVibeClaudeProvider({ userClaudeHome });
      const plan = await provider.buildLaunchPlan({
        runId: 'run-1',
        cwd: '/tmp/vibe-project',
        prompt: 'Build a page',
        model: 'default',
      });

      expect(plan.env).toMatchObject({
        HOME: claudeHome,
        ANTHROPIC_API_KEY: 'app-local-key',
        ANTHROPIC_BASE_URL: 'https://llm.example.test/anthropic',
      });
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.TUTTI_APP_DATA_DIR;
      } else {
        process.env.TUTTI_APP_DATA_DIR = previousDataDir;
      }
      restoreClaudeEnv(previousClaudeEnv);
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('detects Claude auth using the configured app-local home', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-home-detect-'));
    const commandPath = join(tempDir, 'claude');
    const observedHomePath = join(tempDir, 'observed-home.txt');
    const claudeHome = join(tempDir, 'claude-home');
    const previousClaudePath = process.env.CLAUDE_CODE_PATH;
    await writeFile(commandPath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  printf "test-claude\\n"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      `  printf "%s" "$HOME" > "${observedHomePath}"`,
      '  printf "{\\"loggedIn\\":true}\\n"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(commandPath, 0o755);

    try {
      process.env.CLAUDE_CODE_PATH = commandPath;
      const provider = createVibeClaudeProvider({ claudeHome });
      const detection = await provider.detect();

      expect(detection).not.toBeNull();
      if (!detection) {
        return;
      }
      expect(detection.authState).toBe('ok');
      expect(detection.configDir).toBe(join(claudeHome, '.claude'));
      await expect(readFile(observedHomePath, 'utf8')).resolves.toBe(claudeHome);
    } finally {
      if (previousClaudePath === undefined) {
        delete process.env.CLAUDE_CODE_PATH;
      } else {
        process.env.CLAUDE_CODE_PATH = previousClaudePath;
      }
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('passes detect context cwd and env into Claude detection commands', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-detect-context-'));
    const commandPath = join(tempDir, 'claude');
    const workDir = join(tempDir, 'workspace');
    const observedVersionEnvPath = join(tempDir, 'observed-version-env.txt');
    const observedVersionCwdPath = join(tempDir, 'observed-version-cwd.txt');
    const observedAuthEnvPath = join(tempDir, 'observed-auth-env.txt');
    const observedAuthCwdPath = join(tempDir, 'observed-auth-cwd.txt');
    const previousClaudePath = process.env.CLAUDE_CODE_PATH;
    await mkdir(workDir, { recursive: true });
    await writeFile(commandPath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      `  printf "%s" "$TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL" > "${observedVersionEnvPath}"`,
      `  pwd > "${observedVersionCwdPath}"`,
      '  printf "test-claude\\n"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      `  printf "%s" "$TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL" > "${observedAuthEnvPath}"`,
      `  pwd > "${observedAuthCwdPath}"`,
      '  printf "{\\"loggedIn\\":true}\\n"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(commandPath, 0o755);

    try {
      process.env.CLAUDE_CODE_PATH = commandPath;
      const provider = createVibeClaudeProvider();
      const detection = await provider.detect({
        cwd: workDir,
        env: {
          TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL: 'credential-detect-1',
        },
      });

      expect(detection?.authState).toBe('ok');
      await expect(readFile(observedVersionEnvPath, 'utf8')).resolves.toBe('credential-detect-1');
      await expect(readFile(observedAuthEnvPath, 'utf8')).resolves.toBe('credential-detect-1');
      const realWorkDir = await realpath(workDir);
      await expect(readFile(observedVersionCwdPath, 'utf8')).resolves.toBe(`${realWorkDir}\n`);
      await expect(readFile(observedAuthCwdPath, 'utf8')).resolves.toBe(`${realWorkDir}\n`);
    } finally {
      if (previousClaudePath === undefined) {
        delete process.env.CLAUDE_CODE_PATH;
      } else {
        process.env.CLAUDE_CODE_PATH = previousClaudePath;
      }
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('syncs user Claude credentials into the configured app-local home before detecting auth', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-auth-sync-'));
    const commandPath = join(tempDir, 'claude');
    const userClaudeHome = join(tempDir, 'user-home');
    const claudeHome = join(tempDir, 'claude-home');
    const previousClaudePath = process.env.CLAUDE_CODE_PATH;
    await mkdir(join(userClaudeHome, '.claude'), { recursive: true });
    await writeFile(join(userClaudeHome, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: {
        accessToken: 'source-access-token',
        refreshToken: 'source-refresh-token',
      },
    }));
    await writeFile(join(userClaudeHome, '.claude.json'), JSON.stringify({
      oauthAccount: { accountUuid: 'account-1', emailAddress: 'user@example.test' },
      userID: 'user-1',
      projects: { shouldNotCopy: true },
    }));
    await writeFile(join(userClaudeHome, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'source-key',
        ANTHROPIC_BASE_URL: 'https://llm.example.test/anthropic',
        UNRELATED_ENV: 'ignored',
      },
    }));
    await writeFile(commandPath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  printf "test-claude\\n"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      '  if [ -f "$HOME/.claude/.credentials.json" ]; then',
      '    printf "{\\"loggedIn\\":true}\\n"',
      '    exit 0',
      '  fi',
      '  printf "{\\"loggedIn\\":false}\\n"',
      '  exit 1',
      'fi',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(commandPath, 0o755);

    try {
      process.env.CLAUDE_CODE_PATH = commandPath;
      const provider = createVibeClaudeProvider({ claudeHome, userClaudeHome });
      const detection = await provider.detect();

      expect(detection?.authState).toBe('ok');
      await expect(readFile(join(claudeHome, '.claude', '.credentials.json'), 'utf8')).resolves.toContain(
        'source-access-token',
      );
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.toContain('account-1');
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.not.toContain('shouldNotCopy');
      await expect(readFile(join(claudeHome, '.claude', 'settings.json'), 'utf8')).resolves.toContain('source-key');
      await expect(readFile(join(claudeHome, '.claude', 'settings.json'), 'utf8')).resolves.not.toContain('ignored');
    } finally {
      if (previousClaudePath === undefined) {
        delete process.env.CLAUDE_CODE_PATH;
      } else {
        process.env.CLAUDE_CODE_PATH = previousClaudePath;
      }
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('syncs Anthropic API env from the current process into the app-local Claude settings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-process-env-sync-'));
    const commandPath = join(tempDir, 'claude');
    const userClaudeHome = join(tempDir, 'user-home');
    const claudeHome = join(tempDir, 'claude-home');
    const previousClaudePath = process.env.CLAUDE_CODE_PATH;
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const previousUnrelated = process.env.UNRELATED_ENV;
    await mkdir(join(userClaudeHome, '.claude'), { recursive: true });
    await writeFile(commandPath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  printf "test-claude\\n"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      '  printf "{\\"loggedIn\\":true}\\n"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(commandPath, 0o755);

    try {
      process.env.CLAUDE_CODE_PATH = commandPath;
      process.env.ANTHROPIC_API_KEY = 'process-api-key';
      process.env.ANTHROPIC_BASE_URL = 'https://process.example.test/anthropic';
      process.env.UNRELATED_ENV = 'ignored';
      const provider = createVibeClaudeProvider({ claudeHome, userClaudeHome });
      const detection = await provider.detect();

      expect(detection?.authState).toBe('ok');
      const settings = await readFile(join(claudeHome, '.claude', 'settings.json'), 'utf8');
      expect(settings).toContain('process-api-key');
      expect(settings).toContain('https://process.example.test/anthropic');
      expect(settings).not.toContain('ignored');
    } finally {
      if (previousClaudePath === undefined) {
        delete process.env.CLAUDE_CODE_PATH;
      } else {
        process.env.CLAUDE_CODE_PATH = previousClaudePath;
      }
      if (previousApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousApiKey;
      }
      if (previousBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
      } else {
        process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
      }
      if (previousUnrelated === undefined) {
        delete process.env.UNRELATED_ENV;
      } else {
        process.env.UNRELATED_ENV = previousUnrelated;
      }
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('refreshes switched Claude env from the user settings into the app-local Claude settings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-switched-env-sync-'));
    const commandPath = join(tempDir, 'claude');
    const userClaudeHome = join(tempDir, 'user-home');
    const claudeHome = join(tempDir, 'claude-home');
    const previousClaudePath = process.env.CLAUDE_CODE_PATH;
    const previousClaudeEnv = captureClaudeEnv();
    await mkdir(join(userClaudeHome, '.claude'), { recursive: true });
    await mkdir(join(claudeHome, '.claude'), { recursive: true });
    await writeFile(join(userClaudeHome, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'switched-auth-token',
        ANTHROPIC_BASE_URL: 'https://switched.example.test/anthropic',
        UNRELATED_ENV: 'ignored',
      },
    }));
    await writeFile(join(claudeHome, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'old-auth-token',
        ANTHROPIC_BASE_URL: 'https://old.example.test/anthropic',
        EXISTING_APP_ENV: 'preserved',
      },
    }));
    await writeFile(commandPath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  printf "test-claude\\n"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      '  printf "{\\"loggedIn\\":true}\\n"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(commandPath, 0o755);

    try {
      clearClaudeEnv();
      process.env.CLAUDE_CODE_PATH = commandPath;
      const provider = createVibeClaudeProvider({ claudeHome, userClaudeHome });
      const detection = await provider.detect();

      expect(detection?.authState).toBe('ok');
      const settings = JSON.parse(await readFile(join(claudeHome, '.claude', 'settings.json'), 'utf8'));
      expect(settings.env).toMatchObject({
        ANTHROPIC_AUTH_TOKEN: 'switched-auth-token',
        ANTHROPIC_BASE_URL: 'https://switched.example.test/anthropic',
        EXISTING_APP_ENV: 'preserved',
      });
      expect(settings.env).not.toHaveProperty('UNRELATED_ENV');
    } finally {
      if (previousClaudePath === undefined) {
        delete process.env.CLAUDE_CODE_PATH;
      } else {
        process.env.CLAUDE_CODE_PATH = previousClaudePath;
      }
      restoreClaudeEnv(previousClaudeEnv);
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('reports missing auth when Claude auth status exits non-zero with logged-out JSON', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-home-missing-'));
    const commandPath = join(tempDir, 'claude');
    const claudeHome = join(tempDir, 'claude-home');
    const previousClaudePath = process.env.CLAUDE_CODE_PATH;
    await writeFile(commandPath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  printf "test-claude\\n"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      '  printf "{\\"loggedIn\\":false,\\"authMethod\\":\\"none\\"}\\n"',
      '  exit 1',
      'fi',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(commandPath, 0o755);

    try {
      process.env.CLAUDE_CODE_PATH = commandPath;
      const provider = createVibeClaudeProvider({ claudeHome });
      const detection = await provider.detect();

      expect(detection?.authState).toBe('missing');
    } finally {
      if (previousClaudePath === undefined) {
        delete process.env.CLAUDE_CODE_PATH;
      } else {
        process.env.CLAUDE_CODE_PATH = previousClaudePath;
      }
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('launches Claude Code with MCP disabled while leaving other tools available', async () => {
    const provider = createVibeClaudeProvider();
    const plan = await provider.buildLaunchPlan({
      runId: 'run-1',
      cwd: '/tmp/vibe-project',
      prompt: 'Build a page',
      model: 'claude:sonnet',
      extraAllowedDirs: ['/tmp/shared-assets'],
    });

    expect(plan.args).toEqual(expect.arrayContaining([
      '--mcp-config',
      '{"mcpServers":{}}',
      '--strict-mcp-config',
      '--setting-sources',
      'local',
      '--permission-mode',
      'default',
      '--model',
      'sonnet',
      '--add-dir',
      '/tmp/shared-assets',
    ]));
    expect(plan.args).not.toContain('--tools');
    expect(plan.args).not.toContain('--disable-slash-commands');
    expect(plan.args).not.toContain('--no-chrome');
    expect(plan.args).not.toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions']));
    expect(plan.args).not.toContain('--dangerously-skip-permissions');
  });

  it('injects Claude API env from user settings when local setting sources hide parent config', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-claude-settings-'));
    const settingsPath = join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_BASE_URL: 'https://llm.example.test/anthropic',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'test-haiku',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'test-opus',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'test-sonnet',
        ANTHROPIC_MODEL: 'test-model',
        UNRELATED_ENV: 'ignored',
      },
    }));

    try {
      const provider = createVibeClaudeProvider({ claudeSettingsPath: settingsPath });
      const plan = await provider.buildLaunchPlan({
        runId: 'run-1',
        cwd: '/tmp/vibe-project',
        prompt: 'Build a page',
        model: 'default',
      });

      expect(plan.env).toMatchObject({
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_BASE_URL: 'https://llm.example.test/anthropic',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'test-haiku',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'test-opus',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'test-sonnet',
        ANTHROPIC_MODEL: 'test-model',
      });
      expect(plan.env).not.toHaveProperty('UNRELATED_ENV');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

describe('parseVibeClaudeStreamEvent', () => {
  it('extracts text from current Claude stream-json assistant messages', () => {
    const events = parseVibeClaudeStreamEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'OK' }],
      },
    });

    expect(events).toEqual([{ type: 'text_delta', text: 'OK' }]);
  });
});

describe('parseClaudeAuthStatus', () => {
  it('reports ok when Claude auth status says the user is logged in', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe('ok');
  });

  it('reports missing when Claude auth status says the user is logged out', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe('missing');
  });

  it('keeps malformed Claude auth status as unknown', () => {
    expect(parseClaudeAuthStatus('not json')).toBe('unknown');
  });
});
