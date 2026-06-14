import type { AgentEvent, ChatMessage, LiveArtifactWorkspaceEntry, ProjectFile } from '../types';
import { isLiveArtifactTabId } from '../types';
import { isTodoWriteToolName, latestTodosFromEvents, type TodoItem } from './todos';

export type GenerationStepStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type GenerationPhase =
  | 'understand'
  | 'generate'
  | 'prepare'
  | 'ready'
  | 'waiting'
  | 'failed';

export interface StageStep {
  id: 'understand' | 'generate' | 'prepare';
  label: string;
  status: GenerationStepStatus;
  detail?: string;
}

export type GenerationPreviewStep = StageStep;

export interface GenerationPreviewStageState {
  visible: boolean;
  phase: GenerationPhase;
  steps: StageStep[];
  activityLabel: string | null;
  todoProgress: { done: number; total: number } | null;
  projectKind?: string;
}

export type GenerationPreviewModel = GenerationPreviewStageState;

const WRITE_LIKE_TOOL_RE = /^(write|edit|multiedit|bash|run_terminal_cmd)$/i;
const PREVIEWABLE_FILE = /\.(html?|jsx|tsx|svg|md|pdf|pptx?|key)$/i;

const READY_STATE: GenerationPreviewStageState = {
  visible: false,
  phase: 'ready',
  steps: [],
  activityLabel: null,
  todoProgress: null,
};

export function workspaceHasPreviewSurface(input: {
  activeTab: string | null;
  projectFiles: ProjectFile[];
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  streamingArtifactHtml?: string | null | undefined;
}): boolean {
  if (input.streamingArtifactHtml?.trim()) return true;

  const activeTab = input.activeTab;
  if (!activeTab) return false;

  if (isLiveArtifactTabId(activeTab)) {
    return input.liveArtifacts.some((entry) => entry.tabId === activeTab);
  }

  const activeFile = input.projectFiles.find((file) => file.name === activeTab);
  if (!activeFile) return false;

  if (
    activeFile.kind === 'image'
    || activeFile.kind === 'video'
    || activeFile.kind === 'audio'
    || activeFile.kind === 'sketch'
  ) {
    return true;
  }

  if (PREVIEWABLE_FILE.test(activeFile.name)) return true;
  return activeFile.kind === 'html' || activeFile.kind === 'code' || activeFile.kind === 'text';
}

export function buildGenerationPreviewState(
  messages: ChatMessage[],
  artifactHtml: string | null,
): GenerationPreviewStageState {
  if (artifactHtml?.trim()) return READY_STATE;

  const activeMessage = latestStageAssistant(messages);
  if (!activeMessage) return READY_STATE;
  if ((activeMessage.producedFiles ?? []).length > 0) return READY_STATE;

  const events = activeMessage.events ?? [];
  const phase = derivePhase(events, activeMessage);
  if (phase === 'ready') return READY_STATE;

  const todos = latestTodosFromEvents(events);
  const todoProgress =
    todos.length > 0
      ? {
          done: todos.filter((todo) => todo.status === 'completed' || todo.status === 'in_progress').length,
          total: todos.length,
        }
      : null;

  return {
    visible: true,
    phase,
    steps: buildSteps(phase, events, Boolean(artifactHtml?.trim())),
    activityLabel: deriveActivityLabel(phase, events, todos),
    todoProgress,
    projectKind: activeMessage.projectKind,
  };
}

export function derivePrototypeGenerationSteps(input: {
  events: AgentEvent[];
  hasArtifactHtml: boolean;
  hasPreviewSurface: boolean;
  failed: boolean;
}): StageStep[] {
  const phase = input.failed
    ? 'failed'
    : input.hasPreviewSurface || input.hasArtifactHtml
      ? 'prepare'
      : derivePhase(input.events, { runStatus: 'running' });
  return buildSteps(phase, input.events, input.hasArtifactHtml || input.hasPreviewSurface);
}

export function generationPreviewProgress(steps: StageStep[]): number {
  if (steps.length === 0) return 8;

  const weights: Record<GenerationStepStatus, number> = {
    pending: 0,
    running: 0.45,
    succeeded: 1,
    failed: 0.2,
  };
  const score = steps.reduce((sum, step) => sum + weights[step.status], 0) / steps.length;
  const max = steps.some((step) => step.status === 'failed') ? 72 : 92;
  return Math.max(8, Math.min(max, Math.round(score * 100)));
}

function latestStageAssistant(messages: ChatMessage[]): ChatMessage | null {
  const latestUserIndex = findLastMessageIndex(messages, (message) => message.role === 'user');

  for (let index = messages.length - 1; index > latestUserIndex; index -= 1) {
    const message = messages[index]!;
    if (message.role !== 'assistant') continue;

    const phase = derivePhase(message.events ?? [], message);
    if (message.runStatus === 'running' || message.runStatus === 'queued' || phase !== 'ready') {
      return message;
    }
  }

  return null;
}

function derivePhase(events: AgentEvent[], message: Pick<ChatMessage, 'runStatus'>): GenerationPhase {
  const hasError = message.runStatus === 'failed' || events.some((event) => eventKind(event) === 'error');
  if (hasError) return 'failed';

  const hasWriteTool = events.some((event) => isToolUse(event) && WRITE_LIKE_TOOL_RE.test(eventName(event)));
  const hasAskUser = events.some((event) => isToolUse(event) && isAskUserQuestion(eventName(event)));
  const hasTextDelta = events.some((event) => eventKind(event) === 'text_delta' || eventKind(event) === 'text');
  const hasToolUse = events.some(isToolUse);

  if (hasAskUser && !hasWriteTool) return 'waiting';
  if (hasWriteTool) return 'prepare';
  if (hasTextDelta || hasToolUse) return 'generate';
  if (message.runStatus === 'running' || message.runStatus === 'queued') return 'understand';
  return 'ready';
}

function buildSteps(phase: GenerationPhase, events: AgentEvent[], previewReady: boolean): StageStep[] {
  const writeDetail = latestWriteDetail(events);
  const statusDetail = latestStatusDetail(events);

  const understandStatus: GenerationStepStatus =
    phase === 'failed' ? 'failed' : phase === 'understand' ? 'running' : 'succeeded';
  const generateStatus: GenerationStepStatus =
    phase === 'failed'
      ? 'failed'
      : phase === 'understand'
        ? 'pending'
        : phase === 'generate'
          ? 'running'
          : 'succeeded';
  const prepareStatus: GenerationStepStatus =
    phase === 'failed'
      ? 'failed'
      : phase === 'prepare'
        ? previewReady
          ? 'succeeded'
          : 'running'
        : phase === 'ready'
          ? 'succeeded'
          : 'pending';

  return [
    {
      id: 'understand',
      label: 'Understanding request',
      status: understandStatus,
      ...(phase === 'understand' && statusDetail ? { detail: statusDetail } : {}),
    },
    {
      id: 'generate',
      label: 'Generating design',
      status: generateStatus,
      ...(writeDetail ? { detail: writeDetail } : {}),
    },
    {
      id: 'prepare',
      label: 'Preparing preview',
      status: prepareStatus,
    },
  ];
}

function deriveActivityLabel(
  phase: GenerationPhase,
  events: AgentEvent[],
  todos: TodoItem[],
): string | null {
  if (phase === 'failed') return null;
  if (phase === 'waiting') return 'Awaiting input';

  const activeTodo = todos.find((todo) => todo.status === 'in_progress');
  if (activeTodo) {
    const label = activeTodo.activeForm?.trim() || activeTodo.content.trim();
    if (label) return truncateActivity(label);
  }

  const statusDetail = latestStatusDetail(events);
  if (statusDetail) return statusDetail;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (eventKind(event) === 'thinking' && eventText(event).trim()) {
      return truncateActivity(eventText(event));
    }
    if ((eventKind(event) === 'text' || eventKind(event) === 'text_delta') && eventText(event).trim()) {
      return truncateActivity(eventText(event));
    }
  }

  return null;
}

function latestWriteDetail(events: AgentEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (isToolUse(event) && !isTodoWriteToolName(eventName(event)) && WRITE_LIKE_TOOL_RE.test(eventName(event))) {
      const target = toolTargetName(eventInput(event));
      if (target) return target;
    }
  }
  return null;
}

function latestStatusDetail(events: AgentEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (eventKind(event) === 'status') {
      const detail = eventDetail(event);
      if (detail) return detail;
    }
  }
  return null;
}

function isAskUserQuestion(name: string): boolean {
  return name === 'AskUserQuestion' || name === 'ask_user_question';
}

function isToolUse(event: AgentEvent): boolean {
  const kind = eventKind(event);
  return kind === 'tool_use' || kind === 'tool-use';
}

function eventKind(event: AgentEvent): string {
  const record = event as Record<string, unknown>;
  return typeof record.kind === 'string' ? record.kind : typeof record.type === 'string' ? record.type : '';
}

function eventName(event: AgentEvent): string {
  const record = event as Record<string, unknown>;
  return typeof record.name === 'string' ? record.name : '';
}

function eventText(event: AgentEvent): string {
  const record = event as Record<string, unknown>;
  return typeof record.text === 'string' ? record.text : '';
}

function eventDetail(event: AgentEvent): string | null {
  const record = event as Record<string, unknown>;
  return typeof record.detail === 'string' && record.detail.trim()
    ? truncateActivity(record.detail)
    : null;
}

function eventInput(event: AgentEvent): unknown {
  return (event as Record<string, unknown>).input;
}

function truncateActivity(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 79)}...` : collapsed;
}

function toolTargetName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;

  const record = input as Record<string, unknown>;
  const raw = record.file_path ?? record.filePath ?? record.path ?? record.file;
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const segments = raw.trim().split(/[\\/]/);
  return segments[segments.length - 1] || raw.trim();
}

function findLastMessageIndex(
  messages: ChatMessage[],
  predicate: (message: ChatMessage) => boolean,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index]!)) return index;
  }

  return -1;
}
