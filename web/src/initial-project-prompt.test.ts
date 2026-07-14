// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeInitialProjectAgent,
  consumeInitialProjectPrompt,
  consumeInitialProjectSkills,
  stashInitialProjectAgent,
  stashInitialProjectPrompt,
  stashInitialProjectSkills,
} from './initial-project-prompt';

afterEach(() => {
  sessionStorage.clear();
});

describe('initial project prompt handoff', () => {
  it('stashes and consumes a trimmed prompt once', () => {
    stashInitialProjectPrompt('project-1', '  build a landing page  ');

    expect(consumeInitialProjectPrompt('project-1')).toBe('build a landing page');
    // Consuming removes it, so a second read is empty.
    expect(consumeInitialProjectPrompt('project-1')).toBeNull();
  });

  it('ignores an empty prompt', () => {
    stashInitialProjectPrompt('project-1', '   ');
    expect(consumeInitialProjectPrompt('project-1')).toBeNull();
  });
});

describe('initial project agent handoff', () => {
  it('stashes and consumes the selected provider and model once', () => {
    stashInitialProjectAgent('project-1', { agentTargetId: 'codex', model: 'codex:gpt-5.4' });

    expect(consumeInitialProjectAgent('project-1')).toEqual({
      agentTargetId: 'codex',
      model: 'codex:gpt-5.4',
    });
    expect(consumeInitialProjectAgent('project-1')).toBeNull();
  });

  it('keeps a provider selection without an explicit model', () => {
    stashInitialProjectAgent('project-1', { agentTargetId: 'claude' });
    expect(consumeInitialProjectAgent('project-1')).toEqual({ agentTargetId: 'claude' });
  });

  it('migrates a legacy provider selection only when the full catalog is unique', () => {
    sessionStorage.setItem(
      'vibe-design:initial-project-agent:project-1',
      JSON.stringify({ agentId: 'codex', model: 'gpt-5' }),
    );
    expect(consumeInitialProjectAgent('project-1', [
      { agentTargetId: 'team:writer', providerId: 'codex' },
    ])).toEqual({ agentTargetId: 'team:writer', model: 'gpt-5' });
  });

  it('does not guess when a legacy provider maps to multiple targets', () => {
    sessionStorage.setItem(
      'vibe-design:initial-project-agent:project-1',
      JSON.stringify({ agentId: 'codex' }),
    );
    expect(consumeInitialProjectAgent('project-1', [
      { agentTargetId: 'team:writer', providerId: 'codex' },
      { agentTargetId: 'team:reviewer', providerId: 'codex' },
    ])).toBeNull();
  });
});

describe('initial project skills handoff', () => {
  it('stashes and consumes selected skill ids once', () => {
    stashInitialProjectSkills('project-1', ['skill-a', 'skill-b']);

    expect(consumeInitialProjectSkills('project-1')).toEqual(['skill-a', 'skill-b']);
    // Consuming removes them, so a second read is empty.
    expect(consumeInitialProjectSkills('project-1')).toEqual([]);
  });

  it('normalizes blank and duplicate skill ids', () => {
    stashInitialProjectSkills('project-1', ['skill-a', ' skill-a ', '', '   ', 'skill-b']);
    expect(consumeInitialProjectSkills('project-1')).toEqual(['skill-a', 'skill-b']);
  });

  it('does not write anything when there are no usable skill ids', () => {
    stashInitialProjectSkills('project-1', ['', '   ']);
    expect(sessionStorage.getItem('vibe-design:initial-project-skills:project-1')).toBeNull();
    expect(consumeInitialProjectSkills('project-1')).toEqual([]);
  });

  it('returns an empty list for malformed stored data', () => {
    sessionStorage.setItem('vibe-design:initial-project-skills:project-1', 'not json');
    expect(consumeInitialProjectSkills('project-1')).toEqual([]);
  });

  it('keeps prompt and skills under independent keys', () => {
    stashInitialProjectPrompt('project-1', 'do the thing');
    stashInitialProjectSkills('project-1', ['skill-a']);

    // Consuming one does not clear the other.
    expect(consumeInitialProjectSkills('project-1')).toEqual(['skill-a']);
    expect(consumeInitialProjectPrompt('project-1')).toBe('do the thing');
  });
});
