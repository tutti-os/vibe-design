// @vitest-environment jsdom

import React, { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TuttiReferenceAddControl } from './TuttiReferenceAddControl';

describe('TuttiReferenceAddControl', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'tuttiExternal');
  });

  it('appends selected application outputs to the prompt', async () => {
    Object.defineProperty(window, 'tuttiExternal', {
      configurable: true,
      value: {
        references: {
          select: vi.fn().mockResolvedValue([
            {
              selectionKind: 'workspace-reference',
              displayName: 'AI Canvas outputs',
              fileCount: 3,
              id: 'ai-canvas',
              source: 'app',
              workspaceId: 'workspace-1',
            },
          ]),
        },
      },
    });
    const onChange = vi.fn();

    render(
      <TuttiReferenceAddControl
        labels={{ addContent: 'Add content' }}
        value="Use these"
        onChange={onChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add content' }));
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        'Use these [@AI Canvas outputs](mention://workspace-reference/ai-canvas?count=3&source=app&workspaceId=workspace-1)',
      );
    });
  });
});
