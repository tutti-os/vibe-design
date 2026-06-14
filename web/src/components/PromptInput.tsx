import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
          hardBreak: false,
          heading: false,
          horizontalRule: false,
          listItem: false,
          orderedList: false,
        }),
      ],
      content: plainTextToContent(value),
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
        commitText(nextEditor.getText({ blockSeparator: '\n' }));
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
      if (!editor || editor.getText({ blockSeparator: '\n' }) === value) {
        return;
      }

      editor.commands.setContent(plainTextToContent(value), { emitUpdate: false });
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
      const nextText = editor?.getText({ blockSeparator: '\n' }) ?? event.currentTarget.textContent ?? '';
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

      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        event.preventDefault();
        editor?.chain().focus().splitBlock().run();
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

function plainTextToContent(value: string): JSONContent {
  const lines = value.split(/\r?\n/);
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line.length > 0 ? [{ type: 'text', text: line }] : undefined,
    })),
  };
}

function isCompositionEnter(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  const nativeEvent = event.nativeEvent;
  return nativeEvent.isComposing || event.keyCode === 229;
}
