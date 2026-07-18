// @vitest-environment jsdom
import React, { StrictMode, type ReactNode } from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createMentionService = vi.hoisted(() => vi.fn());
const providedServices = vi.hoisted(() => [] as unknown[]);

vi.mock('@tutti-os/workspace-external-core/rich-text', () => ({
  createTuttiExternalRichTextMentionService: createMentionService,
}));

vi.mock('@tutti-os/ui-rich-text/editor', () => ({
  RichTextMentionServiceProvider: ({ children, service }: { children: ReactNode; service: unknown }) => {
    providedServices.push(service);
    return <>{children}</>;
  },
}));

import { TuttiExternalMentionServiceRoot } from './TuttiExternalMentionServiceRoot';

afterEach(() => {
  cleanup();
  createMentionService.mockReset();
  providedServices.splice(0);
});

describe('TuttiExternalMentionServiceRoot', () => {
  it('creates a fresh service for StrictMode replay and disposes each service', () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    createMentionService.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const view = render(
      <StrictMode>
        <TuttiExternalMentionServiceRoot><div>vibe</div></TuttiExternalMentionServiceRoot>
      </StrictMode>,
    );

    expect(createMentionService).toHaveBeenCalledTimes(2);
    expect(createMentionService).toHaveBeenLastCalledWith({
      getBridge: expect.any(Function),
      providerIds: ['workspace-app', 'agent-target'],
    });
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(providedServices.at(-1)).toBe(second);

    view.unmount();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});
