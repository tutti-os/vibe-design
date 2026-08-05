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
    const onUploadFile = vi.fn();

    render(
      <TuttiReferenceAddControl
        labels={{
          addContent: 'Add content',
          browseReferences: 'Browse references',
          uploadFile: 'Upload file',
        }}
        value="Use these"
        onChange={onChange}
        onUploadFile={onUploadFile}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(
        screen.getByRole('button', { name: 'Add content' }),
        { button: 0, ctrlKey: false },
      );
    });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Browse references' }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        'Use these [@AI Canvas outputs](mention://workspace-reference/ai-canvas?count=3&source=app&workspaceId=workspace-1)',
      );
    });
  });
});
