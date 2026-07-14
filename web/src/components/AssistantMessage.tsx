import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@tutti-os/ui-system/components';
import { FailedLinedIcon, LoadingIcon, ThinkingIcon } from '@tutti-os/ui-system/icons';
import type { FileOpEntry } from '../runtime/file-ops';
import type { GeneratedFileEntry, MessageBlock } from '../services/chat-timeline/chat-timeline-types';
import type { ChatMessage } from '../types';
import { useTranslation } from '../i18n';
import { QuestionFormCard } from './QuestionFormCard';
import { ToolCard } from './ToolCard';

const RunningLoadingIcon = LoadingIcon as React.ComponentType<React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  title?: string;
}>;

export interface AssistantMessageProps {
  message: ChatMessage;
  blocks: MessageBlock[];
  streaming: boolean;
  nextUserContent?: string;
  onAnswerToolQuestion?: (toolUseId: string, content: string) => void | Promise<void>;
  onSubmitToolQuestionFallback?: (content: string) => void | Promise<void>;
  toolQuestionSubmissionUnavailable?: boolean;
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
  onOpenFileOp?: (op: FileOpEntry) => void;
}

export function AssistantMessage({
  message,
  blocks,
  streaming,
  nextUserContent,
  onAnswerToolQuestion,
  onSubmitToolQuestionFallback,
  toolQuestionSubmissionUnavailable = false,
  onOpenGeneratedFile,
  onOpenFileOp,
}: AssistantMessageProps) {
  return (
    <div className="assistant-flow" data-message-id={message.id}>
      <div className="chat-message__blocks">
        {streaming && blocks.length === 0 ? <AgentWorkingIndicator /> : null}
        {!streaming && blocks.length === 0 && isEmptyTerminalRun(message.runStatus) ? (
          <AgentTerminalIndicator status={message.runStatus} />
        ) : null}
        {blocks.map((block, index) => (
          <AssistantBlock
            key={`${block.kind}-${index}`}
            block={block}
            streaming={streaming}
            nextUserContent={nextUserContent}
            onAnswerToolQuestion={onAnswerToolQuestion}
            onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
            toolQuestionSubmissionUnavailable={toolQuestionSubmissionUnavailable}
            onOpenGeneratedFile={onOpenGeneratedFile}
            onOpenFileOp={onOpenFileOp}
          />
        ))}
        {streaming && blocks.length > 0 ? <AgentWorkingIndicator /> : null}
      </div>
    </div>
  );
}

function isEmptyTerminalRun(status: ChatMessage['runStatus']): status is 'succeeded' | 'failed' | 'canceled' {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function AgentWorkingIndicator() {
  const { t } = useTranslation();

  return (
    <div className="chat-message__running" aria-label={t('chat.message.agentWorkingStatus')} role="status">
      <RunningLoadingIcon className="chat-message__running-icon" size={15} title={t('chat.message.agentWorking')} />
      <span>{t('chat.message.running')}</span>
    </div>
  );
}

function AgentTerminalIndicator({ status }: { status: 'succeeded' | 'failed' | 'canceled' }) {
  const { t } = useTranslation();

  return (
    <div className="chat-message__terminal" aria-label={t('chat.message.agentRunStatus')} role="status">
      <span>{terminalRunLabel(status, t)}</span>
    </div>
  );
}

function terminalRunLabel(status: 'succeeded' | 'failed' | 'canceled', t: ReturnType<typeof useTranslation>['t']): string {
  if (status === 'succeeded') return t('chat.message.completed');
  if (status === 'canceled') return t('chat.message.canceled');
  return status;
}

function AssistantBlock({
  block,
  streaming,
  nextUserContent,
  onAnswerToolQuestion,
  onSubmitToolQuestionFallback,
  toolQuestionSubmissionUnavailable,
  onOpenGeneratedFile,
  onOpenFileOp,
}: {
  block: MessageBlock;
  streaming: boolean;
  nextUserContent?: string;
  onAnswerToolQuestion?: (toolUseId: string, content: string) => void | Promise<void>;
  onSubmitToolQuestionFallback?: (content: string) => void | Promise<void>;
  toolQuestionSubmissionUnavailable: boolean;
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
  onOpenFileOp?: (op: FileOpEntry) => void;
}) {
  const { t } = useTranslation();

  if (block.kind === 'text') {
    if (block.markdown) {
      return <MarkdownText content={block.content} onOpenGeneratedFile={onOpenGeneratedFile} />;
    }
    return <p className="chat-message__text">{block.content}</p>;
  }
  if (block.kind === 'thinking') {
    return (
      <details className="chat-message__thinking">
        <summary>
          <Badge variant="secondary">
            <ThinkingIcon size={14} />
            <span>{streaming ? t('chat.message.thinking') : t('chat.message.thoughtProcess')}</span>
          </Badge>
        </summary>
        <MarkdownContent className="chat-message__thinking-content chat-message__markdown" content={block.content} />
      </details>
    );
  }
  if (block.kind === 'error') {
    return <AgentErrorBlock code={block.code} message={block.message} />;
  }
  if (block.kind === 'tool-group') {
    return (
      <ToolCard
        kind="tool-group"
        calls={block.calls}
        results={block.results}
        streaming={streaming && (block.running ?? true)}
      />
    );
  }
  if (block.kind === 'file-ops') {
    return <ToolCard kind="file-ops" ops={block.ops} onOpenFileOp={onOpenFileOp} />;
  }
  if (block.kind === 'generated-files') {
    return <ToolCard kind="generated-files" files={block.files} onOpenGeneratedFile={onOpenGeneratedFile} />;
  }
  if (block.kind === 'ask-user-question') {
    return (
      <ToolCard
        kind="ask-user-question"
        toolUseId={block.toolUseId}
        input={block.input}
        live={streaming}
        answered={block.answered}
        nextUserContent={nextUserContent}
        onAnswer={onAnswerToolQuestion}
        onFallbackAnswer={onSubmitToolQuestionFallback}
        submissionUnavailable={toolQuestionSubmissionUnavailable}
      />
    );
  }
  if (block.kind === 'question-form') {
    return (
      <QuestionFormCard
        form={block.form}
        interactive={!streaming}
        nextUserContent={nextUserContent}
        onSubmit={onSubmitToolQuestionFallback}
        submissionUnavailable={toolQuestionSubmissionUnavailable}
      />
    );
  }
  return <ToolCard kind="todo-write" input={block.input} />;
}

function AgentErrorBlock({ code, message }: { code?: string; message: string }) {
  const { t } = useTranslation();
  const displayMessage = message === 'Agent run failed' ? t('chat.message.agentRunFailed') : message;

  return (
    <div className="chat-message__error" role="alert">
      <div className="chat-message__error-surface">
        <Badge variant="destructive">
          <FailedLinedIcon size={14} />
          <span>{t('chat.message.agentError')}</span>
        </Badge>
        <div className="chat-message__error-body">
          {code ? <span className="chat-message__error-code">{code}</span> : null}
          <span className="chat-message__error-message">{displayMessage}</span>
        </div>
      </div>
    </div>
  );
}

function MarkdownText({
  content,
  onOpenGeneratedFile,
}: {
  content: string;
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
}) {
  return (
    <MarkdownContent
      className="chat-message__text chat-message__markdown"
      content={content}
      onOpenGeneratedFile={onOpenGeneratedFile}
    />
  );
}

function MarkdownContent({
  className,
  content,
  onOpenGeneratedFile,
}: {
  className: string;
  content: string;
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ href, children, ...props }) => {
            const projectFileName = projectFileNameFromMarkdownHref(href);
            if (projectFileName && onOpenGeneratedFile) {
              return (
                <a
                  {...props}
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenGeneratedFile({ name: projectFileName });
                  }}
                >
                  {children}
                </a>
              );
            }

            return (
              <a {...props} href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          },
          code: ({ children, ...props }) => (
            <code {...props}>{typeof children === 'string' ? children.replace(/\n$/, '') : children}</code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function safeMarkdownUrl(href: string): string {
  return /^(https?:|mailto:|\/|#)/.test(href) ? href : '';
}

function projectFileNameFromMarkdownHref(href: string | undefined): string | null {
  if (!href) return null;

  const marker = href.includes('/api/projects/') ? '/files/' : href.includes('/static/projects/') ? '/assets/' : null;
  if (!marker) return null;

  const markerIndex = href.indexOf(marker);
  if (markerIndex < 0) return null;

  const rawName = href.slice(markerIndex + marker.length).split(/[?#]/, 1)[0] ?? '';
  if (!rawName) return null;

  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}
