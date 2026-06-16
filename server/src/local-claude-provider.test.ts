import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVibeClaudeProvider, parseClaudeAuthStatus, parseVibeClaudeStreamEvent } from './local-claude-provider.js';

describe('createVibeClaudeProvider', () => {
  it('uses a Tutti app-local Claude home for runs when TUTTI_APP_DATA_DIR is set', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vibe-tutti-data-'));
    const previousDataDir = process.env.TUTTI_APP_DATA_DIR;
    const claudeHome = join(tempDir, 'claude-home');
    await mkdir(join(claudeHome, '.claude'), { recursive: true });
    await writeFile(join(claudeHome, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'app-local-key',
        ANTHROPIC_BASE_URL: 'https://llm.example.test/anthropic',
      },
    }));

    try {
      process.env.TUTTI_APP_DATA_DIR = tempDir;
      const provider = createVibeClaudeProvider();
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
