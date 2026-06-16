import { describe, expect, it } from 'vitest';
import { createVibeClaudeProvider, parseClaudeAuthStatus, parseVibeClaudeStreamEvent } from './local-claude-provider.js';

describe('createVibeClaudeProvider', () => {
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
      '{}',
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
