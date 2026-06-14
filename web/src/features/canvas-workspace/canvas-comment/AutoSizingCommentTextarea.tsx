import React from 'react';
import { Textarea } from '@tutti-os/ui-system/components';

const COMMENT_TEXTAREA_MIN_HEIGHT = 56;
const COMMENT_TEXTAREA_MAX_HEIGHT = 180;

export const COMMENT_TEXTAREA_BASE_CLASS =
  'min-h-[56px] max-h-[180px] resize-none overflow-y-auto rounded-[var(--project-radius-md)] border-[var(--border-1)] bg-[var(--project-input-bg)] py-2 text-[var(--project-font-body)] leading-5 shadow-none hover:bg-[var(--project-input-hover-bg)] focus-visible:border-[var(--border-2)] focus-visible:ring-[color-mix(in_srgb,var(--border-2)_24%,transparent)]';

interface AutoSizingCommentTextareaProps {
  ariaLabel: string;
  value: string;
  placeholder: string;
  onChange(value: string): void;
}

export function AutoSizingCommentTextarea({
  ariaLabel,
  value,
  placeholder,
  onChange,
}: AutoSizingCommentTextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const nextHeight = clampNumber(
      textarea.scrollHeight || COMMENT_TEXTAREA_MIN_HEIGHT,
      COMMENT_TEXTAREA_MIN_HEIGHT,
      COMMENT_TEXTAREA_MAX_HEIGHT,
    );
    textarea.style.height = `${nextHeight}px`;
  }, [value]);

  return (
    <Textarea
      ref={textareaRef}
      aria-label={ariaLabel}
      className={COMMENT_TEXTAREA_BASE_CLASS}
      placeholder={placeholder}
      value={value}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)}
    />
  );
}

export function estimateCommentTextareaHeight(value: string): number {
  const lines = Math.max(
    1,
    value.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 34)), 0),
  );

  return clampNumber(lines * 20 + 16, COMMENT_TEXTAREA_MIN_HEIGHT, COMMENT_TEXTAREA_MAX_HEIGHT);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
