import React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusDot,
} from '@tutti-os/ui-system/components';
import {
  CheckIcon,
  FailedLinedIcon,
  FileTextIcon,
  GuideIcon,
  TaskIcon,
  ToolsIcon,
} from '@tutti-os/ui-system/icons';
import type { FileOpEntry } from '../runtime/file-ops';
import { parseTodoWriteInput, type TodoItem } from '../runtime/todos';
import type { QuestionFormAnswers, QuestionFormDefinition } from '../runtime/question-form';
import { type TranslateFn, useTranslation } from '../i18n';
import type {
  AskUserQuestionInput,
  GeneratedFileEntry,
  ToolCall,
  ToolResult,
} from '../services/chat-timeline/chat-timeline-types';
import { QuestionFormCard } from './QuestionFormCard';

type ToolStatus = 'done' | 'running' | 'error';

export type ToolCardProps =
  | {
      kind: 'tool-group';
      calls: ToolCall[];
      results: ToolResult[];
      streaming: boolean;
    }
  | {
      kind: 'file-ops';
      ops: FileOpEntry[];
      onOpenFileOp?: (op: FileOpEntry) => void;
    }
  | {
      kind: 'generated-files';
      files: GeneratedFileEntry[];
      onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
    }
  | {
      kind: 'ask-user-question';
      toolUseId: string;
      input: AskUserQuestionInput;
      live: boolean;
      answered?: boolean;
      nextUserContent?: string;
      onAnswer?: (toolUseId: string, content: string) => void | Promise<void>;
      onFallbackAnswer?: (content: string) => void | Promise<void>;
      submissionUnavailable?: boolean;
    }
  | {
      kind: 'todo-write';
      input: unknown;
    };

interface ParsedQuestion {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
}

export function ToolCard(props: ToolCardProps) {
  if (props.kind === 'tool-group') {
    return <ToolGroupCard calls={props.calls} results={props.results} streaming={props.streaming} />;
  }
  if (props.kind === 'file-ops') return <FileOpsCard ops={props.ops} onOpenFileOp={props.onOpenFileOp} />;
  if (props.kind === 'generated-files') {
    return <GeneratedFilesCard files={props.files} onOpenGeneratedFile={props.onOpenGeneratedFile} />;
  }
  if (props.kind === 'ask-user-question') {
    return (
      <QuestionCard
        toolUseId={props.toolUseId}
        input={props.input}
        live={props.live}
        answered={props.answered}
        nextUserContent={props.nextUserContent}
        onAnswer={props.onAnswer}
        onFallbackAnswer={props.onFallbackAnswer}
        submissionUnavailable={props.submissionUnavailable}
      />
    );
  }
  return <TodoCard input={props.input} />;
}

function GeneratedFilesCard({
  files,
  onOpenGeneratedFile,
}: {
  files: GeneratedFileEntry[];
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
}) {
  const { t } = useTranslation();
  const visibleFiles = uniqueGeneratedFiles(files);

  return (
    <Card size="sm">
      <CardHeader>
        <div className="tool-card__header">
          <CardTitle className="tool-card__title">
            <FileTextIcon size={16} />
            <span>{t('tools.generatedFiles')}</span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="tool-card__content">
        <ul className="tool-card__list">
          {visibleFiles.map((file) => {
            const displayName = generatedFileDisplayName(file.name);

            return (
              <li className="tool-card__row tool-card__generated-row" key={file.name}>
                <span className="tool-card__generated-main">
                  {onOpenGeneratedFile ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto min-w-0 max-w-full justify-start whitespace-normal px-0 py-0 text-left"
                      title={file.name}
                      onClick={() => onOpenGeneratedFile(file)}
                    >
                      <span className="tool-card__file-name">{displayName}</span>
                    </Button>
                  ) : (
                    <span className="tool-card__file-name" title={file.name}>
                      {displayName}
                    </span>
                  )}
                  <span className="tool-card__meta">{generatedFileMeta(file, t)}</span>
                </span>
                <Badge variant="outline">HTML</Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function generatedFileDisplayName(name: string): string {
  const normalized = name.trim().replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).at(-1) ?? name;
}

function uniqueGeneratedFiles(files: GeneratedFileEntry[]): GeneratedFileEntry[] {
  const uniqueFiles: GeneratedFileEntry[] = [];
  for (const file of files) {
    if (uniqueFiles.some((existingFile) => sameGeneratedFilePath(existingFile.name, file.name))) continue;
    uniqueFiles.push(file);
  }
  return uniqueFiles;
}

function sameGeneratedFilePath(left: string, right: string): boolean {
  const normalizedLeft = normalizeGeneratedFilePath(left);
  const normalizedRight = normalizeGeneratedFilePath(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function normalizeGeneratedFilePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

export function TodoCard({ input }: { input: unknown }) {
  const todos = parseTodoWriteInput(input);
  const { t } = useTranslation();

  return (
    <Card size="sm">
      <CardHeader>
        <div className="tool-card__header">
          <CardTitle className="tool-card__title">
            <TaskIcon size={16} />
            <span>{t('tools.todos')}</span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="tool-card__content">
        {todos.length === 0 ? (
          <span className="tool-card__meta">{t('tools.noTodos')}</span>
        ) : (
          <ul className="tool-card__list">
            {todos.map((todo, index) => (
              <TodoRow key={`${todo.content}-${index}`} todo={todo} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ToolGroupCard({
  calls,
  results,
  streaming,
}: {
  calls: ToolCall[];
  results: ToolResult[];
  streaming: boolean;
}) {
  const status = toolGroupStatus(calls, results, streaming);
  const { t } = useTranslation();
  const noInput = t('tools.noInput');
  const commandPreview = calls.map((call) => summarizeToolInput(call.input, t)).find((summary) => summary !== noInput);
  const resultsByToolUseId = new Map(results.map((result) => [result.toolUseId, result]));

  return (
    <Card size="sm">
      <details className="tool-card__details">
        <summary>
          <CardHeader>
            <div className="tool-card__header">
              <div className="tool-card__heading">
                <CardTitle className="tool-card__title">
                  <ToolsIcon size={16} />
                  <span>{t('tools.toolCalls')}</span>
                </CardTitle>
                {commandPreview ? (
                  <span className="tool-card__meta tool-card__summary-command" title={commandPreview}>
                    {commandPreview}
                  </span>
                ) : null}
              </div>
              <StatusBadge status={status} />
            </div>
          </CardHeader>
        </summary>
        <CardContent className="tool-card__content">
          <ul className="tool-card__list">
            {calls.map((call) => {
              const result = resultsByToolUseId.get(call.id);
              return (
                <li className="tool-card__row" key={call.id}>
                  <span>{call.name}</span>
                  <span className="tool-card__meta">{summarizeToolInput(call.input, t)}</span>
                  {result ? (
                    <span className="tool-card__meta" data-tool-result-error={result.isError ? 'true' : undefined}>
                      {summarizeToolResult(result)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </details>
    </Card>
  );
}

function FileOpsCard({
  ops,
  onOpenFileOp,
}: {
  ops: FileOpEntry[];
  onOpenFileOp?: (op: FileOpEntry) => void;
}) {
  const { t } = useTranslation();
  const status: ToolStatus = ops.some((op) => op.status === 'error')
    ? 'error'
    : ops.some((op) => op.status === 'running')
      ? 'running'
      : 'done';

  return (
    <Card size="sm">
      <CardHeader>
        <div className="tool-card__header">
          <CardTitle className="tool-card__title">
            <FileTextIcon size={16} />
            <span>{t('tools.fileOperations')}</span>
          </CardTitle>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="tool-card__content">
        <ul className="tool-card__list">
          {ops.map((op) => {
            const canOpenFileOp = Boolean(onOpenFileOp) && isOpenableFileOp(op);

            return (
              <li className="tool-card__row" key={op.fullPath}>
                {canOpenFileOp ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto min-w-0 justify-start px-0 py-0 text-left"
                    aria-label={t('tools.openFile', { path: op.path })}
                    title={op.fullPath}
                    onClick={() => onOpenFileOp?.(op)}
                  >
                    <span className="truncate">{op.path}</span>
                  </Button>
                ) : (
                  <span>{op.path}</span>
                )}
                <span className="tool-card__meta">{op.ops.join(', ')}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function isOpenableFileOp(op: FileOpEntry): boolean {
  return op.opCounts.write > 0 || op.opCounts.edit > 0;
}

function QuestionCard({
  toolUseId,
  input,
  live,
  answered,
  nextUserContent,
  onAnswer,
  onFallbackAnswer,
  submissionUnavailable = false,
}: {
  toolUseId: string;
  input: AskUserQuestionInput;
  live: boolean;
  answered?: boolean;
  nextUserContent?: string;
  onAnswer?: (toolUseId: string, content: string) => void | Promise<void>;
  onFallbackAnswer?: (content: string) => void | Promise<void>;
  submissionUnavailable?: boolean;
}) {
  const questions = parseAskUserQuestionInput(input);
  const { t } = useTranslation();

  if (questions.length === 0) {
    return (
      <Card size="sm">
        <CardHeader>
          <div className="tool-card__header">
            <CardTitle className="tool-card__title">
              <GuideIcon size={16} />
              <span>{t('questionForm.quickBrief')}</span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <span className="tool-card__meta">{t('tools.waitingForInput')}</span>
        </CardContent>
      </Card>
    );
  }

  const submit = live ? onAnswer : onFallbackAnswer;
  const form = askUserQuestionForm(questions, t);

  return (
    <QuestionFormCard
      form={form}
      interactive={true}
      answered={answered}
      nextUserContent={nextUserContent}
      requireAllAnswers
      submitErrorMessage={t('tools.answerFailed')}
      formatSubmitContent={(_form, answers) => formatAskUserQuestionAnswers(questions, answers) ?? ''}
      onSubmit={
        submit
          ? (content) => {
              if (live) {
                return (submit as (toolUseId: string, content: string) => void | Promise<void>)(toolUseId, content);
              }
              return (submit as (content: string) => void | Promise<void>)(content);
            }
          : undefined
      }
      submissionUnavailable={submissionUnavailable}
    />
  );
}

function TodoRow({ todo }: { todo: TodoItem }) {
  return (
    <li className="tool-card__todo">
      {todo.status === 'completed' ? <CheckIcon size={14} /> : <StatusDot tone={todoTone(todo.status)} />}
      <span>{todo.content}</span>
    </li>
  );
}

function StatusBadge({ status }: { status: ToolStatus }) {
  const tone = status === 'error' ? 'red' : status === 'done' ? 'green' : 'blue';
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'error' ? 'destructive' : 'secondary'}>
      {status === 'error' ? <FailedLinedIcon size={14} /> : <StatusDot tone={tone} pulse={status === 'running'} />}
      <span>{toolStatusLabel(status, t)}</span>
    </Badge>
  );
}

function toolGroupStatus(calls: ToolCall[], results: ToolResult[], streaming: boolean): ToolStatus {
  if (results.some((result) => result.isError)) return 'error';
  if (streaming && results.length < calls.length) return 'running';
  return 'done';
}

function summarizeToolInput(input: Record<string, unknown>, t: TranslateFn): string {
  const path = readString(input.file_path) ?? readString(input.path);
  if (path) return path;

  const command = readString(input.command);
  if (command) return command;

  const keys = Object.keys(input);
  return keys.length === 0 ? t('tools.noInput') : keys.slice(0, 3).join(', ');
}

function summarizeToolResult(result: ToolResult): string {
  const normalized = result.content.replace(/\s+/g, ' ').trim();
  if (!normalized) return result.isError ? 'Error' : 'Done';
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function generatedFileMeta(file: GeneratedFileEntry, t: TranslateFn): string {
  return file.title || file.artifactType || t('tools.generatedArtifact');
}

function toolStatusLabel(status: ToolStatus, t: TranslateFn): string {
  if (status === 'done') return t('tools.status.done');
  if (status === 'error') return t('tools.status.error');
  return t('tools.status.running');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function todoTone(status: TodoItem['status']): 'blue' | 'green' | 'neutral' | 'amber' {
  if (status === 'completed') return 'green';
  if (status === 'in_progress') return 'blue';
  if (status === 'stopped') return 'amber';
  return 'neutral';
}

function parseAskUserQuestionInput(input: AskUserQuestionInput): ParsedQuestion[] {
  const questions = Array.isArray(input.questions)
    ? input.questions
    : typeof input.question === 'string'
      ? [input]
      : [];

  return questions.flatMap((rawQuestion): ParsedQuestion[] => {
    if (!rawQuestion || typeof rawQuestion !== 'object') return [];
    const record = rawQuestion as Record<string, unknown>;
    const question = typeof record.question === 'string' ? record.question : '';
    if (!question) return [];

    const options = Array.isArray(record.options)
      ? record.options.flatMap((rawOption): ParsedQuestion['options'] => {
          if (typeof rawOption === 'string') return [{ label: rawOption }];
          if (!rawOption || typeof rawOption !== 'object') return [];
          const optionRecord = rawOption as Record<string, unknown>;
          const label = typeof optionRecord.label === 'string' ? optionRecord.label : '';
          if (!label) return [];
          const description =
            typeof optionRecord.description === 'string' ? optionRecord.description : undefined;
          return [{ label, description }];
        })
      : [];

    if (options.length === 0) return [];
    const header = typeof record.header === 'string' ? record.header : undefined;
    return [{ header, question, options }];
  });
}

function askUserQuestionForm(questions: ParsedQuestion[], t: TranslateFn): QuestionFormDefinition {
  return {
    id: 'ask-user-question',
    title: t('questionForm.quickBrief'),
    questions: questions.map((question, index) => ({
      id: `q${index + 1}`,
      title: question.header ? `${question.header} · ${question.question}` : question.question,
      type: 'select',
      options: question.options.map((option) => ({
        value: option.label,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    })),
  };
}

function formatAskUserQuestionAnswers(
  questions: ParsedQuestion[],
  answers: QuestionFormAnswers,
): string | null {
  const formattedAnswers = questions.map((question, index) => {
    const value = answers[`q${index + 1}`];
    return {
      question,
      answer: typeof value === 'string' ? value.trim() : '',
    };
  });
  if (formattedAnswers.some(({ answer }) => answer.length === 0)) {
    return null;
  }

  if (formattedAnswers.length === 1) {
    return formattedAnswers[0]?.answer ?? null;
  }

  return formattedAnswers
    .map(({ question, answer }, index) => `${index + 1}. ${question.question} ${answer}`)
    .join('\n');
}
