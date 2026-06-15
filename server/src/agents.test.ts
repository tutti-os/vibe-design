import { describe, expect, it } from 'vitest';
import { createAgentRegistry } from './agents.js';
import type { RuntimeAgentDef } from './agents.js';
import { claudeAgentDef } from './runtimes/claude.js';
import { codexAgentDef } from './runtimes/codex.js';
import { agentRegistry } from './runtimes/index.js';

describe('runtime descriptors', () => {
  it('describes Codex and Claude as ACP kit providers only', () => {
    expect(codexAgentDef).toEqual({
      id: 'codex',
      label: 'Codex',
      capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
      models: [
        {
          id: 'default',
          label: 'Default',
          description: 'Use the default Codex model.',
        },
        {
          id: 'codex:gpt-5.5',
          label: 'GPT-5.5',
          description: 'Frontier model for complex coding, research, and real-world work.',
        },
        { id: 'codex:gpt-5.4', label: 'GPT-5.4' },
        { id: 'codex:gpt-5', label: 'GPT-5' },
      ],
    });
    expect(claudeAgentDef).toEqual({
      id: 'claude',
      label: 'Claude Code',
      capabilities: ['agent-acp-kit', 'streaming', 'tool-use'],
      models: [
        {
          id: 'default',
          label: 'Default',
          description: 'Sonnet 4.6 · Best for everyday tasks',
        },
        {
          id: 'claude:sonnet',
          label: 'Sonnet',
          description: 'Sonnet 4.6 · Best for everyday tasks',
        },
        {
          id: 'claude:opus',
          label: 'Opus',
          description: 'Opus 4.7 · Most capable for complex work · ~2x usage vs Sonnet',
        },
        {
          id: 'claude:haiku',
          label: 'Haiku',
          description: 'Haiku 4.5 · Fastest for quick answers',
        },
      ],
    });
  });
});

describe('createAgentRegistry', () => {
  it('lists and looks up ACP provider definitions', () => {
    const registry = createAgentRegistry([claudeAgentDef, codexAgentDef]);
    expect(registry.listAgentDefs().map((agent) => agent.id)).toEqual(['claude', 'codex']);
    expect(registry.getAgentDef('codex')?.label).toBe('Codex');
    expect(registry.getAgentDef('missing')).toBeNull();
  });

  it('sanitizes known, custom, and empty models', () => {
    const registry = createAgentRegistry([codexAgentDef]);
    expect(registry.isKnownModel('codex', 'codex:gpt-5.5')).toBe(true);
    expect(registry.sanitizeCustomModel('codex', '  codex:gpt-5.5  ')).toBe('codex:gpt-5.5');
    expect(registry.sanitizeCustomModel('codex', '')).toBe('default');
  });

  it('rejects unsafe custom model ids during sanitization', () => {
    const registry = createAgentRegistry([codexAgentDef]);
    expect(registry.sanitizeCustomModel('codex', '   ')).toBe('default');
    expect(registry.sanitizeCustomModel('codex', ' anthropic/claude-sonnet-4.5 ')).toBe('anthropic/claude-sonnet-4.5');
    expect(registry.sanitizeCustomModel('codex', 'gpt 5')).toBe('default');
    expect(registry.sanitizeCustomModel('codex', '--model')).toBe('default');
    expect(registry.sanitizeCustomModel('codex', 'gpt-5\ncodex')).toBe('default');
    expect(registry.sanitizeCustomModel('codex', 'a'.repeat(129))).toBe('default');
  });

  it('throws on duplicate ids', () => {
    expect(() => createAgentRegistry([claudeAgentDef, { ...claudeAgentDef }])).toThrow(/Duplicate agent definition id: claude/);
  });

  it('reports connection test results from probe injection', async () => {
    const registry = createAgentRegistry([claudeAgentDef], async (agent) => ({
      ok: agent.id === 'claude',
      latencyMs: 2,
    }));
    await expect(registry.testAgentConnection('claude')).resolves.toEqual({ ok: true, latencyMs: 2 });
    await expect(registry.testAgentConnection('missing')).resolves.toMatchObject({ ok: false, error: 'Unknown agent: missing' });
  });

  it('reports a failed connection result when no probe is configured', async () => {
    const registry = createAgentRegistry([claudeAgentDef]);

    await expect(registry.testAgentConnection('claude')).resolves.toEqual({
      ok: false,
      error: 'Connection probe not configured',
    });
  });

  it('reports a failed connection result from the default registry without a probe', async () => {
    await expect(agentRegistry.testAgentConnection('claude')).resolves.toEqual({
      ok: false,
      error: 'Connection probe not configured',
    });
  });

  it('protects registry state from source descriptor mutation after creation', () => {
    const sourceDef: RuntimeAgentDef = {
      ...claudeAgentDef,
      models: [...claudeAgentDef.models],
    };
    const sourceDefs = [sourceDef];
    const registry = createAgentRegistry(sourceDefs);

    sourceDefs.push(codexAgentDef);
    sourceDef.label = 'Mutated Claude';
    sourceDef.models.push({ id: 'mutated-model', label: 'Mutated Model' });

    expect(registry.listAgentDefs().map((agent) => agent.id)).toEqual(['claude']);
    expect(registry.getAgentDef('claude')?.label).toBe('Claude Code');
    expect(registry.isKnownModel('claude', 'mutated-model')).toBe(false);
  });

  it('protects registry state from returned agent definition mutation', () => {
    const registry = createAgentRegistry([claudeAgentDef]);
    const returnedDefs = registry.listAgentDefs();

    returnedDefs.push(codexAgentDef);
    returnedDefs[0]?.models.push({ id: 'returned-model', label: 'Returned Model' });

    expect(registry.listAgentDefs().map((agent) => agent.id)).toEqual(['claude']);
    expect(registry.isKnownModel('claude', 'returned-model')).toBe(false);
  });

  it('protects registry state from returned lookup mutation', () => {
    const registry = createAgentRegistry([claudeAgentDef]);
    const returnedDef = registry.getAgentDef('claude');

    returnedDef?.models.push({ id: 'lookup-model', label: 'Lookup Model' });

    expect(registry.isKnownModel('claude', 'lookup-model')).toBe(false);
  });

  it('protects registry state from returned provider model mutation', () => {
    const registry = createAgentRegistry([claudeAgentDef]);
    const models = registry.listProviderModels('claude');

    models.push({ id: 'provider-model', label: 'Provider Model' });

    expect(registry.isKnownModel('claude', 'provider-model')).toBe(false);
  });

  it('returns a failed connection result when probe throws', async () => {
    const registry = createAgentRegistry([claudeAgentDef], () => {
      throw new Error('probe exploded');
    });

    await expect(registry.testAgentConnection('claude')).resolves.toEqual({ ok: false, error: 'probe exploded' });
  });
});
