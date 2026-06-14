import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GenerationPreviewStage } from './GenerationPreviewStage';
import type { GenerationPreviewStageState } from '../runtime/generation-preview';

function state(overrides: Partial<GenerationPreviewStageState> = {}): GenerationPreviewStageState {
  return {
    visible: true,
    phase: 'generate',
    activityLabel: 'Sketching layout',
    todoProgress: { done: 2, total: 3 },
    projectKind: 'deck',
    steps: [
      { id: 'understand', label: 'Understanding request', status: 'succeeded' },
      { id: 'generate', label: 'Generating deck', status: 'running', detail: 'Writing slides' },
      { id: 'prepare', label: 'Preparing preview', status: 'pending' },
    ],
    ...overrides,
  };
}

describe('GenerationPreviewStage', () => {
  it('renders generating state with progress and task count', () => {
    const html = renderToString(<GenerationPreviewStage state={state()} />);

    expect(html).toContain('Creating your deck');
    expect(html).toContain('Sketching layout');
    expect(html.replaceAll('<!-- -->', '')).toContain('2 / 3 tasks');
    expect(html).toContain('Preparing preview');
    expect(html).toContain('Writing slides');
  });

  it('renders failed state with retry button when retry is available', () => {
    const html = renderToString(<GenerationPreviewStage state={state({ phase: 'failed' })} onRetry={vi.fn()} />);

    expect(html).toContain('Generation failed');
    expect(html).toContain('Something went wrong. Please try again.');
    expect(html).toContain('Retry');
  });

  it('does not render when the scheme state is not visible', () => {
    const html = renderToString(<GenerationPreviewStage state={state({ visible: false, phase: 'ready' })} />);

    expect(html).toBe('');
  });
});
