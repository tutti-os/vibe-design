import { RichTextTriggerEditor, type RichTextTriggerEditorProps } from '@tutti-os/ui-rich-text/editor';
import '@tutti-os/ui-rich-text/at-panel/index.css';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type TranslateFn, useTranslation } from '../i18n';

export interface PromptInputHandle {
  focus(): void;
  focusToEnd(): void;
  insertText(text: string): void;
}

export interface PromptInputProps {
  ariaLabel: string;
  value: string;
  onChange(value: string): void;
  className?: string;
  disabled?: boolean;
  editorClassName?: string;
  name?: string;
  placeholder?: string;
  onEditorKeyDown?(event: KeyboardEvent): boolean | void;
  onEditorPaste?(event: ClipboardEvent): boolean | void;
  onKeyDown?(event: React.KeyboardEvent<HTMLDivElement>): void;
  shouldSubmitOnEnter?(event: React.KeyboardEvent<HTMLDivElement>): boolean;
  onSubmitShortcut?(event: React.KeyboardEvent<HTMLDivElement>): void;
}

type MentionPaletteOptions = NonNullable<RichTextTriggerEditorProps['palette']>;

export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(
  function PromptInput({
    ariaLabel,
    className = '',
    disabled = false,
    editorClassName = '',
    name,
    onChange,
    onEditorKeyDown,
    onEditorPaste,
    onKeyDown,
    onSubmitShortcut,
    placeholder = '',
    shouldSubmitOnEnter,
    value,
  }, ref) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const hiddenInputRef = useRef<HTMLInputElement | null>(null);
    const latestValueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const onEditorKeyDownRef = useRef(onEditorKeyDown);
    const onEditorPasteRef = useRef(onEditorPaste);
    const [focusSignal, setFocusSignal] = useState<object | null>(null);
    const mentionPalette = useMemo(() => createMentionPalette(t), [t]);
    const editorValue = encodeTrailingLineBreaks(value);

    useEffect(() => {
      latestValueRef.current = value;
    }, [value]);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onEditorKeyDownRef.current = onEditorKeyDown;
    }, [onEditorKeyDown]);

    useEffect(() => {
      onEditorPasteRef.current = onEditorPaste;
    }, [onEditorPaste]);

    useLayoutEffect(() => {
      applyEditorAttributes();

      const container = containerRef.current;
      if (!container || typeof MutationObserver === 'undefined') {
        return;
      }

      const observer = new MutationObserver(() => applyEditorAttributes());
      observer.observe(container, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, [ariaLabel, placeholder]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          focusEditor();
        },
        focusToEnd() {
          focusEditor();
        },
        insertText(text: string) {
          if (!text) return;
          focusEditor();
          if (tryInsertTextAtSelection(text)) {
            return;
          }
          commitText(`${latestValueRef.current}${text}`);
        },
      }),
      [],
    );

    function getEditorElement(): HTMLElement | null {
      return containerRef.current?.querySelector<HTMLElement>('[contenteditable]') ?? null;
    }

    function applyEditorAttributes(): void {
      const editor = getEditorElement();
      if (!editor) return;
      editor.setAttribute('aria-label', ariaLabel);
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('data-placeholder', placeholder);
    }

    function focusEditor(): void {
      setFocusSignal({});
      const editor = getEditorElement();
      if (!editor) return;
      editor.focus();
      moveCaretToEnd(editor);
    }

    function commitText(nextValue: string): void {
      if (nextValue === latestValueRef.current) {
        return;
      }

      latestValueRef.current = nextValue;
      if (hiddenInputRef.current) {
        hiddenInputRef.current.value = nextValue;
      }
      onChangeRef.current(nextValue);
    }

    function handleChange(nextValue: string): void {
      commitText(decodeTrailingLineBreaks(nextValue));
    }

    function handlePaste(event: React.ClipboardEvent<HTMLDivElement>): void {
      const handled = onEditorPasteRef.current?.(event.nativeEvent);
      if (handled === true || event.defaultPrevented) {
        event.preventDefault();
      }
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
      onKeyDown?.(event);
      if (event.key !== 'Enter') {
        return;
      }

      if (isCompositionEnter(event)) {
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      const activeMentionQuery = hasActiveMentionQuery();
      if (activeMentionQuery) {
        return;
      }

      const handled = onEditorKeyDownRef.current?.(event.nativeEvent);
      if (handled === true || event.nativeEvent.defaultPrevented) {
        event.preventDefault();
        return;
      }

      if (shouldSubmitOnEnter?.(event)) {
        event.preventDefault();
        onSubmitShortcut?.(event);
        return;
      }

      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (!tryInsertTextAtSelection('\n')) {
          commitText(`${latestValueRef.current}\n`);
        }
      }
    }

    function hasActiveMentionQuery(): boolean {
      const editor = getEditorElement();
      const selection = typeof window === 'undefined' ? null : window.getSelection();
      const anchorNode = selection?.anchorNode;
      if (!editor || !selection || selection.rangeCount === 0 || !anchorNode || !editor.contains(anchorNode)) {
        return /[@＠][^\s@＠]*$/.test(latestValueRef.current);
      }

      const range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(editor);
      range.setEnd(anchorNode, selection.anchorOffset);
      return /[@＠][^\s@＠]*$/.test(range.toString());
    }

    return (
      <div
        ref={containerRef}
        className={['prompt-input', className].filter(Boolean).join(' ')}
        data-empty={value.length === 0 ? 'true' : 'false'}
        onKeyDownCapture={handleKeyDown}
        onPasteCapture={handlePaste}
      >
        {name ? <input ref={hiddenInputRef} type="hidden" name={name} value={value} readOnly /> : null}
        <RichTextTriggerEditor
          value={editorValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          textareaClassName={['prompt-input__editor', editorClassName].filter(Boolean).join(' ')}
          placeholderClassName={['prompt-input__placeholder', editorClassName].filter(Boolean).join(' ')}
          focusSignal={focusSignal}
          maxResults={20}
          menuAnchor="cursor"
          menuPlacement="auto-start"
          palette={mentionPalette}
          textOverrides={{
            loadingLabel: t('chat.composer.searchingContext'),
            noMatchesLabel: t('chat.composer.noContextResults'),
          }}
        />
      </div>
    );
  },
);

function createMentionPalette(t: TranslateFn): MentionPaletteOptions {
  return {
    categories: [
      {
        id: 'apps',
        label: t('chat.composer.mentionFilterApps'),
        providerIds: ['workspace-app'],
      },
      {
        id: 'agents',
        label: t('chat.composer.mentionFilterAgents'),
        providerIds: ['agent-target'],
      },
    ],
    defaultCategoryId: 'agents',
    labels: {
      tabHint: t('chat.composer.mentionResults'),
      cycleFilter: t('chat.composer.mentionSwitchTabs'),
      moveSelection: t('chat.composer.mentionMoveSelection'),
      empty: t('chat.composer.noContextResults'),
      listbox: t('chat.composer.mentionResults'),
    },
    maxHeightPx: 320,
  };
}

const TRAILING_LINE_BREAK_MARKER = '\u200B';

function encodeTrailingLineBreaks(value: string): string {
  return /\n$/.test(value) ? `${value}${TRAILING_LINE_BREAK_MARKER}` : value;
}

function decodeTrailingLineBreaks(value: string): string {
  return value.endsWith(`\n${TRAILING_LINE_BREAK_MARKER}`)
    ? value.slice(0, -TRAILING_LINE_BREAK_MARKER.length)
    : value;
}

function isCompositionEnter(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (event.nativeEvent.isComposing) {
    return true;
  }

  const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number; which?: number };
  return nativeEvent.keyCode === 229 || nativeEvent.which === 229;
}

function moveCaretToEnd(element: HTMLElement): void {
  if (typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function tryInsertTextAtSelection(text: string): boolean {
  const command = document.execCommand;
  if (typeof command !== 'function') {
    return false;
  }

  return command.call(document, 'insertText', false, text);
}
