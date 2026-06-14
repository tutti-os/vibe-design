import type { AgentEvent } from '../types';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'stopped';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

export function parseTodoWriteInput(input: unknown): TodoItem[] {
  if (!input || typeof input !== 'object') return [];

  const record = input as { plan?: unknown; todos?: unknown };
  const rawItems = Array.isArray(record.todos)
    ? record.todos
    : Array.isArray(record.plan)
      ? record.plan
      : [];

  return rawItems
    .map((todo): TodoItem | null => {
      if (!todo || typeof todo !== 'object') return null;

      const todoRecord = todo as Record<string, unknown>;
      const content =
        typeof todoRecord.content === 'string'
          ? todoRecord.content
          : typeof todoRecord.step === 'string'
            ? todoRecord.step
            : '';
      if (!content) return null;

      return {
        content,
        status: normalizeTodoStatus(todoRecord.status),
        activeForm:
          typeof todoRecord.activeForm === 'string'
            ? todoRecord.activeForm
            : typeof todoRecord.active_form === 'string'
              ? todoRecord.active_form
              : undefined,
      };
    })
    .filter((todo): todo is TodoItem => todo !== null);
}

export function latestTodosFromEvents(events: AgentEvent[] | undefined): TodoItem[] {
  if (!events) return [];

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const kind = eventKind(event);
    const name = eventName(event);
    if (kind !== 'tool_use' || !isTodoWriteToolName(name)) continue;
    return parseTodoWriteInput(eventInput(event));
  }

  return [];
}

export function unfinishedTodosFromEvents(events: AgentEvent[] | undefined): TodoItem[] {
  return latestTodosFromEvents(events).filter((todo) => todo.status !== 'completed');
}

export function latestTodoWriteInputFromMessages(
  messages: ReadonlyArray<{ events?: AgentEvent[] | undefined }> | undefined,
): unknown | null {
  if (!messages || messages.length === 0) return null;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const events = messages[messageIndex]?.events;
    if (!events || events.length === 0) continue;

    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (eventKind(event) !== 'tool_use' || !isTodoWriteToolName(eventName(event))) continue;
      return eventInput(event);
    }
  }

  return null;
}

export function latestTodoWriteInputForPinnedCard<
  T extends {
    events?: AgentEvent[] | undefined;
    runStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | undefined;
    endedAt?: number | undefined;
  },
>(messages: ReadonlyArray<T> | undefined): unknown | null {
  if (!messages || messages.length === 0) return null;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const events = message?.events;
    if (!events || events.length === 0) continue;

    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (eventKind(event) !== 'tool_use' || !isTodoWriteToolName(eventName(event))) continue;
      const input = eventInput(event);
      return hasTerminalRunEnded(message.runStatus, message.endedAt)
        ? stoppedTodoWriteInput(input)
        : input;
    }
  }

  return null;
}

export function isTodoWriteToolName(name: string): boolean {
  return (
    name === 'TodoWrite' ||
    name === 'todowrite' ||
    name === 'todo_write' ||
    name === 'update_plan'
  );
}

function normalizeTodoStatus(status: unknown): TodoStatus {
  if (status === 'completed' || status === 'in_progress' || status === 'stopped') {
    return status;
  }
  if (status === 'cancelled' || status === 'canceled' || status === 'failed') {
    return 'stopped';
  }
  return 'pending';
}

function hasTerminalRunEnded(
  runStatus: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | undefined,
  endedAt: number | undefined,
): boolean {
  return (
    runStatus === 'succeeded' ||
    runStatus === 'failed' ||
    runStatus === 'canceled' ||
    (runStatus === undefined && endedAt !== undefined)
  );
}

function stoppedTodoWriteInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;

  const inputRecord = input as { plan?: unknown; todos?: unknown };
  const key = Array.isArray(inputRecord.todos)
    ? 'todos'
    : Array.isArray(inputRecord.plan)
      ? 'plan'
      : null;
  if (!key) return input;

  return {
    ...(input as Record<string, unknown>),
    [key]: (inputRecord[key] as unknown[]).map((todo) => {
      if (!todo || typeof todo !== 'object') return todo;

      const todoRecord = todo as Record<string, unknown>;
      if (todoRecord.status !== 'in_progress') return todo;

      return {
        ...todoRecord,
        status: 'stopped',
      };
    }),
  };
}

function eventKind(event: AgentEvent | undefined): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  return typeof record.kind === 'string' ? record.kind : typeof record.type === 'string' ? record.type : '';
}

function eventName(event: AgentEvent | undefined): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  return typeof record.name === 'string' ? record.name : '';
}

function eventInput(event: AgentEvent | undefined): unknown {
  if (!event || typeof event !== 'object') return undefined;
  return (event as Record<string, unknown>).input;
}
