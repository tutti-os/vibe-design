import type { WorkspaceFile, WorkspaceTabsState } from './features/canvas-workspace';
import type { AgentAvailability } from './services/agent-catalog/agent-catalog-types';
import type { ChatConversationSummary, ChatTimelineMessage } from './services/chat-timeline/chat-timeline-types';

export type ProjectEditorAgentAvailability = AgentAvailability;

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
