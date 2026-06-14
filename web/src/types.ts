import type { CanvasCommentAttachment } from './features/canvas-workspace/canvas-comment/canvas-comment-types';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type RunPhase =
  | 'idle'
  | 'queued'
  | 'initializing'
  | 'requesting'
  | 'thinking'
  | 'working'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'canceled';

interface AgentEventTransport {
  eventId?: number | string | null;
}

export type StreamAgentEvent =
  | (AgentEventTransport & {
      type: 'status';
      label: string;
      model?: string;
      sessionId?: string;
      detail?: string;
      ttftMs?: number;
    })
  | (AgentEventTransport & { type: 'text_delta'; delta?: string; text?: string })
  | (AgentEventTransport & { type: 'thinking_delta'; delta?: string; text?: string })
  | (AgentEventTransport & { type: 'thinking_start' })
  | (AgentEventTransport & {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    })
  | (AgentEventTransport & {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError: boolean;
    })
  | (AgentEventTransport & {
      type: 'generated_file';
      name: string;
      artifactType?: string;
      title?: string;
    })
  | (AgentEventTransport & {
      type: 'usage';
      usage?: object;
      costUsd?: number;
      durationMs?: number;
      stopReason?: string;
    })
  | (AgentEventTransport & { type: 'turn_end'; stopReason: string })
  | (AgentEventTransport & {
      type: 'error';
      code?: string;
      detail?: string;
      message?: string;
      error?: unknown;
    })
  | (AgentEventTransport & {
      type: 'end';
      code: number | null;
      signal: string | null;
      status: RunStatus;
    })
  | (AgentEventTransport & { type: 'raw'; line: string });

export type LegacyAgentEvent =
  | { kind: 'status'; type?: never; label: string; detail?: string }
  | { kind: 'text'; type?: never; text: string }
  | { kind: 'thinking'; type?: never; text: string }
  | { kind: 'tool_use'; type?: never; id: string; name: string; input: unknown }
  | { kind: 'error'; type?: never; message?: string; detail?: string };

export type AgentEvent = StreamAgentEvent | LegacyAgentEvent;

export interface ChatAttachment {
  path: string;
  name: string;
  kind: 'file' | 'image';
  size?: number;
  mimeType?: string;
}

export type ProjectFileKind =
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'text'
  | 'code'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'binary';

export interface ProjectFile {
  id?: string;
  name: string;
  path?: string;
  type?: 'file' | 'directory';
  size: number;
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
  updatedAt?: number;
}

export interface SkillSummary {
  id: string;
  name: string;
  description?: string;
  triggers?: string[];
}

export interface RunContextSelection {
  skillIds?: string[];
  designFileIds?: string[];
  designFilePaths?: string[];
}

export interface ChatMessageContext {
  selectedSkills?: SkillSummary[];
  selectedDesignFiles?: ProjectFile[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turnStatus?: 'queued';
  runStatus?: RunStatus;
  startedAt?: number;
  createdAt?: number;
  endedAt?: number;
  events?: AgentEvent[];
  attachments?: ChatAttachment[];
  commentAttachments?: CanvasCommentAttachment[];
  producedFiles?: ProjectFile[];
  projectKind?: string;
  runId?: string;
  context?: ChatMessageContext;
}

export type {
  CanvasCommentAttachment,
  CanvasBoardBatchCommentAttachment,
  CanvasCommentTargetSelectionKind,
  CanvasElementCommentTarget,
  CanvasElementCommentTargetSnapshot,
  CanvasCommentMember,
  CanvasCommentPoint,
  CanvasCommentPosition,
  CanvasCommentSelectionKind,
  CanvasCommentStatus,
  CanvasCommentStyleSnapshot,
  CanvasCommentTarget,
  CanvasCommentTargetSnapshot,
  CanvasCommentTool,
  CanvasPodCommentTarget,
  CanvasPodCommentTargetSnapshot,
  CanvasPreviewComment,
  CanvasSavedCommentAttachment,
  CanvasVisualMarkCommentAttachment,
  CanvasVisualMarkKind,
} from './features/canvas-workspace/canvas-comment/canvas-comment-types';

export type LiveArtifactStatus = 'active' | 'archived';
export type LiveArtifactRefreshStatus = 'idle' | 'running' | 'failed';
export type LiveArtifactTabId = `live:${string}`;

export interface LiveArtifactPreview {
  type: 'html' | 'image' | 'video' | 'audio' | 'data';
  entry?: string;
  url?: string;
  thumbnailUrl?: string;
}

export interface LiveArtifactWorkspaceEntry {
  kind: 'live-artifact';
  tabId: LiveArtifactTabId;
  artifactId: string;
  projectId: string;
  title: string;
  slug: string;
  status: LiveArtifactStatus;
  refreshStatus: LiveArtifactRefreshStatus;
  pinned: boolean;
  preview: LiveArtifactPreview;
  hasDocument: boolean;
  updatedAt: string;
  lastRefreshedAt?: string;
}

export function liveArtifactTabId(artifactId: string): LiveArtifactTabId {
  return `live:${artifactId}`;
}

export function isLiveArtifactTabId(tabId: string): tabId is LiveArtifactTabId {
  return tabId.startsWith('live:') && tabId.length > 'live:'.length;
}
