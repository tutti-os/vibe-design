import type { WorkspaceFile, WorkspaceTabsState } from './features/canvas-workspace';
import type { ChatConversationSummary, ChatTimelineMessage } from './services/chat-timeline/chat-timeline-types';

export interface ProjectEditorAgentAvailability {
  id: string;
  label: string;
  available: boolean;
  authState?: 'ok' | 'missing' | 'expired' | 'unknown';
  supported?: boolean;
  unavailableReason?: string;
  version?: string;
}

export interface ProjectEditorInitialProject {
  id: string;
  title?: string | null;
  prompt?: string | null;
  designSystemId?: string | null;
  tabsState: WorkspaceTabsState;
}

export interface ProjectEditorInitialData {
  project: ProjectEditorInitialProject;
  files: WorkspaceFile[];
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  messages: ChatTimelineMessage[];
  agentAvailability?: ProjectEditorAgentAvailability[];
}
