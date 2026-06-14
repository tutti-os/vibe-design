import React from 'react';
import { Button, Card } from '@tutti-os/ui-system/components';
import { ChatIcon, CloseIcon } from '@tutti-os/ui-system/icons';
import { ProjectSecondaryButton } from '../../../components/ProjectSecondaryButton';
import { useTranslation } from '../../../i18n';
import { AutoSizingCommentTextarea } from './AutoSizingCommentTextarea';
import type { CanvasCommentTargetSnapshot } from './canvas-comment-types';

export interface CanvasCommentPopoverProps {
  target: CanvasCommentTargetSnapshot;
  draft: string;
  saving: boolean;
  canSave?: boolean;
  canSend?: boolean;
  onDraftChange(value: string): void;
  onClose(): void;
  onSave(): void;
  onSend(): void;
}

export function CanvasCommentPopover({
  canSave = true,
  canSend = true,
  draft,
  saving,
  target,
  onClose,
  onDraftChange,
  onSave,
  onSend,
}: CanvasCommentPopoverProps) {
  const { t } = useTranslation();
  const canSubmitSave = draft.trim().length > 0 && !saving && canSave;
  const canSubmitSend = draft.trim().length > 0 && !saving && canSend;

  return (
    <Card
      data-testid="canvas-comment-popover"
      className="w-[320px] rounded-[var(--project-radius-lg)] border-[var(--border-1)] bg-[var(--background-fronted)] shadow-[var(--project-shadow-popover)]"
      size="sm"
    >
      <div data-slot="card-content" className="space-y-1.5" style={{ padding: '0 10px' }}>
        <div className="flex h-6 items-center justify-between gap-3">
          <div className="min-w-0 text-sm font-medium text-[var(--text-primary)]">{t('workspace.comments.comment')}</div>
          <Button type="button" size="icon-xs" variant="chrome" aria-label={t('workspace.comments.closeComment')} onClick={onClose}>
            <CloseIcon size={13} />
          </Button>
        </div>

        <div className="sr-only">
          <span>{target.filePath}</span>
          <span>{target.label}</span>
          <span>{target.selector}</span>
        </div>

        <label className="block">
          <span className="sr-only">{t('workspace.comments.commentNote')}</span>
          <AutoSizingCommentTextarea
            ariaLabel={t('workspace.comments.commentNote')}
            placeholder={t('workspace.comments.placeholder')}
            value={draft}
            onChange={onDraftChange}
          />
        </label>

        <div className="flex items-center justify-end gap-2">
          <ProjectSecondaryButton
            type="button"
            disabled={!canSubmitSave}
            className="h-7 px-2.5"
            onClick={onSave}
          >
            {t('visualComment.actions.addComment')}
          </ProjectSecondaryButton>
          <Button
            type="button"
            size="sm"
            className="project-primary-button h-7 rounded-[var(--project-radius-md)] px-2.5 text-[var(--project-font-meta)] font-medium"
            disabled={!canSubmitSend}
            onClick={onSend}
          >
            <ChatIcon size={14} />
            {t('visualComment.actions.sendToAgent')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
