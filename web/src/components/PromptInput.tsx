import { Node, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  parseRichTextContentToDocument,
  serializeRichTextDocumentToContent,
} from '@tutti-os/ui-rich-text/core';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

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
    const latestValueRef = useRef(value);
    const hiddenInputRef = useRef<HTMLInputElement | null>(null);
    const onChangeRef = useRef(onChange);
    const onEditorKeyDownRef = useRef(onEditorKeyDown);
    const onEditorPasteRef = useRef(onEditorPaste);
    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          gapcursor: false,
          hardBreak: {},
          heading: false,
          horizontalRule: false,
          listItem: false,
          orderedList: false,
        }),
        PromptMentionReference,
        PromptWorkspaceReference,
      ],
      content: promptValueToContent(value),
      editable: !disabled,
      editorProps: {
        attributes: {
          'aria-label': ariaLabel,
          class: ['prompt-input__editor', editorClassName].filter(Boolean).join(' '),
          'data-placeholder': placeholder,
          role: 'textbox',
        },
        handleDOMEvents: {
          paste(_view, event) {
            if (!('clipboardData' in event)) {
              return false;
            }

            const handled = onEditorPasteRef.current?.(event as ClipboardEvent);
            return handled === true || event.defaultPrevented;
          },
        },
        handleKeyDown(_view, event) {
          const handled = onEditorKeyDownRef.current?.(event);
          return handled === true || event.defaultPrevented;
        },
      },
      onUpdate({ editor: nextEditor }) {
        commitText(serializePromptContent(nextEditor.getJSON()));
      },
    });

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onEditorKeyDownRef.current = onEditorKeyDown;
    }, [onEditorKeyDown]);

    useEffect(() => {
      onEditorPasteRef.current = onEditorPaste;
    }, [onEditorPaste]);

    useEffect(() => {
      latestValueRef.current = value;
    }, [value]);

    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [disabled, editor]);

    useLayoutEffect(() => {
      if (!editor || serializePromptContent(editor.getJSON()) === serializePromptValue(value)) {
        return;
      }

      editor.commands.setContent(promptValueToContent(value), { emitUpdate: false });
    }, [editor, value]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          editor?.view.dom.focus();
          editor?.commands.focus();
        },
        focusToEnd() {
          editor?.view.dom.focus();
          editor?.commands.focus('end');
        },
        insertText(text: string) {
          if (!text) return;
          editor?.view.dom.focus();
          editor?.chain().focus().insertContent(text).run();
        },
      }),
      [editor],
    );

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

    function handleInput(event: React.FormEvent<HTMLDivElement>): void {
      const nextText = editor
        ? serializePromptContent(editor.getJSON())
        : event.currentTarget.textContent ?? '';
      if (nextText !== latestValueRef.current) {
        commitText(nextText);
      }
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
      const wasDefaultPrevented = event.defaultPrevented;
      onKeyDown?.(event);
      if (!wasDefaultPrevented && event.defaultPrevented) {
        return;
      }

      if (event.key !== 'Enter') {
        return;
      }

      if (isCompositionEnter(event)) {
        return;
      }

      if (shouldSubmitOnEnter?.(event)) {
        event.preventDefault();
        onSubmitShortcut?.(event);
        return;
      }

      if (event.shiftKey || event.ctrlKey) {
        event.preventDefault();
        return;
      }

      if (event.metaKey) {
        event.preventDefault();
        editor?.chain().focus().setHardBreak().run();
      }
    }

    return (
      <div
        className={['prompt-input', className].filter(Boolean).join(' ')}
        data-empty={value.length === 0 ? 'true' : 'false'}
      >
        {name ? <input ref={hiddenInputRef} type="hidden" name={name} value={value} readOnly /> : null}
        <EditorContent
          editor={editor}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  },
);

const PromptMentionReference = Node.create({
  name: 'mentionReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entityId: { default: '' },
      label: { default: '' },
      presentation: { default: null },
      providerId: { default: '' },
      scope: { default: null },
      trigger: { default: '@' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-rich-text-mention-reference]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const label = normalizePromptReferenceLabel(HTMLAttributes.label);
    return [
      'span',
      {
        'data-rich-text-mention-reference': 'true',
        class: 'prompt-input__reference prompt-input__mention-reference',
      },
      label ? `@${label}` : '@',
    ];
  },
});

const PromptWorkspaceReference = Node.create({
  name: 'workspaceReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'file' },
      label: { default: '' },
      path: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-rich-text-workspace-reference]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const label = normalizePromptReferenceLabel(HTMLAttributes.label) || normalizePromptReferenceLabel(HTMLAttributes.path);
    return [
      'span',
      {
        'data-rich-text-workspace-reference': 'true',
        class: 'prompt-input__reference prompt-input__workspace-reference',
      },
      label || 'file',
    ];
  },
});

function promptValueToContent(value: string): JSONContent {
  const content = parseRichTextContentToDocument(value);
  const trailingLineBreaks = countTrailingLineBreaks(value);
  if (trailingLineBreaks > 0) {
    appendTrailingHardBreaks(content, trailingLineBreaks);
  }
  return content;
}

function serializePromptValue(value: string): string {
  return serializePromptContent(promptValueToContent(value));
}

function serializePromptContent(content: JSONContent): string {
  const serialized = serializeRichTextDocumentToContent(content);
  const trailingHardBreaks = countTrailingHardBreaks(content);
  return trailingHardBreaks > 0 ? `${serialized}${'\n'.repeat(trailingHardBreaks)}` : serialized;
}

function normalizePromptReferenceLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^@+/, '').trim() : '';
}

function countTrailingLineBreaks(value: string): number {
  return value.replace(/\r\n?/g, '\n').match(/\n+$/)?.[0].length ?? 0;
}

function appendTrailingHardBreaks(content: JSONContent, count: number): void {
  const blocks = content.content ?? (content.content = [{ type: 'paragraph' }]);
  let lastBlock = blocks.at(-1);
  if (!lastBlock) {
    lastBlock = { type: 'paragraph' };
    blocks.push(lastBlock);
  }
  const inlineContent = lastBlock.content ?? (lastBlock.content = []);
  for (let index = 0; index < count; index += 1) {
    inlineContent.push({ type: 'hardBreak' });
  }
}

function countTrailingHardBreaks(content: JSONContent): number {
  const lastBlock = content.content?.at(-1);
  if (!lastBlock?.content?.length) {
    return 0;
  }

  let count = 0;
  for (let index = lastBlock.content.length - 1; index >= 0; index -= 1) {
    if (lastBlock.content[index]?.type !== 'hardBreak') {
      break;
    }
    count += 1;
  }
  return count;
}

function isCompositionEnter(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  const nativeEvent = event.nativeEvent;
  return nativeEvent.isComposing || event.keyCode === 229;
}
