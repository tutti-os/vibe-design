import { describe, expect, it } from 'vitest';
import {
  buildGenerationPreviewState,
  derivePrototypeGenerationSteps,
  workspaceHasPreviewSurface,
} from './generation-preview';
import type { AgentEvent, ChatMessage } from '../types';

describe('generation preview helpers', () => {
  it('detects when the workspace already has a preview surface', () => {
    expect(
      workspaceHasPreviewSurface({
        activeTab: 'index.html',
        projectFiles: [{ name: 'index.html', size: 1, mtime: 1, kind: 'html', mime: 'text/html' }],
        liveArtifacts: [],
      }),
    ).toBe(true);

    expect(
      workspaceHasPreviewSurface({
        activeTab: null,
        projectFiles: [],
        liveArtifacts: [],
        streamingArtifactHtml: '<html><body>hi</body></html>',
      }),
    ).toBe(true);
  });

  it('advances the three prototype steps from streamed events', () => {
    const events: AgentEvent[] = [
      { kind: 'status', label: 'thinking' },
      { kind: 'text', text: 'Planning the page.' },
      { kind: 'tool_use', id: '1', name: 'Write', input: { file_path: 'index.html' } },
    ];

    expect(
      derivePrototypeGenerationSteps({
        events,
        hasArtifactHtml: false,
        hasPreviewSurface: false,
        failed: false,
      }),
    ).toEqual([
      { id: 'understand', label: 'Understanding request', status: 'succeeded' },
      { id: 'generate', label: 'Generating design', status: 'succeeded', detail: 'index.html' },
      { id: 'prepare', label: 'Preparing preview', status: 'running' },
    ]);
  });

  it('builds the scheme stage state for an active assistant run', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'running',
      startedAt: Date.now() - 5_000,
      events: [{ type: 'text_delta', text: 'Planning the page.' }],
    };

    const state = buildGenerationPreviewState(
      [{ id: 'u1', role: 'user', content: 'Build a landing page' }, assistant],
      null,
    );

    expect(state.visible).toBe(true);
    expect(state.phase).toBe('generate');
    expect(state.steps.map((step) => step.status)).toEqual(['succeeded', 'running', 'pending']);
  });

  it('derives a concrete sub-status and task count while generating', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'running',
      startedAt: Date.now(),
      events: [
        {
          kind: 'tool_use',
          id: 't1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Plan layout', status: 'completed' },
              { content: 'Write index.html', activeForm: 'Writing index.html', status: 'in_progress' },
              { content: 'Self-check', status: 'pending' },
            ],
          },
        },
      ],
    };

    const state = buildGenerationPreviewState([assistant], null);

    expect(state.activityLabel).toBe('Writing index.html');
    expect(state.todoProgress).toEqual({ done: 2, total: 3 });
  });

  it('keeps a waiting surface when AskUserQuestion is pending', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'succeeded',
      startedAt: Date.now() - 4_000,
      events: [{ kind: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }],
    };

    const state = buildGenerationPreviewState([assistant], null);

    expect(state.visible).toBe(true);
    expect(state.phase).toBe('waiting');
    expect(state.activityLabel).toBe('Awaiting input');
  });

  it('hides the stage when artifact html or produced files are available', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'running',
      startedAt: Date.now(),
      producedFiles: [{ name: 'index.html', size: 1, mtime: 1, kind: 'html', mime: 'text/html' }],
    };

    expect(buildGenerationPreviewState([assistant], '<html />')).toMatchObject({
      visible: false,
      phase: 'ready',
    });
    expect(buildGenerationPreviewState([assistant], null)).toMatchObject({
      visible: false,
      phase: 'ready',
    });
  });

  it('builds a failed state from an assistant error event', () => {
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'failed',
      startedAt: Date.now() - 8_000,
      events: [{ kind: 'error', message: 'Model request failed' }],
    };

    const state = buildGenerationPreviewState([assistant], null);

    expect(state.visible).toBe(true);
    expect(state.phase).toBe('failed');
    expect(state.steps.some((step) => step.status === 'failed')).toBe(true);
  });

  it('does not surface stale assistant state after a newer user turn starts', () => {
    const staleAssistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runStatus: 'failed',
      startedAt: Date.now() - 8_000,
      events: [{ kind: 'text', text: 'Previous turn failed' }],
    };
    const latestUser: ChatMessage = {
      id: 'u2',
      role: 'user',
      content: 'Try a different layout',
      createdAt: Date.now() - 1_000,
    };

    expect(
      buildGenerationPreviewState([staleAssistant, latestUser], null),
    ).toMatchObject({ visible: false, phase: 'ready' });
  });
});
