import React, { useEffect, useRef } from 'react';
import { ConfirmationDialog } from '@tutti-os/ui-system/components';
import { useTranslation } from '../../i18n';

export interface InspectUnsavedChangesDialogProps {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}

export function InspectUnsavedChangesDialog({ open, onStay, onDiscard }: InspectUnsavedChangesDialogProps) {
  const { t } = useTranslation();
  const lastActionRef = useRef<'stay' | 'discard' | null>(null);

  useEffect(() => {
    if (open) {
      lastActionRef.current = null;
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <ConfirmationDialog
      open={open}
      title={t('inspector.unsavedChanges.title')}
      description={t('inspector.unsavedChanges.description')}
      cancelLabel={t('inspector.unsavedChanges.cancel')}
      confirmLabel={t('inspector.unsavedChanges.confirm')}
      tone="destructive"
      onCancel={() => {
        lastActionRef.current = 'stay';
        onStay();
      }}
      onConfirm={() => {
        lastActionRef.current = 'discard';
        onDiscard();
      }}
      onOpenChange={(open) => {
        if (!open && lastActionRef.current === null) {
          onStay();
        }
      }}
    />
  );
}
