import React from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { Clock, MessageSquarePlus } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  StatusDot,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tutti-os/ui-system/components';
import {
  AddIcon,
  ChatIcon,
  ChevronUpIcon,
  CloseIcon,
  DashboardIcon,
  DeleteIcon,
  EditIcon,
  FileTextIcon,
  MinimizeIcon,
  RestoreIcon,
} from '@tutti-os/ui-system/icons';
import type { CanvasCommentAttachment, ChatAttachment } from '../types';
import type { FileOpEntry } from '../runtime/file-ops';
import type {
  CanvasCommentStatus,
  CanvasPreviewComment,
} from '../features/canvas-workspace/canvas-comment/canvas-comment-types';
import type {
  ChatConversationSummary,
  ChatTimelineMessage,
  ChatTimelineSnapshot,
  GeneratedFileEntry,
  MessageBlock,
} from '../services/chat-timeline/chat-timeline-types';
import type { QueuedTurnPreview } from '../services/chat-session/chat-session-types';
import type {
  ContextPickerSnapshot,
  ContextSearchResultItem,
} from '../services/context-picker/context-picker-types';
import type { WorkspaceFile } from '../features/canvas-workspace';
import { type TranslateFn, useTranslation } from '../i18n';
import { AssistantMessage } from './AssistantMessage';
import {
  ChatComposer,
  type ChatComposerAgentAvailability,
  type ChatComposerDesignSystem,
  type ChatComposerDesignSystemPickerState,
  type ChatComposerHandle,
} from './ChatComposer';
import { PRESET_PROMPT_COPY_KEYS, pickPresetPrompts } from './presetPrompts';

const PREVIEW_COMMENT_DEFAULT_CONTENTS = new Set([
  'Apply the attached preview comment.',
  'Apply the attached preview comments.',
]);
const IMAGE_PREVIEW_WHEEL_STEP = 0.004;
const IMAGE_PREVIEW_BUTTON_STEP = 0.25;
const IMAGE_PREVIEW_INITIAL_SCALE = 0.95;
const IMAGE_PREVIEW_ZOOM_ANIMATION_MS = 160;
const IMAGE_PREVIEW_LOAD_CENTER_MS = 120;
const IMAGE_PREVIEW_ZOOM_ANIMATION = 'easeOut' as const;

export interface ChatPaneProps {
  projectId?: string | null;
  projectTitle?: string | null;
  snapshot: ChatTimelineSnapshot;
  designFiles?: WorkspaceFile[];
  contextSnapshot: ContextPickerSnapshot;
  contextSearch(query: string): Promise<{ items: ContextSearchResultItem[] }>;
  contextSelect(item: ContextSearchResultItem): void | Promise<void>;
  contextRemove?(kind: ContextSearchResultItem['kind'], id: string): void;
  activeDesignSystem?: ChatComposerDesignSystem | null;
  designSystems?: ChatComposerDesignSystem[];
  designSystemPickerState?: ChatComposerDesignSystemPickerState;
  designSystemPickerError?: string | null;
  commentAttachments?: CanvasCommentAttachment[];
  previewComments?: CanvasPreviewComment[];
  commentPanelOpen?: boolean;
  agentAvailability?: ChatComposerAgentAvailability[];
  queuedTurns?: QueuedTurnPreview[];
  startingRun?: boolean;
  onSend(input: {
    draft: string;
    files: File[];
    attachments?: ChatAttachment[];
    agentId?: string;
    commentAttachments?: CanvasCommentAttachment[];
  }): void | Promise<void>;
  onOpenDesignSystemPicker?(): void | Promise<void>;
  onSelectDesignSystem?(designSystemId: string | null): void | Promise<void>;
  onInstallAgent?(agentId: string): void | Promise<void>;
  onClosePreviewCommentsPanel?(): void;
  onSendPreviewComments?(comments: CanvasPreviewComment[], agentId: string): void | Promise<void>;
  onDeletePreviewComment?(commentId: string): void | Promise<void>;
  onOpenPreviewComment?(comment: CanvasPreviewComment): void | Promise<void>;
  onPatchPreviewCommentStatus?(commentId: string, status: CanvasCommentStatus): void | Promise<void>;
  onStop(): void | Promise<void>;
  onAnswerToolQuestion(toolUseId: string, content: string): void | Promise<void>;
  onOpenAttachment?(attachment: ChatAttachment): void;
  onOpenGeneratedFile?(file: GeneratedFileEntry): void;
  onOpenFileOp?(op: FileOpEntry): void;
  onDeleteQueuedTurn?(queueId: string): void;
  onSendQueuedTurnNext?(queueId: string): void;
  onCreateConversation(): void;
  onSelectConversation(conversationId: string): void;
  onRenameConversation(conversationId: string, title: string): void;
  onRenameProject?(projectId: string, title: string): void | Promise<void>;
  onDeleteConversation?(conversationId: string): void;
}

export function ChatPane({
  projectId = null,
  projectTitle = null,
  snapshot,
  designFiles,
  contextSnapshot,
  contextSearch,
  contextSelect,
  contextRemove,
  activeDesignSystem = null,
  designSystems = [],
  designSystemPickerState = 'idle',
  designSystemPickerError = null,
  commentAttachments = [],
  previewComments = [],
  commentPanelOpen = false,
  agentAvailability = [],
  queuedTurns = [],
  startingRun = false,
  onSend,
  onOpenDesignSystemPicker,
  onSelectDesignSystem,
  onInstallAgent,
  onClosePreviewCommentsPanel,
  onSendPreviewComments,
  onDeletePreviewComment,
  onOpenPreviewComment,
  onPatchPreviewCommentStatus,
  onStop,
  onAnswerToolQuestion,
  onOpenAttachment,
  onOpenGeneratedFile,
  onOpenFileOp,
  onDeleteQueuedTurn,
  onSendQueuedTurnNext,
  onCreateConversation,
  onSelectConversation,
  onRenameConversation,
  onRenameProject,
  onDeleteConversation,
}: ChatPaneProps) {
  const { locale, t } = useTranslation();
  const visibleSnapshot = React.useMemo(
    () => (designFiles ? filterSnapshotDesignFileBlocks(snapshot, designFiles) : snapshot),
    [designFiles, snapshot],
  );
  const streaming = startingRun || isStreamingPhase(visibleSnapshot.phase);
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const chatScrollPositionsRef = React.useRef(new Map<string, number>());
  const composerRef = React.useRef<ChatComposerHandle | null>(null);
  const historyWrapRef = React.useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(snapshot.activeConversationTitle);
  const normalizedProjectTitle = projectTitle?.trim() || null;
  const [localProjectTitle, setLocalProjectTitle] = React.useState<string | null>(normalizedProjectTitle);
  const [composerDraft, setComposerDraft] = React.useState('');
  const [composerAgentName, setComposerAgentName] = React.useState('Codex');
  const [scrolledFromBottom, setScrolledFromBottom] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<ImagePreviewState | null>(null);
  const [previewImageFitScale, setPreviewImageFitScale] = React.useState(IMAGE_PREVIEW_INITIAL_SCALE);
  const [pendingDeleteConversation, setPendingDeleteConversation] = React.useState<ChatConversationSummary | null>(null);
  const messageGroups = React.useMemo(
    () => groupMessagesByDay(visibleSnapshot.messages, locale),
    [locale, visibleSnapshot.messages],
  );
  const activeConversationProvider = React.useMemo(() => {
    const provider = visibleSnapshot.conversations.find(
      (conversation) => conversation.id === visibleSnapshot.activeConversationId,
    )?.provider;
    return provider === 'claude' || provider === 'codex' ? provider : null;
  }, [visibleSnapshot.activeConversationId, visibleSnapshot.conversations]);
  const activeQueuedTurns = React.useMemo(
    () => queuedTurns.filter((turn) => turn.conversationId === visibleSnapshot.activeConversationId),
    [queuedTurns, visibleSnapshot.activeConversationId],
  );
  const canCreateConversation = visibleSnapshot.messages.length > 0;
  const createConversationUnavailableReason = t('chat.activeConversation.startNewUnavailable');
  const displayTitle = localProjectTitle || localizedConversationTitle(visibleSnapshot.activeConversationTitle, t);
  const editingProjectTitle = Boolean(projectId && normalizedProjectTitle !== null);
  const chatScrollKey = visibleSnapshot.activeConversationId ?? 'empty-conversation';
  const openImagePreview = React.useCallback((image: ImagePreviewState) => {
    setPreviewImageFitScale(IMAGE_PREVIEW_INITIAL_SCALE);
    setPreviewImage(image);
  }, []);

  const rememberChatScrollPosition = React.useCallback((node: HTMLDivElement | null = logRef.current) => {
    if (!node) return;
    chatScrollPositionsRef.current.set(chatScrollKey, node.scrollTop);
  }, [chatScrollKey]);

  const setChatLogRef = React.useCallback((node: HTMLDivElement | null) => {
    if (logRef.current && logRef.current !== node) {
      rememberChatScrollPosition(logRef.current);
    }
    logRef.current = node;
    if (!node) return;
    const previousScrollTop = chatScrollPositionsRef.current.get(chatScrollKey);
    if (typeof previousScrollTop === 'number') {
      node.scrollTop = previousScrollTop;
    }
  }, [chatScrollKey, rememberChatScrollPosition]);

  React.useEffect(() => {
    setLocalProjectTitle(normalizedProjectTitle);
  }, [normalizedProjectTitle]);

  React.useEffect(() => {
    setTitleDraft(localProjectTitle ?? visibleSnapshot.activeConversationTitle);
  }, [localProjectTitle, visibleSnapshot.activeConversationId, visibleSnapshot.activeConversationTitle]);

  React.useEffect(() => {
    if (!historyOpen) return;

    function closeHistoryOnOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyWrapRef.current?.contains(target)) return;
      setHistoryOpen(false);
    }

    function closeHistoryOnWindowBlur(): void {
      setHistoryOpen(false);
    }

    document.addEventListener('pointerdown', closeHistoryOnOutsidePointerDown);
    window.addEventListener('blur', closeHistoryOnWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', closeHistoryOnOutsidePointerDown);
      window.removeEventListener('blur', closeHistoryOnWindowBlur);
    };
  }, [historyOpen]);

  React.useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (visibleSnapshot.messages.length === 0) {
      log.scrollTop = 0;
      return;
    }
    if (typeof log.scrollTo === 'function') {
      log.scrollTo({ top: log.scrollHeight });
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }, [visibleSnapshot.messages, visibleSnapshot.phase, visibleSnapshot.activeConversationId]);

  function commitTitleRename(nextTitle?: string): void {
    const normalized = (nextTitle ?? titleDraft).trim();
    if (!normalized) {
      setEditingTitle(false);
      return;
    }

    if (projectId && editingProjectTitle) {
      const previousTitle = localProjectTitle;
      if (previousTitle !== normalized) {
        setLocalProjectTitle(normalized);
        void Promise.resolve(onRenameProject?.(projectId, normalized)).catch(() => {
          setLocalProjectTitle(previousTitle);
        });
      }
      setEditingTitle(false);
      return;
    }

    const conversationId = visibleSnapshot.activeConversationId;
    if (!conversationId) return;
    onRenameConversation(conversationId, normalized);
    setEditingTitle(false);
  }

  function startTitleEdit(): void {
    setTitleDraft(displayTitle);
    setEditingTitle(true);
  }

  function jumpToBottom(): void {
    const log = logRef.current;
    if (!log) return;
    if (typeof log.scrollTo === 'function') {
      log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    } else {
      log.scrollTop = log.scrollHeight;
    }
    setScrolledFromBottom(false);
  }

  function requestConversationDelete(conversation: ChatConversationSummary): void {
    setPendingDeleteConversation(conversation);
    setHistoryOpen(false);
  }

  function confirmConversationDelete(): void {
    if (!pendingDeleteConversation || !onDeleteConversation) return;
    onDeleteConversation(pendingDeleteConversation.id);
    setPendingDeleteConversation(null);
  }

  function editQueuedTurn(turn: QueuedTurnPreview): void {
    onDeleteQueuedTurn?.(turn.id);
    composerRef.current?.setDraft(editableQueuedTurnDraft(turn), { attachments: queuedTurnAttachments(turn) });
  }

  const pendingDeleteTitle = pendingDeleteConversation
    ? localizedConversationTitle(pendingDeleteConversation.title, t)
    : '';

  return (
    <div className="pane">
      {commentPanelOpen ? (
        <>
          <div className="chat-header">
            <div className="chat-active-conversation">
              <span className="chat-active-conversation-title">{t('chat.modes.comments')}</span>
            </div>
            <div className="chat-header-actions">
              <button
                type="button"
                className="icon-only"
                aria-label={t('chat.previewComments.close')}
                onClick={onClosePreviewCommentsPanel}
              >
                <CloseIcon size={14} aria-hidden />
              </button>
            </div>
          </div>
          <PreviewCommentsPanel
            comments={previewComments}
            projectId={projectId}
            agentId={activeConversationProvider ?? 'codex'}
            onSendSelected={onSendPreviewComments}
            onDelete={onDeletePreviewComment}
            onOpenComment={onOpenPreviewComment}
            onOpenImagePreview={openImagePreview}
            onPatchStatus={onPatchPreviewCommentStatus}
            t={t}
          />
        </>
      ) : (
        <>
          <div className="chat-header">
        <div className="chat-active-conversation">
          <a className="chat-home-link icon-only" href="/" aria-label={t('chat.activeConversation.backToDashboard')}>
            <DashboardIcon size={14} />
          </a>
          {editingTitle ? (
            <input
              autoFocus
              aria-label={editingProjectTitle ? t('chat.activeConversation.renameActiveProject') : t('chat.activeConversation.renameActive')}
              className="chat-active-conversation-input"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onBlur={(event) => commitTitleRename(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTitleRename(event.currentTarget.value);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTitleDraft(displayTitle);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <>
              <span className="chat-active-conversation-title" data-testid="chat-active-conversation-title">
                {displayTitle}
              </span>
              {visibleSnapshot.activeConversationId ? (
                <button
                  type="button"
                  aria-label={editingProjectTitle ? t('chat.activeConversation.renameProject') : t('chat.activeConversation.renameConversation')}
                  className="chat-active-conversation-rename"
                  onClick={startTitleEdit}
                >
                  <EditIcon size={12} aria-hidden />
                </button>
              ) : null}
            </>
          )}
        </div>

        <TooltipProvider delayDuration={120}>
          <div className="chat-header-actions">
            <div ref={historyWrapRef} className={`chat-history-wrap${historyOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="icon-only"
                aria-label={t('chat.activeConversation.conversationHistory')}
                onClick={() => setHistoryOpen((value) => !value)}
              >
                <Clock size={14} aria-hidden />
              </button>
              {historyOpen ? (
                <div className="chat-history-menu" role="menu">
                  <div className="chat-history-menu-head">
                    <span className="chat-history-menu-title">{t('chat.activeConversation.title')}</span>
                    <CreateConversationTooltip
                      disabled={!canCreateConversation}
                      reason={createConversationUnavailableReason}
                    >
                      <button
                        type="button"
                        className="chat-history-new"
                        disabled={!canCreateConversation}
                        onClick={() => {
                          onCreateConversation();
                          setHistoryOpen(false);
                        }}
                      >
                        ＋<span>{t('chat.activeConversation.newConversation')}</span>
                      </button>
                    </CreateConversationTooltip>
                  </div>
                  <div className="chat-history-list">
                    {visibleSnapshot.conversations.map((conversation) => (
                      <ConversationButton
                        key={conversation.id}
                        active={conversation.id === visibleSnapshot.activeConversationId}
                        conversation={conversation}
                        onClick={() => {
                          onSelectConversation(conversation.id);
                          setHistoryOpen(false);
                        }}
                        onDelete={
                          onDeleteConversation && visibleSnapshot.conversations.length > 1
                            ? () => requestConversationDelete(conversation)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <CreateConversationTooltip
              disabled={!canCreateConversation}
              reason={createConversationUnavailableReason}
            >
              <button
                type="button"
                className="icon-only"
                aria-label={t('chat.activeConversation.startNew')}
                disabled={!canCreateConversation}
                onClick={onCreateConversation}
              >
                <MessageSquarePlus size={14} aria-hidden />
              </button>
            </CreateConversationTooltip>
          </div>
        </TooltipProvider>
      </div>

      <div className="chat-log-wrap">
          <div
            className="chat-log"
            ref={setChatLogRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              rememberChatScrollPosition(node);
              const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
              setScrolledFromBottom(!atBottom);
            }}
          >
            {visibleSnapshot.messages.length === 0 ? (
              projectId ? (
                <ProjectEmptyState agentName={agentDisplayName(activeConversationProvider, composerAgentName)} />
              ) : (
                <EmptyState
                  onPickStarter={(prompt) => composerRef.current?.setDraft(prompt)}
                />
              )
            ) : null}

            {messageGroups.map((group) => (
              <React.Fragment key={group.label}>
                <div className="chat-day-separator" role="separator">
                  {group.label}
                </div>
                {group.messages.map((message) => (
                  <TimelineMessage
                    key={message.id}
                    message={message}
                    streaming={streaming && message.role === 'assistant' && message.runStatus === 'running'}
                    nextUserContent={nextUserContent(visibleSnapshot.messages, message.id)}
                    projectId={projectId}
                    onOpenImagePreview={openImagePreview}
                    onAnswerToolQuestion={onAnswerToolQuestion}
                    onSubmitToolQuestionFallback={(content) =>
                      onSend({ draft: content, files: [], agentId: activeConversationProvider ?? 'codex' })
                    }
                    onOpenAttachment={onOpenAttachment}
                    onOpenGeneratedFile={onOpenGeneratedFile}
                    onOpenFileOp={onOpenFileOp}
                  />
                ))}
              </React.Fragment>
            ))}
          </div>

          <button
            type="button"
            className={`chat-jump-btn${scrolledFromBottom ? ' chat-jump-btn-active' : ''}`}
            onClick={jumpToBottom}
            aria-hidden={!scrolledFromBottom}
            tabIndex={scrolledFromBottom ? 0 : -1}
          >
            <span>{t('chat.message.backToBottom')}</span>
          </button>
        </div>

        {activeQueuedTurns.length > 0 ? (
          <QueuedTurnsPreview
            queuedTurns={activeQueuedTurns}
            projectId={projectId}
            onOpenImagePreview={openImagePreview}
            onOpenAttachment={onOpenAttachment}
            onDeleteQueuedTurn={onDeleteQueuedTurn}
            onEditQueuedTurn={editQueuedTurn}
            onSendQueuedTurnNext={onSendQueuedTurnNext}
            t={t}
          />
        ) : null}

        <ChatComposer
          ref={composerRef}
          streaming={streaming}
          draft={composerDraft}
          context={{
            search: contextSearch,
            selectResult: contextSelect,
            removeSelection: contextRemove,
            snapshot: contextSnapshot,
          }}
          commentAttachments={commentAttachments}
          agentAvailability={agentAvailability}
          lockedAgentId={activeConversationProvider}
          activeDesignSystem={activeDesignSystem}
          designSystems={designSystems}
          designSystemPickerState={designSystemPickerState}
          designSystemPickerError={designSystemPickerError}
          onOpenDesignSystemPicker={onOpenDesignSystemPicker}
          onSelectDesignSystem={onSelectDesignSystem}
          onInstallAgent={onInstallAgent}
          onAgentChange={(_, label) => setComposerAgentName(label)}
          onDraftChange={setComposerDraft}
          onSend={onSend}
          onStop={onStop}
        />
        </>
      )}

      <Dialog open={previewImage !== null} onOpenChange={(open) => {
        if (!open) setPreviewImage(null);
      }}>
        {previewImage ? (
          <DialogContent className="chat-image-preview-dialog" showCloseButton>
            <DialogHeader>
              <DialogTitle>{previewImage.name}</DialogTitle>
              <DialogDescription className="chat-image-preview-description">
                {t('chat.imagePreview.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="chat-image-preview-body">
              <TransformWrapper
                centerOnInit
                centerZoomedOut
                initialScale={IMAGE_PREVIEW_INITIAL_SCALE}
                minScale={0.5}
                maxScale={6}
                smooth
                wheel={{ step: IMAGE_PREVIEW_WHEEL_STEP }}
                zoomAnimation={{
                  animationTime: IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
                  animationType: IMAGE_PREVIEW_ZOOM_ANIMATION,
                }}
                doubleClick={{
                  mode: 'toggle',
                  step: IMAGE_PREVIEW_BUTTON_STEP,
                  animationTime: IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
                  animationType: IMAGE_PREVIEW_ZOOM_ANIMATION,
                }}
                panning={{ velocityDisabled: true }}
              >
                {({ centerView, zoomIn, zoomOut }: ReactZoomPanPinchContentRef) => (
                  <>
                    <div className="chat-image-preview-toolbar" aria-label={t('chat.imagePreview.controls')}>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        aria-label={t('chat.imagePreview.zoomIn')}
                        onClick={() => zoomIn(
                          IMAGE_PREVIEW_BUTTON_STEP,
                          IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
                          IMAGE_PREVIEW_ZOOM_ANIMATION,
                        )}
                      >
                        <AddIcon size={14} aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        aria-label={t('chat.imagePreview.zoomOut')}
                        onClick={() => zoomOut(
                          IMAGE_PREVIEW_BUTTON_STEP,
                          IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
                          IMAGE_PREVIEW_ZOOM_ANIMATION,
                        )}
                      >
                        <MinimizeIcon size={14} aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        aria-label={t('chat.imagePreview.resetZoom')}
                        onClick={() => centerView(
                          previewImageFitScale,
                          IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
                          IMAGE_PREVIEW_ZOOM_ANIMATION,
                        )}
                      >
                        <RestoreIcon size={14} aria-hidden />
                      </Button>
                    </div>
                    <TransformComponent
                      wrapperClass="chat-image-preview-zoom"
                      contentClass="chat-image-preview-zoom-content"
                    >
                      <img
                        className="chat-image-preview-img"
                        src={previewImage.url}
                        alt={previewImage.name}
                        aria-label={t('chat.imagePreview.image', { name: previewImage.name })}
                        onLoad={(event) => {
                          const fitScale = imagePreviewFitScale(event.currentTarget);
                          setPreviewImageFitScale(fitScale);
                          centerView(fitScale, IMAGE_PREVIEW_LOAD_CENTER_MS, IMAGE_PREVIEW_ZOOM_ANIMATION);
                        }}
                      />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
              <a className="chat-image-preview-link" href={previewImage.url} target="_blank" rel="noreferrer">
                {t('chat.imagePreview.openOriginal')}
              </a>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={pendingDeleteConversation !== null} onOpenChange={(open) => {
        if (!open) setPendingDeleteConversation(null);
      }}>
        {pendingDeleteConversation ? (
          <DialogContent className="chat-delete-conversation-dialog" showCloseButton>
            <DialogHeader>
              <DialogTitle>{t('chat.activeConversation.deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>
                {t('chat.activeConversation.deleteConfirmDescription', { title: pendingDeleteTitle })}
              </DialogDescription>
            </DialogHeader>
            <div className="chat-delete-conversation-actions">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setPendingDeleteConversation(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="project-primary-button"
                onClick={confirmConversationDelete}
              >
                {t('chat.activeConversation.deleteConfirmAction')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

const QueuedTurnsPreview = React.forwardRef<HTMLElement, {
  queuedTurns: QueuedTurnPreview[];
  projectId?: string | null;
  onOpenImagePreview(preview: ImagePreviewState): void;
  onOpenAttachment?: (attachment: ChatAttachment) => void;
  onDeleteQueuedTurn?: (queueId: string) => void;
  onEditQueuedTurn?: (turn: QueuedTurnPreview) => void;
  onSendQueuedTurnNext?: (queueId: string) => void;
  t: TranslateFn;
}>(function QueuedTurnsPreview({
  queuedTurns,
  projectId,
  onOpenImagePreview,
  onOpenAttachment,
  onDeleteQueuedTurn,
  onEditQueuedTurn,
  onSendQueuedTurnNext,
  t,
}, ref) {
  return (
    <section className="queued-turns" aria-label={t('chat.message.queuedTurns')} ref={ref}>
      {queuedTurns.map((turn) => (
        <div className="queued-turn" key={turn.id}>
          <div className="queued-turn__content">
            <div className="queued-turn__body">
              <Badge variant="secondary">{t('chat.message.queued')}</Badge>
              <div className="queued-turn__summary">
                <UserMessageSkillContext skills={turn.messageContext?.selectedSkills ?? []} />
                <UserMessageDesignFileContext
                  files={turn.messageContext?.selectedDesignFiles ?? []}
                  onOpenAttachment={onOpenAttachment}
                />
                <QueuedTurnContent turn={turn} />
              </div>
            </div>
            <QueuedTurnActions
              turn={turn}
              queueId={turn.id}
              onDeleteQueuedTurn={onDeleteQueuedTurn}
              onEditQueuedTurn={onEditQueuedTurn}
              onSendQueuedTurnNext={onSendQueuedTurnNext}
              t={t}
            />
          </div>
          {turn.commentAttachments.length > 0 ? (
            <UserMessageCommentAttachments
              commentAttachments={turn.commentAttachments}
              projectId={projectId}
              onOpenImagePreview={onOpenImagePreview}
            />
          ) : null}
          <UserMessageAttachments
            attachments={queuedTurnAttachments(turn)}
            projectId={projectId}
            onOpenImagePreview={onOpenImagePreview}
            onOpenAttachment={onOpenAttachment}
          />
        </div>
      ))}
    </section>
  );
});

function QueuedTurnActions({
  turn,
  queueId,
  onDeleteQueuedTurn,
  onEditQueuedTurn,
  onSendQueuedTurnNext,
  t,
}: {
  turn: QueuedTurnPreview;
  queueId: string;
  onDeleteQueuedTurn?: (queueId: string) => void;
  onEditQueuedTurn?: (turn: QueuedTurnPreview) => void;
  onSendQueuedTurnNext?: (queueId: string) => void;
  t: TranslateFn;
}) {
  if (!onDeleteQueuedTurn && !onEditQueuedTurn && !onSendQueuedTurnNext) return null;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="queued-turn__actions">
        {onEditQueuedTurn ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="queued-turn__action"
                aria-label={t('chat.message.editQueuedTurn')}
                onClick={() => onEditQueuedTurn(turn)}
              >
                <EditIcon size={13} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.message.editQueuedTurn')}</TooltipContent>
          </Tooltip>
        ) : null}
        {onSendQueuedTurnNext ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="queued-turn__action"
                aria-label={t('chat.message.sendQueuedTurnNext')}
                onClick={() => onSendQueuedTurnNext(queueId)}
              >
                <ChevronUpIcon size={13} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.message.sendQueuedTurnNext')}</TooltipContent>
          </Tooltip>
        ) : null}
        {onDeleteQueuedTurn ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="queued-turn__action queued-turn__action--delete"
                aria-label={t('chat.message.deleteQueuedTurn')}
                onClick={() => onDeleteQueuedTurn(queueId)}
              >
                <DeleteIcon size={13} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.message.deleteQueuedTurn')}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function QueuedTurnContent({ turn }: { turn: QueuedTurnPreview }) {
  if (shouldSummarizeUserPreviewComments(turn.content, turn.commentAttachments)) {
    return <UserMessageText content={turn.content} commentAttachments={turn.commentAttachments} />;
  }

  if (isDefaultFileReviewContent(turn.content) && queuedTurnAttachments(turn).length > 0) {
    return null;
  }

  if (turn.content.trim().length === 0) {
    return null;
  }

  return <span className="queued-turn__plain">{turn.content}</span>;
}

function PreviewCommentsPanel({
  comments,
  projectId,
  agentId,
  onSendSelected,
  onDelete,
  onOpenComment,
  onOpenImagePreview,
  onPatchStatus,
  t,
}: {
  comments: CanvasPreviewComment[];
  projectId?: string | null;
  agentId: string;
  onSendSelected?: (comments: CanvasPreviewComment[], agentId: string) => void | Promise<void>;
  onDelete?: (commentId: string) => void | Promise<void>;
  onOpenComment?: (comment: CanvasPreviewComment) => void | Promise<void>;
  onOpenImagePreview(preview: ImagePreviewState): void;
  onPatchStatus?: (commentId: string, status: CanvasCommentStatus) => void | Promise<void>;
  t: TranslateFn;
}) {
  const activeComments = React.useMemo(() => comments.filter((comment) => comment.status !== 'attached'), [comments]);
  const [sendingCommentIds, setSendingCommentIds] = React.useState<Set<string>>(() => new Set());
  const visibleComments = React.useMemo(
    () => activeComments.filter((comment) => !sendingCommentIds.has(comment.id)),
    [activeComments, sendingCommentIds],
  );
  const canSend = visibleComments.length > 0 && sendingCommentIds.size === 0 && Boolean(onSendSelected);

  React.useEffect(() => {
    setSendingCommentIds((currentIds) => {
      if (currentIds.size === 0) return currentIds;
      const activeIds = new Set(activeComments.map((comment) => comment.id));
      const nextIds = new Set([...currentIds].filter((id) => activeIds.has(id)));
      return nextIds.size === currentIds.size ? currentIds : nextIds;
    });
  }, [activeComments]);

  async function sendActiveComments(): Promise<void> {
    if (!onSendSelected || visibleComments.length === 0 || sendingCommentIds.size > 0) {
      return;
    }

    const sentComments = [...visibleComments];
    setSendingCommentIds(new Set(sentComments.map((comment) => comment.id)));
    await onSendSelected(sentComments, agentId);
    if (onPatchStatus) {
      await Promise.all(sentComments.map((comment) => onPatchStatus(comment.id, 'attached')));
    }
  }

  return (
    <section className="preview-comments-panel" aria-label={t('chat.previewComments.panel')}>
      <div className="preview-comments-panel__body">
        {visibleComments.length === 0 ? (
          <div className="preview-comments-panel__empty">
            {t('chat.previewComments.empty')}
          </div>
        ) : (
          <div className="preview-comment-records__list">
            {visibleComments.map((comment) => (
              <PreviewCommentRow
                key={comment.id}
                comment={comment}
                projectId={projectId}
                onDelete={onDelete}
                onOpen={onOpenComment}
                onOpenImagePreview={onOpenImagePreview}
                onPatchStatus={onPatchStatus}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
      <div className="preview-comments-panel__composer">
        <div className="preview-comments-panel__composer-shell">
          <div className="preview-comments-panel__composer-actions">
            <Button
              type="button"
              size="sm"
              className="project-primary-button preview-comments-panel__send-button"
              disabled={!canSend}
              onClick={() => void sendActiveComments().catch(() => undefined)}
            >
              {t('chat.previewComments.send')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PreviewCommentRow({
  comment,
  projectId,
  onDelete,
  onOpen,
  onOpenImagePreview,
  onPatchStatus,
  t,
}: {
  comment: CanvasPreviewComment;
  projectId?: string | null;
  onDelete?: (commentId: string) => void | Promise<void>;
  onOpen?: (comment: CanvasPreviewComment) => void | Promise<void>;
  onOpenImagePreview(preview: ImagePreviewState): void;
  onPatchStatus?: (commentId: string, status: CanvasCommentStatus) => void | Promise<void>;
  t: TranslateFn;
}) {
  async function openComment(): Promise<void> {
    await onOpen?.(comment);
    if (comment.status !== 'open') {
      await onPatchStatus?.(comment.id, 'open');
    }
  }

  const thumbnailUrl = previewCommentThumbnailUrl(comment, projectId);
  const thumbnailName = comment.screenshotPath ? fileNameFromPath(comment.screenshotPath) : '';
  const targetLabel = comment.label || comment.targetId;

  return (
    <div className="preview-comment-record" data-testid={`chat-preview-comment-row-${comment.id}`}>
      {thumbnailUrl ? (
        <button
          type="button"
          className="preview-comment-record__thumbnail preview-comment-record__thumbnail-button"
          aria-label={t('chat.imagePreview.viewAttached', { name: thumbnailName })}
          onClick={() => onOpenImagePreview({ name: thumbnailName, url: thumbnailUrl })}
        >
          <img src={thumbnailUrl} alt="" loading="lazy" />
        </button>
      ) : (
        <div className="preview-comment-record__thumbnail" aria-hidden="true">
          <div className="preview-comment-record__thumbnail-placeholder" />
        </div>
      )}
      <div className="preview-comment-record__main">
        <div
          className="preview-comment-record__note"
          aria-label={t('chat.previewComments.commentFor', { target: targetLabel })}
        >
          {comment.note}
        </div>
      </div>
      <div className="preview-comment-record__actions">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="preview-comment-record__open-button"
          disabled={!onOpen && (!onPatchStatus || comment.status === 'open')}
          onClick={() => void openComment().catch(() => undefined)}
        >
          {t('chat.previewComments.open')}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="chrome"
          aria-label={t('chat.previewComments.deleteFor', { target: targetLabel })}
          disabled={!onDelete}
          onClick={() => onDelete?.(comment.id)}
        >
          <DeleteIcon size={13} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function previewCommentThumbnailUrl(comment: CanvasPreviewComment, projectId?: string | null): string | null {
  const screenshotPath = comment.screenshotPath?.trim();
  if (!screenshotPath) return null;

  return attachmentPreviewUrl(
    {
      path: screenshotPath,
      name: fileNameFromPath(screenshotPath),
      kind: 'image',
    },
    projectId,
  );
}

function TimelineMessage({
  message,
  streaming,
  nextUserContent,
  projectId,
  onOpenImagePreview,
  onAnswerToolQuestion,
  onSubmitToolQuestionFallback,
  onOpenAttachment,
  onOpenGeneratedFile,
  onOpenFileOp,
}: {
  message: ChatTimelineMessage;
  streaming: boolean;
  nextUserContent?: string;
  projectId?: string | null;
  onOpenImagePreview(preview: ImagePreviewState): void;
  onAnswerToolQuestion(toolUseId: string, content: string): void | Promise<void>;
  onSubmitToolQuestionFallback(content: string): void | Promise<void>;
  onOpenAttachment?: (attachment: ChatAttachment) => void;
  onOpenGeneratedFile?: (file: GeneratedFileEntry) => void;
  onOpenFileOp?: (op: FileOpEntry) => void;
}) {
  const { t } = useTranslation();
  if (message.role === 'assistant') {
    return (
      <div className="msg assistant" data-message-id={message.id}>
        <div className="role">
          <span>Codex</span>
          {message.runStatus === 'running' ? (
            <Badge className="chat-run-status" variant="secondary" aria-label={t('chat.message.agentRunStatus')}>
              <StatusDot tone="blue" size="xs" pulse ariaLabel={t('chat.message.running')} />
              {t('chat.message.running')}
            </Badge>
          ) : null}
          <span className="msg-time">{messageTimeLabel(message, t)}</span>
        </div>
        <AssistantMessage
          message={message}
          blocks={message.blocks}
          streaming={streaming}
          nextUserContent={nextUserContent}
          onAnswerToolQuestion={onAnswerToolQuestion}
          onSubmitToolQuestionFallback={onSubmitToolQuestionFallback}
          onOpenGeneratedFile={onOpenGeneratedFile}
          onOpenFileOp={onOpenFileOp}
        />
      </div>
    );
  }

  const messageAttachments = blockAttachmentsForUserMessage(message);
  const commentAttachments = message.commentAttachments ?? [];
  const contextDesignFiles = message.context?.selectedDesignFiles ?? [];
  const hasAttachments = messageAttachments.length > 0 || commentAttachments.length > 0 || contextDesignFiles.length > 0;

  return (
    <div className={`msg user${hasAttachments ? ' msg--has-attachments' : ''}`} data-message-id={message.id}>
      <div className="role">
        <span>{t('chat.message.user')}</span>
        {message.turnStatus === 'queued' ? (
          <Badge className="chat-run-status" variant="secondary" aria-label={t('chat.message.queuedTurnStatus')}>
            {t('chat.message.queued')}
          </Badge>
        ) : null}
        <span className="msg-time">{messageTimeLabel(message, t)}</span>
      </div>
      <div className="user-text-wrap">
        <UserMessageSkillContext skills={message.context?.selectedSkills ?? []} />
        <UserMessageDesignFileContext files={contextDesignFiles} onOpenAttachment={onOpenAttachment} />
        <UserMessageText
          content={message.content}
          commentAttachments={commentAttachments}
          attachments={userMessageAttachments(message)}
        />
        <UserMessageAttachments
          attachments={messageAttachments}
          projectId={projectId}
          onOpenImagePreview={onOpenImagePreview}
          onOpenAttachment={onOpenAttachment}
        />
        <UserMessageCommentAttachments
          commentAttachments={commentAttachments}
          projectId={projectId}
          onOpenImagePreview={onOpenImagePreview}
        />
      </div>
    </div>
  );
}

function UserMessageSkillContext({
  skills,
}: {
  skills: NonNullable<ChatTimelineMessage['context']>['selectedSkills'];
}) {
  const { t } = useTranslation();
  if (!skills || skills.length === 0) return null;

  return (
    <div className="user-skill-context" aria-label={t('chat.message.selectedSkills')}>
      <span className="user-skill-context__label">{t('chat.message.skill')}</span>
      <div className="user-skill-context__chips">
        {skills.map((skill) => (
          <Badge key={skill.id} className="user-skill-context__chip" variant="secondary">
            {skill.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function UserMessageDesignFileContext({
  files,
  onOpenAttachment,
}: {
  files: NonNullable<ChatTimelineMessage['context']>['selectedDesignFiles'];
  onOpenAttachment?: (attachment: ChatAttachment) => void;
}) {
  const { t } = useTranslation();
  if (!files || files.length === 0) return null;

  return (
    <div className="user-skill-context" aria-label={t('chat.message.selectedFiles')}>
      <span className="user-skill-context__label">{t('chat.message.files')}</span>
      <div className="user-skill-context__chips">
        {files.map((file) => {
          const attachment = chatAttachmentFromDesignFile(file);
          return onOpenAttachment ? (
            <button
              key={selectedDesignFileKey(file)}
              type="button"
              className="user-attachment-file"
              onClick={() => onOpenAttachment(attachment)}
            >
              <FileTextIcon size={14} aria-hidden />
              <span>{file.name}</span>
            </button>
          ) : (
            <span key={selectedDesignFileKey(file)} className="user-attachment-file">
              <FileTextIcon size={14} aria-hidden />
              <span>{file.name}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

type SelectedDesignFileContext = NonNullable<NonNullable<ChatTimelineMessage['context']>['selectedDesignFiles']>[number];

function selectedDesignFileKey(file: SelectedDesignFileContext): string {
  return file.id ?? file.path ?? file.name;
}

function chatAttachmentFromDesignFile(file: SelectedDesignFileContext): ChatAttachment {
  return {
    path: file.path ?? file.name,
    name: file.name,
    kind: file.kind === 'image' ? 'image' : 'file',
    size: file.size,
    mimeType: file.mime,
  };
}

function UserMessageText({
  content,
  commentAttachments,
  attachments = [],
}: {
  content: string;
  commentAttachments: CanvasCommentAttachment[];
  attachments?: ChatAttachment[];
}) {
  const { t } = useTranslation();

  if (commentAttachments.length > 0) return null;

  if (content.trim().length === 0) return null;

  if (isDefaultFileReviewContent(content) && attachments.length > 0) return null;

  if (!shouldSummarizeUserPreviewComments(content, commentAttachments)) {
    return <div className="user-text">{formatUserMessageContentForDisplay(content, t)}</div>;
  }

  return (
    <div className="user-text user-preview-comment-message">
      {commentAttachments.map((attachment, index) => (
        <div key={attachment.id} className="user-preview-comment-message__item">
          <span className="user-preview-comment-message__index">{index + 1}.</span>
          <span>{commentAttachmentPrimaryText(attachment)}</span>
        </div>
      ))}
    </div>
  );
}

function formatUserMessageContentForDisplay(content: string, t: TranslateFn): string {
  const lines = content.split('\n');
  const header = lines[0]?.trim() ?? '';
  if (!/^\[form answers\s+(?:—|-)\s*[\w.-]+\]$/i.test(header)) return content;
  return [t('questionForm.answersRecorded'), ...lines.slice(1)]
    .map((line) => line.replace(/\s+\[value:\s*[^\]]+\]/gi, ''))
    .join('\n');
}

function shouldSummarizeUserPreviewComments(
  content: string,
  commentAttachments: readonly CanvasCommentAttachment[],
): boolean {
  return commentAttachments.length > 0 && PREVIEW_COMMENT_DEFAULT_CONTENTS.has(content.trim());
}

function commentAttachmentPrimaryText(attachment: CanvasCommentAttachment): string {
  return attachment.comment.trim() || attachment.label.trim() || attachment.targetId.trim();
}

function userMessageAttachments(message: ChatTimelineMessage): ChatAttachment[] {
  if (message.role !== 'user') return message.attachments ?? [];
  return attachmentsWithoutPreviewCommentImages(message.attachments ?? [], message.commentAttachments ?? []);
}

function blockAttachmentsForUserMessage(message: ChatTimelineMessage): ChatAttachment[] {
  return userMessageAttachments(message);
}

function queuedTurnAttachments(turn: QueuedTurnPreview): ChatAttachment[] {
  return attachmentsWithoutPreviewCommentImages(turn.attachments, turn.commentAttachments);
}

function editableQueuedTurnDraft(turn: QueuedTurnPreview): string {
  if (
    turn.prompt &&
    turn.content.trim().length === 0 &&
    queuedTurnAttachments(turn).length > 0 &&
    isDefaultFileReviewContent(turn.prompt)
  ) {
    return turn.content;
  }
  return turn.prompt ?? turn.content;
}

function attachmentsWithoutPreviewCommentImages(
  attachments: readonly ChatAttachment[],
  commentAttachments: readonly CanvasCommentAttachment[],
): ChatAttachment[] {
  const screenshotPaths = previewCommentScreenshotPaths(commentAttachments);
  if (screenshotPaths.size === 0) return [...attachments];
  return attachments.filter((attachment) => !screenshotPaths.has(attachment.path));
}

function previewCommentScreenshotPaths(commentAttachments: readonly CanvasCommentAttachment[]): Set<string> {
  return new Set(
    commentAttachments
      .filter((attachment) => attachment.selectionKind === 'visual')
      .map((attachment) => attachment.screenshotPath?.trim() ?? '')
      .filter((path) => path.length > 0),
  );
}

function isDefaultFileReviewContent(content: string): boolean {
  const normalizedContent = content.trim();
  return normalizedContent === 'Review the attached file.' || normalizedContent === 'Review the attached files.';
}

function UserMessageAttachments({
  attachments,
  projectId,
  onOpenImagePreview,
  onOpenAttachment,
}: {
  attachments: ChatAttachment[];
  projectId?: string | null;
  onOpenImagePreview(preview: ImagePreviewState): void;
  onOpenAttachment?: (attachment: ChatAttachment) => void;
}) {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;

  return (
    <div className="user-attachments" aria-label={t('chat.previewComments.messageAttachments')}>
      {attachments.map((attachment) =>
        attachment.kind === 'image' ? (
          <button
            key={`${attachment.path}-${attachment.name}`}
            type="button"
            className="user-attachment-image-button"
            aria-label={t('chat.imagePreview.viewAttached', { name: attachment.name })}
            onClick={() =>
              onOpenImagePreview({
                name: attachment.name,
                url: attachmentPreviewUrl(attachment, projectId),
              })
            }
          >
            <img
              className="user-attachment-image"
              src={attachmentPreviewUrl(attachment, projectId)}
              alt={attachment.name}
              loading="lazy"
            />
          </button>
        ) : onOpenAttachment ? (
          <button
            key={`${attachment.path}-${attachment.name}`}
            type="button"
            className="user-attachment-file"
            onClick={() => onOpenAttachment(attachment)}
          >
            <FileTextIcon size={14} aria-hidden />
            <span>{attachment.name}</span>
          </button>
        ) : (
          <a
            key={`${attachment.path}-${attachment.name}`}
            className="user-attachment-file"
            href={attachmentPreviewUrl(attachment, projectId)}
            target="_blank"
            rel="noreferrer"
          >
            <FileTextIcon size={14} aria-hidden />
            <span>{attachment.name}</span>
          </a>
        ),
      )}
    </div>
  );
}

function UserMessageCommentAttachments({
  commentAttachments,
  projectId,
  onOpenImagePreview,
}: {
  commentAttachments: CanvasCommentAttachment[];
  projectId?: string | null;
  onOpenImagePreview(preview: ImagePreviewState): void;
}) {
  const { t } = useTranslation();
  if (commentAttachments.length === 0) return null;

  return (
    <div className="user-attachments user-comment-attachments" aria-label={t('chat.previewComments.attached')}>
      {commentAttachments.map((attachment) => {
        const previewImage = previewCommentImageAttachment(attachment);
        return (
          <div key={attachment.id} className="preview-comment-attachment-detail">
            <div className="preview-comment-attachment-summary">
              <span className="preview-comment-attachment-text">{t('chat.previewComments.detailSummary', {
                label: commentAttachmentPrimaryText(attachment),
              })}</span>
              {previewImage ? (
                <button
                  type="button"
                  className="preview-comment-attachment-image-button"
                  aria-label={t('chat.imagePreview.viewAttached', { name: previewImage.name })}
                  onClick={() =>
                    onOpenImagePreview({
                      name: previewImage.name,
                      url: attachmentPreviewUrl(previewImage, projectId),
                    })
                  }
                >
                  <img
                    className="preview-comment-attachment-image"
                    src={attachmentPreviewUrl(previewImage, projectId)}
                    alt={previewImage.name}
                    loading="lazy"
                  />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function previewCommentImageAttachment(attachment: CanvasCommentAttachment): ChatAttachment | null {
  if (attachment.selectionKind !== 'visual') return null;
  const screenshotPath = attachment.screenshotPath?.trim();
  if (!screenshotPath) return null;

  return {
    path: screenshotPath,
    name: fileNameFromPath(screenshotPath),
    kind: 'image',
    mimeType: mimeTypeFromImagePath(screenshotPath),
  };
}

interface ImagePreviewState {
  name: string;
  url: string;
}

function imagePreviewFitScale(image: HTMLImageElement): number {
  const wrapper = image.closest<HTMLElement>('.chat-image-preview-zoom');
  const wrapperWidth = wrapper?.clientWidth ?? 0;
  const wrapperHeight = wrapper?.clientHeight ?? 0;
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (wrapperWidth <= 0 || wrapperHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return IMAGE_PREVIEW_INITIAL_SCALE;
  }

  return Math.max(
    0.05,
    Math.min(IMAGE_PREVIEW_INITIAL_SCALE, wrapperWidth / naturalWidth, wrapperHeight / naturalHeight),
  );
}

function attachmentPreviewUrl(attachment: ChatAttachment, projectId?: string | null): string {
  const fileName = attachment.name || attachment.path;
  if (projectId) {
    return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileName)}`;
  }
  return `/api/assets/${encodeURIComponent(fileName)}`;
}

function fileNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).at(-1) || path;
}

function mimeTypeFromImagePath(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.svg')) return 'image/svg+xml';
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  return 'image/*';
}

function nextUserContent(messages: ChatTimelineMessage[], messageId: string): string | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return undefined;
  const next = messages.slice(index + 1).find((message) => message.role === 'user');
  return next?.content;
}

function EmptyState({
  onPickStarter,
}: {
  onPickStarter(prompt: string): void;
}) {
  const presetPrompts = React.useMemo(() => pickPresetPrompts(), []);
  const { t } = useTranslation();

  return (
    <div className="chat-empty-wrap">
      <div className="chat-context">
        <div className="chat-empty-kicker">{t('chat.empty.title')}</div>
        <div className="chat-context-grid" role="list" aria-label={t('chat.empty.projectContext')}>
          {presetPrompts.map((contextPrompt) => (
            <button
              key={contextPrompt.id}
              type="button"
              role="listitem"
              className="chat-context-card"
              onClick={() => onPickStarter(contextPrompt.prompt)}
            >
              <span className="chat-context-icon" aria-hidden>
                {contextPrompt.icon}
              </span>
              <span className="chat-context-copy">
                <span className="chat-context-title">{t(PRESET_PROMPT_COPY_KEYS[contextPrompt.id].title)}</span>
                <span className="chat-context-hint">{t(PRESET_PROMPT_COPY_KEYS[contextPrompt.id].hint)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectEmptyState({ agentName }: { agentName: string }) {
  const { t } = useTranslation();

  return (
    <div className="chat-empty-wrap chat-empty-project-wrap">
      <div className="chat-empty">
        <div className="chat-empty-project-icon" data-testid="project-chat-empty-icon" aria-hidden>
          <DashboardIcon size={22} />
        </div>
        <div className="chat-empty-title">{t('chat.empty.projectTitle')}</div>
        <div className="chat-empty-hint">{t('chat.empty.projectDescription', { agentName })}</div>
      </div>
    </div>
  );
}

function agentDisplayName(agentId: 'codex' | 'claude' | null, fallback: string): string {
  if (agentId === 'claude') return 'Claude Code';
  if (agentId === 'codex') return 'Codex';
  return fallback;
}

function CreateConversationTooltip({
  children,
  disabled,
  reason,
}: {
  children: React.ReactElement;
  disabled: boolean;
  reason: string;
}) {
  if (!disabled) {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="chat-create-conversation-tooltip-trigger">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}

function ConversationButton({
  conversation,
  active,
  onClick,
  onDelete,
}: {
  conversation: ChatConversationSummary;
  active: boolean;
  onClick(): void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const title = localizedConversationTitle(conversation.title, t);

  return (
    <div className={`chat-conv-item${active ? ' active' : ''}`}>
      <button type="button" className="chat-conv-item-main" onClick={onClick}>
        <span className="chat-conv-item-title">{title}</span>
      </button>
      {onDelete ? (
        <button
          type="button"
          className="chat-conv-item-delete"
          aria-label={t('chat.activeConversation.deleteConversation', { title })}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <DeleteIcon size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function localizedConversationTitle(title: string, t: ReturnType<typeof useTranslation>['t']): string {
  return title === 'New conversation' ? t('chat.activeConversation.defaultTitle') : title;
}

interface MessageGroup {
  label: string;
  messages: ChatTimelineMessage[];
}

function groupMessagesByDay(messages: ChatTimelineMessage[], locale: string): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    const label = dayLabel(message.startedAt ?? message.createdAt ?? Date.now(), locale);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.messages.push(message);
    } else {
      groups.push({ label, messages: [message] });
    }
  }

  return groups;
}

function dayLabel(timestamp: number, locale: string): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function messageTimeLabel(message: ChatTimelineMessage, t: TranslateFn): string {
  const timestamp = message.endedAt ?? message.startedAt ?? message.createdAt ?? Date.now();
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return t('dashboard.time.justNow');
  if (elapsedMinutes < 60) return t('dashboard.time.minutesAgo', { count: elapsedMinutes });
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t('dashboard.time.hoursAgo', { count: elapsedHours });
  return t('dashboard.time.daysAgo', { count: Math.floor(elapsedHours / 24) });
}

function stableInputKey(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function isStreamingPhase(phase: ChatTimelineSnapshot['phase']): boolean {
  return (
    phase === 'queued' ||
    phase === 'initializing' ||
    phase === 'requesting' ||
    phase === 'thinking' ||
    phase === 'working' ||
    phase === 'streaming'
  );
}

function filterSnapshotDesignFileBlocks(
  snapshot: ChatTimelineSnapshot,
  designFiles: WorkspaceFile[],
): ChatTimelineSnapshot {
  let changed = false;
  const messages = snapshot.messages.map((message) => {
    if (message.role !== 'assistant' || message.blocks.length === 0) return message;

    const blocks = filterDesignFileBlocks(message.blocks, designFiles);
    if (blocks === message.blocks) return message;

    changed = true;
    return { ...message, blocks };
  });

  return changed ? { ...snapshot, messages } : snapshot;
}

function filterDesignFileBlocks(blocks: MessageBlock[], designFiles: WorkspaceFile[]): MessageBlock[] {
  let changed = false;
  const nextBlocks: MessageBlock[] = [];

  for (const block of blocks) {
    if (block.kind === 'generated-files') {
      const files = block.files.filter((file) => pathExistsInDesignFiles(file.name, designFiles));
      const filtered = files.length !== block.files.length;
      if (filtered) changed = true;
      if (files.length > 0) nextBlocks.push(filtered ? { ...block, files } : block);
      continue;
    }

    if (block.kind === 'file-ops') {
      const ops = block.ops.filter(
        (op) => pathExistsInDesignFiles(op.fullPath, designFiles) || pathExistsInDesignFiles(op.path, designFiles),
      );
      const filtered = ops.length !== block.ops.length;
      if (filtered) changed = true;
      if (ops.length > 0) nextBlocks.push(filtered ? { ...block, ops } : block);
      continue;
    }

    nextBlocks.push(block);
  }

  return changed ? nextBlocks : blocks;
}

function pathExistsInDesignFiles(path: string, designFiles: WorkspaceFile[]): boolean {
  const normalizedPath = normalizeDesignFilePath(path);
  if (!normalizedPath) return false;

  return designFiles.some((file) => {
    const filePath = normalizeDesignFilePath(file.path);
    const fileName = normalizeDesignFilePath(file.name);

    return (
      normalizedPath === filePath ||
      normalizedPath === fileName ||
      (filePath.length > 0 && normalizedPath.endsWith(`/${filePath}`)) ||
      (fileName.length > 0 && normalizedPath.endsWith(`/${fileName}`))
    );
  });
}

function normalizeDesignFilePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
}
