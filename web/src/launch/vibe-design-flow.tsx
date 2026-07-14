import { InstantiationContext, InstantiationService, ServiceCollection } from '@tutti-os/infra/di';
import { TooltipProvider } from '@tutti-os/ui-system/components';
import React, { type ReactNode } from 'react';
import type { DashboardProject } from '../DashboardPage';
import type { ChatComposerAgentModelCatalogEntry } from '../components/ChatComposer';
import { createVibeDesignI18nRuntime, defaultVibeDesignLocale, I18nProvider, type VibeDesignLocale } from '../i18n';
import type { ProjectEditorInitialData } from '../project-editor-data';
import { VibeDesignApp } from '../VibeDesignApp';
import { DEFAULT_ROUTE, type VibeDesignRoute } from '../routes';
import { IChatSessionService, type IChatSessionService as IChatSessionServiceContract } from '../services/chat-session/chat-session-service.interface';
import { ChatSessionService, createBrowserQueuedTurnStore } from '../services/chat-session/internal/chat-session-service';
import { IChatTimelineService, type IChatTimelineService as IChatTimelineServiceContract } from '../services/chat-timeline/chat-timeline-service.interface';
import { FetchChatTimelineApi } from '../services/chat-timeline/chat-timeline-api';
import { ChatTimelineService } from '../services/chat-timeline/internal/chat-timeline-service';
import { FetchContextPickerApi } from '../services/context-picker/context-picker-api';
import { IContextPickerService, type IContextPickerService as IContextPickerServiceContract } from '../services/context-picker/context-picker-service.interface';
import { ContextPickerService } from '../services/context-picker/internal/context-picker-service';
import { FetchDesignFileApi } from '../services/design-files/design-file-api';
import { IDesignFileService, type IDesignFileService as IDesignFileServiceContract } from '../services/design-files/design-file-service.interface';
import { DesignFileService } from '../services/design-files/internal/design-file-service';
import { ProjectContextService } from '../services/project-context/project-context-service';
import { IProjectContextService, type IProjectContextService as IProjectContextServiceContract } from '../services/project-context/project-context-service.interface';
import { FetchProjectApi } from '../services/projects/project-api';
import { ProjectService } from '../services/projects/project-service';
import { IProjectService, type IProjectService as IProjectServiceContract } from '../services/projects/project-service.interface';
import { latestTodoWriteInputForPinnedCard } from '../runtime/todos';
import { FetchPreviewCommentApi } from '../services/preview-comments/preview-comment-api';
import { PreviewCommentService } from '../services/preview-comments/internal/preview-comment-service';
import {
  IPreviewCommentService,
  type IPreviewCommentService as IPreviewCommentServiceContract,
} from '../services/preview-comments/preview-comment-service.interface';
import { FetchRunApi } from '../services/run/run-api';
import { RunService } from '../services/run/internal/run-service';
import { IRunService, type IRunService as IRunServiceContract } from '../services/run/run-service.interface';
import { AgentCatalogService } from '../services/agent-catalog/internal/agent-catalog-service';
import {
  IAgentCatalogService,
  type IAgentCatalogService as IAgentCatalogServiceContract,
} from '../services/agent-catalog/agent-catalog-service.interface';

export interface VibeDesignFlowOptions {
  locale?: VibeDesignLocale;
  route?: VibeDesignRoute;
  runService?: IRunServiceContract;
  contextPickerService?: IContextPickerServiceContract;
  designFileService?: IDesignFileServiceContract;
  chatTimelineService?: IChatTimelineServiceContract;
  chatSessionService?: IChatSessionServiceContract;
  projectContextService?: IProjectContextServiceContract;
  projectService?: IProjectServiceContract;
  previewCommentService?: IPreviewCommentServiceContract;
  openProject?: (projectId: string) => void;
  recentProjects?: DashboardProject[];
  agentModelCatalog?: ChatComposerAgentModelCatalogEntry[];
  agentCatalogService?: IAgentCatalogServiceContract;
  projectEditor?: ProjectEditorInitialData;
}

export class VibeDesignFlow {
  private _initStarted = false;
  private _instantiationService?: InstantiationService;

  constructor(private readonly options: VibeDesignFlowOptions = {}) {}

  init(): void {
    if (this._initStarted) {
      return;
    }

    this._initStarted = true;
    const serviceCollection = new ServiceCollection();
    const route = this.options.route ?? DEFAULT_ROUTE;
    const i18n = createVibeDesignI18nRuntime(this.options.locale ?? defaultVibeDesignLocale);
    const projectId = route.kind === 'project' ? route.projectId : null;
    const runService = this.options.runService ?? new RunService(new FetchRunApi());
    const contextPickerService =
      this.options.contextPickerService ?? new ContextPickerService(new FetchContextPickerApi(projectId));
    const designFileService =
      this.options.designFileService ?? new DesignFileService(new FetchDesignFileApi(projectId));
    const chatTimelineService =
      this.options.chatTimelineService ??
      new ChatTimelineService(
        this.options.projectEditor
          ? {
              initialSnapshot: {
                conversations: this.options.projectEditor.conversations,
                activeConversationId: this.options.projectEditor.activeConversationId,
                activeConversationTitle:
                  this.options.projectEditor.conversations.find(
                    (conversation) => conversation.id === this.options.projectEditor?.activeConversationId,
                  )?.title ?? i18n.t('chat.activeConversation.defaultTitle'),
                messages: this.options.projectEditor.messages,
                activeRunId:
                  this.options.projectEditor.messages.find(
                    (message) => message.role === 'assistant' && message.runStatus === 'running' && message.runId,
                  )?.runId ?? null,
                phase: this.options.projectEditor.messages.some(
                  (message) => message.role === 'assistant' && message.runStatus === 'running',
                )
                  ? 'streaming'
                  : 'idle',
                pinnedTodoInput: latestTodoWriteInputForPinnedCard(this.options.projectEditor.messages),
              },
              api: new FetchChatTimelineApi(projectId),
            }
          : undefined,
      );
    const projectContextService =
      this.options.projectContextService ?? new ProjectContextService(projectId ?? 'default');
    const projectService = this.options.projectService ?? new ProjectService(new FetchProjectApi());
    const agentCatalogService =
      this.options.agentCatalogService ?? new AgentCatalogService(this.options.agentModelCatalog);
    const previewCommentService =
      this.options.previewCommentService ??
      new PreviewCommentService(new FetchPreviewCommentApi(), projectId ?? 'default');
    const chatSessionService =
      this.options.chatSessionService ??
      new ChatSessionService({
        project: projectContextService,
        timeline: chatTimelineService,
        run: runService,
        context: contextPickerService,
        files: designFileService,
        agentCatalog: agentCatalogService,
        queuedTurnStore: createBrowserQueuedTurnStore(),
      });

    serviceCollection.set(IRunService, runService);
    serviceCollection.set(IContextPickerService, contextPickerService);
    serviceCollection.set(IDesignFileService, designFileService);
    serviceCollection.set(IChatTimelineService, chatTimelineService);
    serviceCollection.set(IProjectContextService, projectContextService);
    serviceCollection.set(IProjectService, projectService);
    serviceCollection.set(IAgentCatalogService, agentCatalogService);
    serviceCollection.set(IPreviewCommentService, previewCommentService);
    serviceCollection.set(IChatSessionService, chatSessionService);
    this._instantiationService = new InstantiationService(serviceCollection);
  }

  render(): ReactNode {
    this.init();

    if (!this._instantiationService) {
      throw new Error('VibeDesignFlow container is not initialized.');
    }

    return (
      <TooltipProvider delayDuration={120}>
        <I18nProvider initialLocale={this.options.locale}>
          <InstantiationContext instantiationService={this._instantiationService}>
            <VibeDesignApp
              route={this.options.route ?? DEFAULT_ROUTE}
              openProject={this.options.openProject}
              recentProjects={this.options.recentProjects}
              projectEditor={this.options.projectEditor}
            />
          </InstantiationContext>
        </I18nProvider>
      </TooltipProvider>
    );
  }
}

export function createVibeDesignFlow(options?: VibeDesignFlowOptions): VibeDesignFlow {
  return new VibeDesignFlow(options);
}
