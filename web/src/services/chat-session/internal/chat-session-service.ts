import { expandSearchCommand } from '../../../runtime/search-command';
import type { AgentEvent, CanvasCommentAttachment, ChatAttachment, ChatMessageContext, RunContextSelection, RunStatus } from '../../../types';
import { artifactFileName, isCompleteHtmlDocument } from '../../../artifacts/artifact-file';
import { createArtifactParser } from '../../../artifacts/artifact-parser';
import { imageAttachmentsForPreviewComments } from '../../../features/canvas-workspace/canvas-comment/comment-screenshot-attachments';
import type { IChatTimelineService } from '../../chat-timeline/chat-timeline-service.interface';
import type { IAgentCatalogService } from '../../agent-catalog/agent-catalog-service.interface';
import { resolveLegacyProviderAgentTargetId } from '../../agent-catalog/agent-catalog-types';
import type { ContextPickerSnapshot } from '../../context-picker/context-picker-types';
import type { IContextPickerService } from '../../context-picker/context-picker-service.interface';
import type { IDesignFileService } from '../../design-files/design-file-service.interface';
import type { IProjectContextService } from '../../project-context/project-context-service.interface';
import type { IRunService } from '../../run/run-service.interface';
import type { RunStreamHandlers } from '../../run/run-types';
import { reportUserActive } from '../../tutti-activity';
import type { IChatSessionService } from '../chat-session-service.interface';
import type { ChatSessionSnapshot, QueuedTurnPreview, SendTurnInput } from '../chat-session-types';

export interface ChatSessionServiceDependencies {
  project: IProjectContextService;
  timeline: IChatTimelineService;
  run: IRunService;
  context: IContextPickerService;
  files: IDesignFileService;
  agentCatalog?: IAgentCatalogService;
  queuedTurnStore?: QueuedTurnStore | null;
}

export interface QueuedTurnStore {
  load(projectId: string): StoredQueuedTurn[];
  save(projectId: string, turns: readonly StoredQueuedTurn[]): void;
}

export interface StoredQueuedTurn {
  queueId: string;
  content: string;
  prompt: string;
  agentTargetId?: string;
  legacyProviderId?: string;
  model?: string;
  attachments: ChatAttachment[];
  commentAttachments: CanvasCommentAttachment[];
  conversationId: string | null;
  appendConversationId: string | null;
  context?: RunContextSelection;
  messageContext?: ChatMessageContext;
}

export class ChatSessionService implements IChatSessionService {
  readonly _serviceBrand = undefined;

  private readonly projectId: string;
  private readonly queuedTurns: QueuedPreparedTurn[];
  private readonly listeners = new Set<() => void>();
  private nextQueuedTurnId = 1;
  private startingRun = false;
  private sendingQueuedTurnNext = false;

  constructor(private readonly dependencies: ChatSessionServiceDependencies) {
    this.projectId = dependencies.project.getProjectId();
    this.queuedTurns = this.loadQueuedTurns();
    this.nextQueuedTurnId = nextQueuedTurnId(this.queuedTurns);
    this.resumeActiveRun();
    if (this.queuedTurns.length > 0) {
      queueMicrotask(() => void this.migrateAndDrainQueue().catch(() => undefined));
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ChatSessionSnapshot {
    return {
      startingRun: this.startingRun,
      queuedTurns: this.queuedTurns.map((turn) => queuedTurnPreview(turn)),
    };
  }

  async sendTurn(input: SendTurnInput): Promise<void> {
    const turn = await this.prepareTurn(input);

    if (this.shouldQueueTurn()) {
      this.queuedTurns.push({
        ...turn,
        appendConversationId: turn.conversationId,
        queueId: this.createQueuedTurnId(),
      });
      this.persistQueuedTurns();
      this.notify();
      return;
    }

    await this.startTurn(turn);
  }

  private async prepareTurn(input: SendTurnInput): Promise<PreparedTurn> {
    const commentAttachments = input.commentAttachments ?? [];
    const attachments = [
      ...(input.attachments ?? []),
      ...(await this.dependencies.files.uploadFiles(input.files)),
      ...imageAttachmentsForPreviewComments(commentAttachments),
    ];
    const context = this.dependencies.context.buildRunContext();
    const messageContext = buildMessageContext(this.dependencies.context.getSnapshot());
    const content = messageContentForTurn(input.displayDraft ?? input.draft, attachments, commentAttachments, context, {
      includeAttachmentFallback: false,
    });
    const promptContent = messageContentForTurn(input.draft, attachments, commentAttachments, context, {
      includeAttachmentFallback: true,
    });
    const prompt = expandSearchCommand(promptContent)?.prompt ?? promptContent;
    const timelineSnapshot = this.dependencies.timeline.getSnapshot();
    const conversationId = timelineSnapshot.activeConversationId;
    const lockedAgentTargetId = readActiveConversationAgentTargetId(timelineSnapshot);
    const rememberedModel = readActiveConversationModel(timelineSnapshot);
    return {
      content,
      prompt,
      agentTargetId: lockedAgentTargetId ?? input.agentTargetId,
      ...(input.model || rememberedModel ? { model: input.model ?? rememberedModel } : {}),
      attachments,
      commentAttachments,
      conversationId,
      context,
      messageContext,
    };
  }

  private shouldQueueTurn(): boolean {
    return this.startingRun || this.dependencies.timeline.getSnapshot().activeRunId !== null;
  }

  private resumeActiveRun(): void {
    const snapshot = this.dependencies.timeline.getSnapshot();
    const runId = snapshot.activeRunId;
    if (!runId) {
      return;
    }

    this.dependencies.run.streamRun(runId, this.createStreamHandlers(runId), lastEventIdForRun(snapshot.messages, runId));
  }

  private async startTurn(turn: PreparedTurn): Promise<void> {
    this.startingRun = true;
    this.notify();
    try {
      if (turn.conversationId) {
        await this.dependencies.timeline.ensureConversationPersisted(turn.conversationId);
      }

      const userMessage = this.dependencies.timeline.appendUserMessage({
        content: turn.content,
        attachments: turn.attachments,
        ...(turn.commentAttachments.length > 0 ? { commentAttachments: turn.commentAttachments } : {}),
        ...(turn.messageContext ? { context: turn.messageContext } : {}),
        ...(turn.appendConversationId ? { conversationId: turn.appendConversationId } : {}),
      });

      let runId: string;
      let agentTargetId: string | null | undefined;
      let provider: string | null | undefined;
      try {
        ({ runId, agentTargetId, provider } = await this.dependencies.run.createRun({
          projectId: this.dependencies.project.getProjectId(),
          ...(turn.conversationId ? { conversationId: turn.conversationId } : {}),
          ...(turn.agentTargetId ? { agentTargetId: turn.agentTargetId } : {}),
          ...(turn.model ? { model: turn.model } : {}),
          prompt: turn.prompt,
          ...(turn.attachments.length > 0 ? { attachments: turn.attachments } : {}),
          ...(turn.commentAttachments.length > 0 ? { commentAttachments: turn.commentAttachments } : {}),
          ...(turn.context ? { context: turn.context } : {}),
          ...(turn.messageContext ? { messageContext: turn.messageContext } : {}),
        }));
      } catch (error) {
        this.dependencies.timeline.removeMessage(userMessage.id);
        throw error;
      }
      const targetToRemember = agentTargetId ?? turn.agentTargetId;
      const providerToRemember = provider
        ?? readConversationRuntimeProvider(
          this.dependencies.timeline.getSnapshot(),
          turn.conversationId,
        )
        ?? this.dependencies.agentCatalog?.getSnapshot().catalog.find(
          (entry) => entry.agentTargetId === targetToRemember,
        )?.providerId;
      if (turn.conversationId && targetToRemember && providerToRemember) {
        this.dependencies.timeline.setConversationAgent({
          conversationId: turn.conversationId,
          agentTargetId: targetToRemember,
          provider: providerToRemember,
          ...(turn.model ? { model: turn.model } : {}),
        });
      }

      this.dependencies.timeline.startAssistantRun({ runId, conversationId: turn.conversationId });
      reportUserActive();
      this.dependencies.run.streamRun(runId, this.createStreamHandlers(runId));
    } finally {
      this.startingRun = false;
      this.notify();
    }
  }

  async stopActiveRun(): Promise<void> {
    const runId = this.dependencies.timeline.getSnapshot().activeRunId;
    if (!runId) return;

    await this.dependencies.run.stopRun(runId);
  }

  deleteQueuedTurn(queueId: string): void {
    const queueIndex = this.queuedTurns.findIndex((turn) => turn.queueId === queueId);
    if (queueIndex === -1) return;

    this.queuedTurns.splice(queueIndex, 1);
    this.persistQueuedTurns();
    this.notify();
  }

  async sendQueuedTurnNext(queueId: string): Promise<void> {
    if (this.sendingQueuedTurnNext) return;
    this.sendingQueuedTurnNext = true;
    let turnToRestore: QueuedPreparedTurn | undefined;
    try {
      let queueIndex = this.queuedTurns.findIndex((turn) => turn.queueId === queueId);
      if (queueIndex === -1) return;
      const queuedTurn = this.queuedTurns[queueIndex];
      if (queuedTurn?.legacyProviderId && !queuedTurn.agentTargetId) {
        const catalog = await this.dependencies.agentCatalog?.ensureLoaded() ?? [];
        queueIndex = this.queuedTurns.findIndex((turn) => turn.queueId === queueId);
        const currentTurn = this.queuedTurns[queueIndex];
        if (queueIndex === -1 || !currentTurn || currentTurn !== queuedTurn) return;
        if (!currentTurn.agentTargetId) {
          const agentTargetId = resolveLegacyProviderAgentTargetId(catalog, currentTurn.legacyProviderId ?? '');
          if (!agentTargetId) return;
          currentTurn.agentTargetId = agentTargetId;
          delete currentTurn.legacyProviderId;
        }
      }

      queueIndex = this.queuedTurns.findIndex((turn) => turn.queueId === queueId);
      const [turn] = queueIndex >= 0 ? this.queuedTurns.splice(queueIndex, 1) : [];
      if (!turn) return;
      turnToRestore = turn;
      this.persistQueuedTurns();
      this.notify();

      const activeRunId = this.dependencies.timeline.getSnapshot().activeRunId;
      if (activeRunId) {
        await this.dependencies.run.stopRun(activeRunId);
      }
      await this.startTurn(turn);
    } catch {
      if (turnToRestore && !this.queuedTurns.some((turn) => turn.queueId === queueId)) {
        // The selected turn was already removed for sending. Restore only that
        // exact turn; never substitute a different queue entry after awaits.
        this.queuedTurns.unshift(turnToRestore);
        this.persistQueuedTurns();
        this.notify();
      }
    } finally {
      this.sendingQueuedTurnNext = false;
      this.drainQueue();
    }
  }

  async answerToolQuestion(toolUseId: string, content: string): Promise<void> {
    const runId = this.dependencies.timeline.getSnapshot().activeRunId;
    if (!runId) {
      throw new Error('Cannot answer a tool question because there is no active run.');
    }

    await this.dependencies.run.submitToolResult(runId, toolUseId, content);
  }

  private createStreamHandlers(runId: string): RunStreamHandlers {
    const artifactParser = createArtifactParser();
    let activeArtifact: ParsedArtifact | null = null;
    let terminalEndEvent: Extract<AgentEvent, { type: 'end' }> | null = null;
    let sawErrorEvent = false;

    const applyTextDelta = (event: Extract<Parameters<RunStreamHandlers['onEvent']>[0], { type: 'text_delta' }>) => {
      const delta = readTextDelta(event);
      if (!delta) return;

      for (const parsed of artifactParser.feed(delta)) {
        if (parsed.type === 'text') {
          this.dependencies.timeline.applyAgentEvent(runId, { ...event, delta: parsed.delta });
          continue;
        }
        if (parsed.type === 'artifact:start') {
          activeArtifact = {
            identifier: parsed.identifier,
            artifactType: parsed.artifactType,
            title: parsed.title,
            html: '',
          };
          continue;
        }
        if (parsed.type === 'artifact:chunk') {
          activeArtifact = activeArtifact
            ? { ...activeArtifact, html: `${activeArtifact.html}${parsed.delta}` }
            : { identifier: parsed.identifier, artifactType: '', title: '', html: parsed.delta };
          continue;
        }
        activeArtifact = activeArtifact
          ? { ...activeArtifact, html: parsed.fullContent }
          : { identifier: parsed.identifier, artifactType: '', title: '', html: parsed.fullContent };
      }
    };

    const finalizeArtifact = async (): Promise<void> => {
      for (const parsed of artifactParser.flush()) {
        if (parsed.type === 'text') {
          this.dependencies.timeline.applyAgentEvent(runId, { type: 'text_delta', delta: parsed.delta });
        } else if (parsed.type === 'artifact:chunk') {
          activeArtifact = activeArtifact
            ? { ...activeArtifact, html: `${activeArtifact.html}${parsed.delta}` }
            : { identifier: parsed.identifier, artifactType: '', title: '', html: parsed.delta };
        } else if (parsed.type === 'artifact:end') {
          activeArtifact = activeArtifact
            ? { ...activeArtifact, html: parsed.fullContent }
            : { identifier: parsed.identifier, artifactType: '', title: '', html: parsed.fullContent };
        }
      }

      if (!activeArtifact || !isCompleteHtmlDocument(activeArtifact.html)) return;
      const name = artifactFileName(activeArtifact);
      await this.dependencies.files.saveFileContent(name, activeArtifact.html);
      this.dependencies.timeline.applyAgentEvent(runId, {
        type: 'generated_file',
        name,
        artifactType: activeArtifact.artifactType || undefined,
        title: activeArtifact.title || undefined,
      });
    };

    return {
      onEvent: (event) => {
        if (event.type === 'text_delta') {
          applyTextDelta(event);
          return;
        }
        if (event.type === 'end') {
          terminalEndEvent = event;
          return;
        }
        if (event.type === 'error') {
          sawErrorEvent = true;
        }
        this.dependencies.timeline.applyAgentEvent(runId, event);
      },
      onEnd: (status) => {
        void finalizeArtifact()
          .catch(() => undefined)
          .finally(() => {
            if (terminalEndEvent) {
              this.dependencies.timeline.applyAgentEvent(runId, terminalEndEvent);
              this.finishStreamRun(runId, status, true);
              return;
            }
            this.finishStreamRun(runId, status, false);
          });
      },
      onError: (error) => {
        if (!sawErrorEvent) {
          this.dependencies.timeline.applyAgentEvent(runId, {
            type: 'error',
            code: 'RUN_STREAM_ERROR',
            message: readErrorMessage(error),
          });
          sawErrorEvent = true;
        }
        this.finishStreamRun(runId, 'failed', false);
      },
    };
  }

  private finishStreamRun(runId: string, status: RunStatus, alreadyHandledTerminalEnd: boolean): void {
    if (!alreadyHandledTerminalEnd) {
      this.dependencies.timeline.finishRun(runId, { status });
    }

    this.drainQueue();
  }

  private drainQueue(): void {
    if (this.sendingQueuedTurnNext || this.queuedTurns.length === 0 || this.shouldQueueTurn()) {
      return;
    }

    if (this.queuedTurns[0]?.legacyProviderId && !this.queuedTurns[0]?.agentTargetId) {
      void this.migrateAndDrainQueue().catch(() => undefined);
      return;
    }

    const nextTurn = this.queuedTurns.shift();
    if (!nextTurn) {
      return;
    }

    this.persistQueuedTurns();
    this.notify();
    void this.startTurn(nextTurn).catch(() => {
      this.queuedTurns.unshift(nextTurn);
      this.persistQueuedTurns();
      this.notify();
    });
  }

  private async migrateAndDrainQueue(): Promise<void> {
    const legacyTurns = this.queuedTurns.filter((turn) => turn.legacyProviderId && !turn.agentTargetId);
    if (legacyTurns.length > 0) {
      const catalog = await this.dependencies.agentCatalog?.ensureLoaded() ?? [];
      for (const turn of legacyTurns) {
        const agentTargetId = resolveLegacyProviderAgentTargetId(catalog, turn.legacyProviderId ?? '');
        if (agentTargetId) {
          turn.agentTargetId = agentTargetId;
          delete turn.legacyProviderId;
        }
      }
      this.persistQueuedTurns();
      this.notify();
    }
    if (this.queuedTurns[0]?.legacyProviderId && !this.queuedTurns[0]?.agentTargetId) return;
    this.drainQueue();
  }

  private loadQueuedTurns(): QueuedPreparedTurn[] {
    try {
      return (this.dependencies.queuedTurnStore?.load(this.projectId) ?? [])
        .map(normalizeStoredQueuedTurn)
        .filter((turn): turn is QueuedPreparedTurn => turn !== null);
    } catch {
      return [];
    }
  }

  private persistQueuedTurns(): void {
    try {
      this.dependencies.queuedTurnStore?.save(this.projectId, this.queuedTurns.map(storedQueuedTurn));
    } catch {
      // Queue persistence is a best-effort handoff across project navigation.
    }
  }

  private createQueuedTurnId(): string {
    const id = `queued-turn-${this.nextQueuedTurnId}`;
    this.nextQueuedTurnId += 1;
    return id;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

interface PreparedTurn {
  content: string;
  prompt: string;
  agentTargetId?: string;
  model?: string;
  attachments: ChatAttachment[];
  commentAttachments: CanvasCommentAttachment[];
  conversationId: string | null;
  appendConversationId?: string | null;
  context?: RunContextSelection;
  messageContext?: ChatMessageContext;
}

type QueuedPreparedTurn = StoredQueuedTurn;

interface ParsedArtifact {
  identifier: string;
  artifactType: string;
  title: string;
  html: string;
}

function messageContentForTurn(
  draft: string,
  attachments: ChatAttachment[],
  commentAttachments: CanvasCommentAttachment[],
  context?: RunContextSelection,
  options: { includeAttachmentFallback?: boolean } = {},
): string {
  if (draft.trim().length > 0) {
    return draft;
  }

  if (commentAttachments.length > 0) {
    return previewCommentMessageContent(commentAttachments);
  }

  if (attachments.length > 0) {
    return options.includeAttachmentFallback ? attachmentFallbackPrompt(attachments) : draft;
  }

  if (context && hasSelectedRunContext(context)) {
    return hasOnlySelectedSkills(context) ? 'Use the selected skill.' : 'Use the selected context.';
  }

  return draft;
}

function attachmentFallbackPrompt(attachments: readonly ChatAttachment[]): string {
  return attachments.length === 1
    ? 'Review the attached file.'
    : 'Review the attached files.';
}

function isAttachmentFallbackPrompt(content: string): boolean {
  const normalizedContent = content.trim();
  return normalizedContent === 'Review the attached file.' || normalizedContent === 'Review the attached files.';
}

function hasSelectedRunContext(context: RunContextSelection): boolean {
  return Boolean(
    (context.skillIds?.length ?? 0) > 0 ||
      (context.designFileIds?.length ?? 0) > 0 ||
      (context.designFilePaths?.length ?? 0) > 0,
  );
}

function hasOnlySelectedSkills(context: RunContextSelection): boolean {
  return (
    (context.skillIds?.length ?? 0) > 0 &&
    (context.designFileIds?.length ?? 0) === 0 &&
    (context.designFilePaths?.length ?? 0) === 0
  );
}

function previewCommentMessageContent(commentAttachments: CanvasCommentAttachment[]): string {
  return commentAttachments
    .map((attachment) => commentAttachmentText(attachment))
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

function commentAttachmentText(attachment: CanvasCommentAttachment): string {
  return attachment.comment.trim() || attachment.label.trim() || attachment.targetId.trim();
}

function queuedTurnPreview(turn: QueuedPreparedTurn): QueuedTurnPreview {
  const prompt = queuedTurnPromptForPreview(turn);
  return {
    id: turn.queueId,
    content: turn.content,
    conversationId: turn.conversationId,
    attachments: structuredClone(turn.attachments),
    commentAttachments: structuredClone(turn.commentAttachments),
    ...(prompt ? { prompt } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.messageContext ? { messageContext: structuredClone(turn.messageContext) } : {}),
  };
}

function queuedTurnPromptForPreview(turn: QueuedPreparedTurn): string | undefined {
  if (turn.content.trim().length === 0 && turn.attachments.length > 0 && isAttachmentFallbackPrompt(turn.prompt)) {
    return undefined;
  }
  return turn.prompt;
}

export function createBrowserQueuedTurnStore(
  storage: { localStorage?: Storage | null; sessionStorage?: Storage | null } = readBrowserStorage(),
): QueuedTurnStore | null {
  return createStorageQueuedTurnStore(storage.localStorage ?? storage.sessionStorage ?? null);
}

export function createSessionStorageQueuedTurnStore(storage: Storage | null = readSessionStorage()): QueuedTurnStore | null {
  return createStorageQueuedTurnStore(storage);
}

function createStorageQueuedTurnStore(storage: Storage | null): QueuedTurnStore | null {
  if (!storage) {
    return null;
  }

  return {
    load(projectId) {
      try {
        const serialized = storage.getItem(queuedTurnStorageKey(projectId));
        if (!serialized) return [];
        const parsed: unknown = JSON.parse(serialized);
        return Array.isArray(parsed)
          ? parsed.map(normalizeStoredQueuedTurn).filter((turn): turn is QueuedPreparedTurn => turn !== null)
          : [];
      } catch {
        return [];
      }
    },
    save(projectId, turns) {
      try {
        const key = queuedTurnStorageKey(projectId);
        if (turns.length === 0) {
          storage.removeItem(key);
          return;
        }
        storage.setItem(key, JSON.stringify(turns.map(storedQueuedTurn)));
      } catch {
        // Storage may be unavailable or full; losing the handoff is safer than blocking send.
      }
    },
  };
}

function storedQueuedTurn(turn: StoredQueuedTurn): StoredQueuedTurn {
  return {
    queueId: turn.queueId,
    content: turn.content,
    prompt: turn.prompt,
    ...(turn.agentTargetId ? { agentTargetId: turn.agentTargetId } : {}),
    ...(turn.legacyProviderId ? { legacyProviderId: turn.legacyProviderId } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    attachments: structuredClone(turn.attachments),
    commentAttachments: structuredClone(turn.commentAttachments),
    conversationId: turn.conversationId,
    appendConversationId: turn.appendConversationId,
    ...(turn.context ? { context: structuredClone(turn.context) } : {}),
    ...(turn.messageContext ? { messageContext: structuredClone(turn.messageContext) } : {}),
  };
}

function normalizeStoredQueuedTurn(value: unknown): QueuedPreparedTurn | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<StoredQueuedTurn> & { agentId?: unknown };
  if (
    typeof candidate.queueId !== 'string' ||
    typeof candidate.content !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    !Array.isArray(candidate.attachments) ||
    !Array.isArray(candidate.commentAttachments)
  ) {
    return null;
  }

  const conversationId =
    typeof candidate.conversationId === 'string' || candidate.conversationId === null
      ? candidate.conversationId
      : null;
  const appendConversationId =
    typeof candidate.appendConversationId === 'string' || candidate.appendConversationId === null
      ? candidate.appendConversationId
      : conversationId;

  return {
    queueId: candidate.queueId,
    content: candidate.content,
    prompt: candidate.prompt,
    ...(typeof candidate.agentTargetId === 'string' && candidate.agentTargetId
      ? { agentTargetId: candidate.agentTargetId }
      : {}),
    ...(typeof candidate.legacyProviderId === 'string' && candidate.legacyProviderId
      ? { legacyProviderId: candidate.legacyProviderId }
      : typeof candidate.agentId === 'string' && candidate.agentId
        ? { legacyProviderId: candidate.agentId }
        : {}),
    ...(typeof candidate.model === 'string' && candidate.model ? { model: candidate.model } : {}),
    attachments: structuredClone(candidate.attachments) as ChatAttachment[],
    commentAttachments: structuredClone(candidate.commentAttachments) as CanvasCommentAttachment[],
    conversationId,
    appendConversationId,
    ...(candidate.context ? { context: structuredClone(candidate.context) as RunContextSelection } : {}),
    ...(candidate.messageContext ? { messageContext: structuredClone(candidate.messageContext) as ChatMessageContext } : {}),
  };
}

function nextQueuedTurnId(turns: readonly QueuedPreparedTurn[]): number {
  const highestId = turns.reduce((highest, turn) => {
    const match = /^queued-turn-(\d+)$/.exec(turn.queueId);
    const id = match ? Number(match[1]) : 0;
    return Number.isFinite(id) ? Math.max(highest, id) : highest;
  }, 0);
  return highestId + 1;
}

function readSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readBrowserStorage(): { localStorage: Storage | null; sessionStorage: Storage | null } {
  if (typeof window === 'undefined') {
    return { localStorage: null, sessionStorage: null };
  }

  let localStorage: Storage | null = null;
  let sessionStorage: Storage | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    localStorage = null;
  }
  try {
    sessionStorage = window.sessionStorage;
  } catch {
    sessionStorage = null;
  }
  return { localStorage, sessionStorage };
}

function queuedTurnStorageKey(projectId: string): string {
  return `vibe-design:queued-turns:${projectId}`;
}

function readTextDelta(event: Extract<Parameters<RunStreamHandlers['onEvent']>[0], { type: 'text_delta' }>): string {
  return typeof event.delta === 'string' ? event.delta : typeof event.text === 'string' ? event.text : '';
}

function readErrorMessage(error: Error): string {
  return error.message.trim().length > 0 ? error.message.trim() : 'Run stream failed.';
}

function readActiveConversationAgentTargetId(snapshot: ReturnType<IChatTimelineService['getSnapshot']>): string | undefined {
  const activeConversation = snapshot.conversations.find((conversation) => conversation.id === snapshot.activeConversationId);
  const agentTargetId = activeConversation?.agentTargetId;
  return typeof agentTargetId === 'string' && agentTargetId.trim().length > 0 ? agentTargetId.trim() : undefined;
}

function readActiveConversationModel(snapshot: ReturnType<IChatTimelineService['getSnapshot']>): string | undefined {
  const activeConversation = snapshot.conversations.find((conversation) => conversation.id === snapshot.activeConversationId);
  const model = activeConversation?.model;
  return typeof model === 'string' && model.trim().length > 0 ? model : undefined;
}

function readConversationRuntimeProvider(
  snapshot: ReturnType<IChatTimelineService['getSnapshot']>,
  conversationId: string | null,
): string | undefined {
  const activeConversation = snapshot.conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const provider = activeConversation?.provider;
  return typeof provider === 'string' && provider.trim().length > 0 ? provider.trim() : undefined;
}

function lastEventIdForRun(messages: ReturnType<IChatTimelineService['getSnapshot']>['messages'], runId: string): number | string | null {
  const message = messages.find((candidate) => candidate.role === 'assistant' && candidate.runId === runId);
  if (!message) {
    return null;
  }

  for (let index = message.events.length - 1; index >= 0; index -= 1) {
    const event = message.events[index];
    if ('eventId' in event && event.eventId !== undefined && event.eventId !== null) {
      return event.eventId;
    }
  }

  return null;
}

function buildMessageContext(snapshot: ContextPickerSnapshot): ChatMessageContext | undefined {
  const selectedSkills = snapshot.selectedSkills;
  const selectedDesignFiles = snapshot.selectedDesignFiles;
  if (selectedSkills.length === 0 && selectedDesignFiles.length === 0) {
    return undefined;
  }

  const context: ChatMessageContext = {};
  if (selectedSkills.length > 0) {
    context.selectedSkills = selectedSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.triggers ? { triggers: [...skill.triggers] } : {}),
    }));
  }
  if (selectedDesignFiles.length > 0) {
    context.selectedDesignFiles = selectedDesignFiles.map((file) => ({
      ...file,
    }));
  }

  return context;
}
