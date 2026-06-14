// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InspectUnsavedChangesDialog } from './InspectUnsavedChangesDialog';

function InspectUnsavedChangesDialogHarness({
  onDiscard,
  onStay,
}: {
  onStay: () => void;
  onDiscard: () => void;
}) {
  const [open, setOpen] = React.useState(true);

  return (
    <InspectUnsavedChangesDialog
      open={open}
      onStay={() => {
        onStay();
        setOpen(false);
      }}
      onDiscard={() => {
        onDiscard();
        setOpen(false);
      }}
    />
  );
}

describe('InspectUnsavedChangesDialog', () => {
  it('does not render when closed', () => {
    render(<InspectUnsavedChangesDialog open={false} onStay={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.queryByText('Discard unsaved inspect changes?')).toBeNull();
  });

  it('renders the copy and keeps the stay action single across the close lifecycle', () => {
    const onStay = vi.fn();
    const onDiscard = vi.fn();

    render(<InspectUnsavedChangesDialogHarness onStay={onStay} onDiscard={onDiscard} />);

    expect(screen.getByText('Discard unsaved inspect changes?')).toBeTruthy();
    expect(
      screen.getByText('Leaving inspect mode now will discard the unsaved edits for the current selection.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard unsaved inspect changes?')).toBeNull();
  });

  it('treats escape dismissal as keep editing', () => {
    const onStay = vi.fn();
    const onDiscard = vi.fn();

    render(<InspectUnsavedChangesDialogHarness onStay={onStay} onDiscard={onDiscard} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard unsaved inspect changes?')).toBeNull();
  });
});
