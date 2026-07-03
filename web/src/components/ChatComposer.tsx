import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AtSign, Square } from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenuItem,
  DropdownMenuLabel,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tutti-os/ui-system/components';
import {
  CheckIcon,
  CloseIcon,
  FileTextIcon,
  ImageFileIcon,
  UploadIcon,
} from '@tutti-os/ui-system/icons';
import type {
  ContextPickerSnapshot,
  ContextSearchResultItem,
} from '../services/context-picker/context-picker-types';
import type { CanvasCommentAttachment, ChatAttachment } from '../types';
import { useTranslation } from '../i18n';
import { DesignSystemPickerDialog } from './DesignSystemPickerDialog';
import {
  ComposerDesignSystemTrigger,
  ComposerIconButton,
  ComposerModelPicker,
  ComposerModelProviderIcon,
  ComposerSendButton,
  type ComposerModelGroup,
  type ComposerModelProvider,
} from './ComposerControls';
import { PromptInput, type PromptInputHandle } from './PromptInput';

type ActiveModelProvider = 'codex' | 'claude-code';
type ModelProvider = ComposerModelProvider;
type AgentId = 'codex' | 'claude';

const MODEL_PROVIDERS: Array<{ value: ModelProvider; label: string; comingSoon?: boolean }> = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'tutti', label: 'Tutti', comingSoon: true },
  { value: 'hermes', label: 'Hermes', comingSoon: true },
  { value: 'openclaw', label: 'OpenClaw', comingSoon: true },
];

const ACTIVE_MODEL_PROVIDERS = new Set<ModelProvider>(['codex', 'claude-code']);

export interface ChatComposerProps {
  streaming: boolean;
  draft?: string;
  context: {
    search(query: string): Promise<{ items: ContextSearchResultItem[] }>;
    selectResult(item: ContextSearchResultItem): void | Promise<void>;
    removeSelection?(kind: ContextSearchResultItem['kind'], id: string): void;
    snapshot: ContextPickerSnapshot;
  };
  activeDesignSystem?: ChatComposerDesignSystem | null;
  designSystems?: ChatComposerDesignSystem[];
  designSystemPickerState?: ChatComposerDesignSystemPickerState;
  designSystemPickerError?: string | null;
  commentAttachments?: CanvasCommentAttachment[];
  agentAvailability?: ChatComposerAgentAvailability[];
  agentModelCatalog?: ChatComposerAgentModelCatalogEntry[];
  lockedAgentId?: AgentId | null;
  lockedModel?: string | null;
  onOpenDesignSystemPicker?(): void | Promise<void>;
  onSelectDesignSystem?(designSystemId: string | null): void | Promise<void>;
  onInstallAgent?(agentId: AgentId): void | Promise<void>;
  onAgentChange?(agentId: AgentId, label: string): void;
  onDraftChange?(draft: string): void;
  onSend(input: {
    draft: string;
    files: File[];
    attachments?: ChatAttachment[];
    agentId: AgentId;
    model?: string;
    commentAttachments?: CanvasCommentAttachment[];
  }): void | Promise<void>;
  onStop(): void | Promise<void>;
}

export interface ChatComposerAgentAvailability {
  id: string;
  label: string;
  available: boolean;
  authState?: 'ok' | 'missing' | 'expired' | 'unknown';
  supported?: boolean;
  unavailableReason?: string;
}

export interface ChatComposerModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChatComposerAgentModelCatalogEntry {
  agentId: AgentId;
  label: string;
  models: ChatComposerModelOption[];
}

export interface ChatComposerDesignSystem {
  id: string;
  title: string;
  category: string;
  summary: string;
  swatches: string[];
}

export type ChatComposerDesignSystemPickerState = 'idle' | 'loading' | 'ready' | 'error';

export interface ChatComposerHandle {
  setDraft(text: string, options?: { attachments?: ChatAttachment[] }): void;
  focus(): void;
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer({
    streaming,
    draft: controlledDraft,
    context,
    activeDesignSystem = null,
    designSystems = [],
    designSystemPickerState = 'idle',
    designSystemPickerError = null,
    commentAttachments = [],
    agentAvailability = [],
    agentModelCatalog = [],
    lockedAgentId = null,
    lockedModel = null,
    onOpenDesignSystemPicker,
    onSelectDesignSystem,
    onInstallAgent,
    onAgentChange,
    onDraftChange,
    onSend,
    onStop,
  }, ref) {
    const { t } = useTranslation();
    const [uncontrolledDraft, setUncontrolledDraft] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [uploadedAttachments, setUploadedAttachments] = useState<ChatAttachment[]>([]);
    const [modelProvider, setModelProvider] = useState<ModelProvider>('codex');
    const [selectedModelsByProvider, setSelectedModelsByProvider] = useState<Partial<Record<ActiveModelProvider, string>>>({});
    const [sendPending, setSendPending] = useState(false);
    const [stopPending, setStopPending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [designSystemDialogOpen, setDesignSystemDialogOpen] = useState(false);
    const [draftDesignSystemId, setDraftDesignSystemId] = useState<string | null>(null);
    const [selectingDesignSystemId, setSelectingDesignSystemId] = useState<string | null>(null);
    const [designSystemSelectionError, setDesignSystemSelectionError] = useState<string | null>(null);
    const [installingAgentId, setInstallingAgentId] = useState<AgentId | null>(null);
    const [agentInstallMessage, setAgentInstallMessage] = useState<string | null>(null);
    const promptInputRef = useRef<PromptInputHandle | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const draft = controlledDraft ?? uncontrolledDraft;
    const hasCommentAttachments = commentAttachments.length > 0;
    const lockedModelProvider = lockedAgentId ? modelProviderFromAgentId(lockedAgentId) : null;
    const providerLocked = lockedModelProvider !== null;
    const selectedProviderUnavailableReason = unavailableReasonForProvider(modelProvider, agentAvailability);
    const selectedModelOptions = modelOptionsForProvider(modelProvider, agentModelCatalog);
    const selectedModel = selectedModelForProvider(modelProvider, selectedModelsByProvider, agentModelCatalog);
    const selectedProviderLabel =
      MODEL_PROVIDERS.find((provider) => provider.value === modelProvider)?.label ?? 'Codex';
    const selectedModelLabel =
      selectedModelOptions.find((model) => model.id === selectedModel)?.label ?? null;
    const hasSelectedContext =
      context.snapshot.selectedSkills.length > 0 || context.snapshot.selectedDesignFiles.length > 0;
    const hasSendableInput =
      draft.trim().length > 0 ||
      files.length > 0 ||
      uploadedAttachments.length > 0 ||
      hasCommentAttachments ||
      hasSelectedContext;
    // A run is active and the user has not staged a new turn: offer to interrupt
    // instead of showing an inert spinner. With new input staged the button stays
    // a send action so the turn can be queued.
    const canInterrupt = streaming && !hasSendableInput && !sendPending;
    const canSend = hasSendableInput && !sendPending && !selectedProviderUnavailableReason;

    useImperativeHandle(
      ref,
      () => ({
        setDraft(text: string, options?: { attachments?: ChatAttachment[] }) {
          updateDraft(text);
          if (options && 'attachments' in options) {
            setUploadedAttachments(options.attachments ?? []);
          }
          requestAnimationFrame(() => {
            promptInputRef.current?.focusToEnd();
          });
        },
        focus() {
          promptInputRef.current?.focus();
        },
      }),
      [draft],
    );

    useEffect(() => {
      if (lockedModelProvider) {
        setModelProvider(lockedModelProvider);
      }
    }, [lockedModelProvider]);

    useEffect(() => {
      if (!lockedModelProvider || !lockedModel) return;
      setSelectedModelsByProvider((current) => {
        if (current[lockedModelProvider] === lockedModel) return current;
        return {
          ...current,
          [lockedModelProvider]: lockedModel,
        };
      });
    }, [lockedModel, lockedModelProvider]);

    useEffect(() => {
      const agentId = agentIdFromModelProvider(modelProvider);
      const label = MODEL_PROVIDERS.find((provider) => provider.value === modelProvider)?.label ?? 'Codex';
      onAgentChange?.(agentId, label);
    }, [modelProvider, onAgentChange]);

    const selectedChips = useMemo(
      () => [
        ...context.snapshot.selectedSkills.map((skill) => ({
          id: `skill:${skill.id}`,
          kind: 'skill' as const,
          value: skill.id,
          label: skill.name,
        })),
        ...context.snapshot.selectedDesignFiles.map((file) => ({
          id: `design-file:${selectedDesignFileValue(file)}`,
          kind: 'design-file' as const,
          value: selectedDesignFileValue(file),
          label: file.name,
        })),
      ],
      [context.snapshot.selectedDesignFiles, context.snapshot.selectedSkills],
    );
    function updateDraft(value: string): void {
      if (controlledDraft === undefined) {
        setUncontrolledDraft(value);
      }
      onDraftChange?.(value);
      setSendError(null);
    }

    async function submit(): Promise<void> {
      if (!canSend) return;
      const sentContextChips = selectedChips;
      setSendPending(true);
      setSendError(null);
      try {
        await onSend({
          draft: draft.trim(),
          files,
          ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
          agentId: agentIdFromModelProvider(modelProvider),
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(hasCommentAttachments ? { commentAttachments } : {}),
        });
        updateDraft('');
        setFiles([]);
        setUploadedAttachments([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        for (const chip of sentContextChips) {
          context.removeSelection?.(chip.kind, chip.value);
        }
      } catch (error) {
        setSendError(readSendErrorMessage(error, t('chat.composer.messageSendFailed')));
      } finally {
        setSendPending(false);
      }
    }

    async function interrupt(): Promise<void> {
      if (stopPending) return;
      setStopPending(true);
      setSendError(null);
      try {
        await onStop();
      } catch (error) {
        setSendError(readSendErrorMessage(error, t('chat.composer.stopRunFailed')));
      } finally {
        setStopPending(false);
      }
    }

    function insertMentionTrigger(): void {
      promptInputRef.current?.insertText('@');
    }

    function focusPromptFromInputLayer(event: React.MouseEvent<HTMLDivElement>): void {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest('[role="textbox"]')) {
        return;
      }

      event.preventDefault();
      promptInputRef.current?.focus();
    }

    function updateModelProvider(value: string): void {
      if (providerLocked) return;
      if (isActiveModelProvider(value)) {
        if (unavailableReasonForProvider(value, agentAvailability)) return;
        setAgentInstallMessage(null);
        setModelProvider(value);
      }
    }

    function selectProviderModel(provider: ActiveModelProvider, modelId: string): void {
      if (providerLocked && provider !== lockedModelProvider) return;
      if (unavailableReasonForProvider(provider, agentAvailability)) return;
      const providerModels = modelOptionsForProvider(provider, agentModelCatalog);
      if (!providerModels.some((model) => model.id === modelId)) return;
      setAgentInstallMessage(null);
      setModelProvider(provider);
      setSelectedModelsByProvider((current) => ({
        ...current,
        [provider]: modelId,
      }));
    }

    function renderModelProviderMenuEntry(provider: (typeof MODEL_PROVIDERS)[number]): React.ReactNode {
      const isLockedOption = providerLocked && provider.value !== lockedModelProvider;
      const availability = availabilityForProvider(provider.value, agentAvailability);
      const unavailableReason = unavailableReasonForAvailability(availability);
      const disabledReason = provider.comingSoon
        ? t('chat.composer.comingSoon')
        : isLockedOption ? t('chat.composer.lockedModelProvider') : unavailableReason;
      const providerDisabled = provider.comingSoon || isLockedOption || Boolean(unavailableReason);
      const showInstallAction =
        provider.value === 'claude-code' &&
        Boolean(unavailableReason) &&
        !isLockedOption &&
        Boolean(onInstallAgent) &&
        canInstallUnavailableAgent(availability);

      if (!isActiveModelProvider(provider.value)) {
        return renderDisabledModelProviderEntry(provider, disabledReason ?? t('chat.composer.comingSoon'));
      }

      const activeProvider = provider.value;
      const providerModels = modelOptionsForProvider(activeProvider, agentModelCatalog);

      if (providerDisabled) {
        const disabledEntry = renderDisabledModelProviderEntry(provider, disabledReason ?? null);
        if (!showInstallAction) return disabledEntry;

        return (
          <React.Fragment key={provider.value}>
            {disabledEntry}
            <div className="composer-model-install-row">
              <Button
                type="button"
                className="composer-model-install-button"
                variant="secondary"
                size="sm"
                aria-label={t('chat.composer.installAgent', { name: provider.label })}
                disabled={installingAgentId !== null}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void installAgent(agentIdFromModelProvider(activeProvider), provider.label);
                }}
              >
                {installingAgentId === agentIdFromModelProvider(activeProvider)
                  ? t('chat.composer.installing')
                  : t('chat.composer.install')}
              </Button>
            </div>
          </React.Fragment>
        );
      }

      if (providerModels.length === 0) {
        return (
          <DropdownMenuItem
            className="composer-model-menu-item"
            data-provider-option={provider.value}
            key={provider.value}
            onSelect={() => updateModelProvider(provider.value)}
          >
            <ComposerModelProviderIcon provider={provider.value} />
            <span>{provider.label}</span>
          </DropdownMenuItem>
        );
      }

      return (
        <React.Fragment key={provider.value}>
          <DropdownMenuLabel
            className="composer-model-provider-label"
            data-provider-option={provider.value}
          >
            <ComposerModelProviderIcon provider={provider.value} />
            <span>{provider.label}</span>
          </DropdownMenuLabel>
          <div className="composer-model-provider-models" data-provider-models={provider.value}>
            {providerModels.map((model) => {
              const activeModel =
                modelProvider === activeProvider &&
                selectedModelForProvider(activeProvider, selectedModelsByProvider, agentModelCatalog) === model.id;
              return (
                <DropdownMenuItem
                  className="composer-model-menu-item composer-model-menu-item--model"
                  data-model-option-id={model.id}
                  key={model.id}
                  onSelect={() => selectProviderModel(activeProvider, model.id)}
                >
                  <span className="composer-model-menu-check" aria-hidden>
                    {activeModel ? <CheckIcon size={12} /> : null}
                  </span>
                  <span className="composer-model-menu-option-text">
                    <span className="composer-model-menu-option-label">{model.label}</span>
                    {model.description ? (
                      <span className="composer-model-menu-option-description">{model.description}</span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        </React.Fragment>
      );
    }

    function renderDisabledModelProviderEntry(
      provider: (typeof MODEL_PROVIDERS)[number],
      disabledReason: string | null,
    ): React.ReactNode {
      const item = (
        <DropdownMenuItem
          className="composer-model-menu-item"
          data-provider-option={provider.value}
          disabled
          key={provider.value}
          title={provider.comingSoon ? disabledReason ?? undefined : undefined}
        >
          <ComposerModelProviderIcon provider={provider.value} />
          <span>{provider.label}</span>
        </DropdownMenuItem>
      );

      if (!disabledReason) return item;

      return (
        <Tooltip key={provider.value}>
          <TooltipTrigger asChild>
            <span className="composer-model-menu-tooltip-trigger">
              {item}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="center">
            {disabledReason}
          </TooltipContent>
        </Tooltip>
      );
    }

    async function installAgent(agentId: AgentId, label: string): Promise<void> {
      if (!onInstallAgent || installingAgentId !== null) return;
      setInstallingAgentId(agentId);
      setAgentInstallMessage(t('chat.composer.installingAgent', { name: label }));
      try {
        await onInstallAgent(agentId);
        setAgentInstallMessage(t('chat.composer.agentInstallSucceeded', { name: label }));
      } catch (error) {
        setAgentInstallMessage(readSendErrorMessage(error, t('chat.composer.agentInstallFailed', { name: label })));
      } finally {
        setInstallingAgentId(null);
      }
    }

    function updateDesignSystemDialog(open: boolean): void {
      setDesignSystemDialogOpen(open);
      if (open) {
        setDraftDesignSystemId(activeDesignSystem?.id ?? null);
        setDesignSystemSelectionError(null);
        void onOpenDesignSystemPicker?.();
      }
    }

    function stageDesignSystem(designSystemId: string | null): void {
      if (selectingDesignSystemId !== null) return;
      setDraftDesignSystemId(designSystemId);
      setDesignSystemSelectionError(null);
    }

    async function commitDesignSystem(): Promise<void> {
      if (selectingDesignSystemId !== null) return;
      if (draftDesignSystemId === (activeDesignSystem?.id ?? null)) {
        setDesignSystemDialogOpen(false);
        return;
      }
      if (!onSelectDesignSystem) return;
      setSelectingDesignSystemId(draftDesignSystemId);
      setDesignSystemSelectionError(null);
      try {
        await onSelectDesignSystem(draftDesignSystemId);
        setDesignSystemDialogOpen(false);
      } catch {
        setDesignSystemSelectionError(t('chat.composer.designSystemSelectionFailed'));
      } finally {
        setSelectingDesignSystemId(null);
      }
    }

    const pickerSelectedDesignSystem =
      (draftDesignSystemId
        ? designSystems.find((designSystem) => designSystem.id === draftDesignSystemId) ??
          (activeDesignSystem?.id === draftDesignSystemId ? activeDesignSystem : null)
        : null);
    const selectedDesignSystemLabel = activeDesignSystem?.title ?? t('dashboard.designSystem.title');
    function stageSelectedFiles(fileList: FileList | null): void {
      const selectedFiles = Array.from(fileList ?? []);
      if (selectedFiles.length === 0) return;

      setFiles((currentFiles) => [...currentFiles, ...selectedFiles]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }

    function stagePastedImages(event: ClipboardEvent): boolean {
      if (sendPending) {
        return false;
      }

      const pastedImages = imageFilesFromClipboardData(event.clipboardData);
      if (pastedImages.length === 0) {
        return false;
      }

      event.preventDefault();
      setFiles((currentFiles) => [...currentFiles, ...pastedImages]);
      setSendError(null);
      return true;
    }

    function removeStagedFile(index: number): void {
      setFiles((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }

    function removeUploadedAttachment(index: number): void {
      setUploadedAttachments((currentAttachments) =>
        currentAttachments.filter((_, attachmentIndex) => attachmentIndex !== index),
      );
    }

    return (
      <section className="composer" aria-label={t('chat.composer.chatComposer')}>
        {sendError ? (
          <span className="composer-hint" aria-live="polite">
            {sendError}
          </span>
        ) : null}
        {selectedProviderUnavailableReason ? (
          <span className="composer-hint" aria-live="polite">
            {selectedProviderUnavailableReason}
          </span>
        ) : null}
        {agentInstallMessage ? (
          <span className="composer-hint" aria-live="polite">
            {agentInstallMessage}
          </span>
        ) : null}

        <div className="composer-shell">
          <div className="chat-composer__topbar">
            <ComposerDesignSystemTrigger
              ariaLabel={t('chat.composer.chooseDesignSystem')}
              label={selectedDesignSystemLabel}
              onClick={() => updateDesignSystemDialog(true)}
            />
          </div>

          {selectedChips.length > 0 ? (
            <div className="chat-composer__chips" aria-label={t('chat.composer.selectedContext')}>
              {selectedChips.map((chip) => (
                <Badge key={chip.id} className="chat-composer__context-chip" variant="secondary">
                  {chip.label}
                  {context.removeSelection ? (
                    <Button
                      type="button"
                      className="chat-composer__context-remove"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('chat.composer.removeContext', { name: chip.label })}
                      onClick={() => context.removeSelection?.(chip.kind, chip.value)}
                    >
                      <CloseIcon size={10} aria-hidden />
                    </Button>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : null}

          {commentAttachments.length > 0 ? (
            <CommentAttachmentChips
              ariaLabel={t('chat.composer.stagedPreviewComments')}
              commentAttachments={commentAttachments}
            />
          ) : null}

          <div className="composer-input-wrap">
            {files.length > 0 || uploadedAttachments.length > 0 ? (
              <StagedInputAttachments
                files={files}
                uploadedAttachments={uploadedAttachments}
                onRemoveFile={removeStagedFile}
                onRemoveUploadedAttachment={removeUploadedAttachment}
              />
            ) : null}

            <div className="composer-textarea-layer" onMouseDown={focusPromptFromInputLayer}>
              <PromptInput
                ref={promptInputRef}
                ariaLabel={t('chat.composer.message')}
                className="chat-composer__textarea"
                disabled={sendPending}
                placeholder={t('chat.composer.placeholder')}
                value={draft}
                onChange={updateDraft}
                onEditorPaste={stagePastedImages}
                shouldSubmitOnEnter={(event) =>
                  !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
                }
                onSubmitShortcut={() => void submit()}
              />
            </div>
          </div>

          <div className="composer-row">
            <ComposerIconButton
              ariaLabel={t('chat.composer.openMentions')}
              title={t('chat.composer.openMentions')}
              onClick={insertMentionTrigger}
            >
              <AtSign size={14} aria-hidden />
            </ComposerIconButton>

            <input
              ref={fileInputRef}
              aria-label={t('chat.composer.importFiles')}
              disabled={sendPending}
              multiple
              type="file"
              onChange={(event) => stageSelectedFiles(event.currentTarget.files)}
            />
            <ComposerIconButton
              ariaLabel={t('chat.composer.attachFiles')}
              title={t('chat.composer.attachFiles')}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon size={14} />
            </ComposerIconButton>

            <span className="composer-spacer" />

            <TooltipProvider delayDuration={120}>
              <ComposerModelPicker
                ariaLabel={t('chat.composer.modelProvider')}
                groups={MODEL_PROVIDERS.flatMap((p): ComposerModelGroup[] => {
                  if (!isActiveModelProvider(p.value)) return [];
                  if (p.comingSoon) return [];
                  if (unavailableReasonForProvider(p.value, agentAvailability)) return [];
                  if (providerLocked && p.value !== lockedModelProvider) return [];
                  return [{
                    provider: p.value,
                    providerLabel: p.label,
                    models: modelOptionsForProvider(p.value, agentModelCatalog).map((m) => ({
                      id: m.id,
                      label: m.label,
                      ...(m.description ? { description: m.description } : {}),
                    })),
                  }];
                })}
                selectedKey={selectedModel ? `${modelProvider}:${selectedModel}` : modelProvider}
                selectedProvider={modelProvider}
                selectedProviderLabel={selectedProviderLabel}
                selectedModelLabel={selectedModelLabel}
                menuClassName="composer-model-menu-content"
                onSelect={(provider, modelId) => {
                  if (modelId) {
                    selectProviderModel(provider as ActiveModelProvider, modelId);
                  } else {
                    updateModelProvider(provider);
                  }
                }}
                additionalItems={MODEL_PROVIDERS
                  .filter((p) =>
                    !isActiveModelProvider(p.value) ||
                    p.comingSoon ||
                    Boolean(unavailableReasonForProvider(p.value, agentAvailability)) ||
                    (providerLocked && p.value !== lockedModelProvider)
                  )
                  .map((p) => renderModelProviderMenuEntry(p))}
              />
            </TooltipProvider>

            {sendPending ? (
              <ComposerSendButton
                ariaLabel={t('chat.composer.responseLoading')}
                disabled
                loading
              >
                {t('chat.composer.send')}
              </ComposerSendButton>
            ) : canInterrupt ? (
              <ComposerSendButton
                ariaLabel={t('chat.composer.stopRun')}
                title={t('chat.composer.stopRunTitle')}
                disabled={stopPending}
                loading={stopPending}
                stop
                onClick={() => void interrupt()}
              >
                <Square size={12} aria-hidden fill="currentColor" />
              </ComposerSendButton>
            ) : (
              <ComposerSendButton
                ariaLabel={t('chat.composer.sendMessage')}
                disabled={!canSend}
                onClick={() => void submit()}
              >
                {t('chat.composer.send')}
              </ComposerSendButton>
            )}
          </div>
        </div>

        <DesignSystemPickerDialog
          disabled={selectingDesignSystemId !== null}
          designSystems={designSystems}
          error={designSystemPickerError}
          loadState={designSystemPickerState}
          open={designSystemDialogOpen}
          selectedDesignSystem={pickerSelectedDesignSystem}
          selectionError={designSystemSelectionError}
          text={{
            allSelected: t('dashboard.designSystem.allSelected'),
            availableLabel: t('dashboard.designSystem.availableLabel'),
            availableListLabel: t('dashboard.designSystem.availableListLabel'),
            clearSelectionAria: (title: string) => t('dashboard.designSystem.clearSelectionAria', { title }),
            dialogDescription: t('dashboard.designSystem.dialogDescription'),
            dialogTitle: t('dashboard.designSystem.dialogTitle'),
            done: t('common.done'),
            emptySelected: t('dashboard.designSystem.emptySelected'),
            errorFallback: t('dashboard.designSystem.loadError'),
            importHint: t('dashboard.designSystem.importHint'),
            loading: t('common.loading'),
            selectAria: (title: string) => t('dashboard.designSystem.selectAria', { title }),
            selectedLabel: t('dashboard.designSystem.selectedLabel'),
            setupPrompt: t('dashboard.designSystem.setupPrompt'),
          }}
          onClearDesignSystem={() => stageDesignSystem(null)}
          onDone={() => void commitDesignSystem()}
          onOpenChange={updateDesignSystemDialog}
          onSelectDesignSystem={(designSystemId) => stageDesignSystem(designSystemId)}
        />
      </section>
    );
  },
);

function agentIdFromModelProvider(provider: ModelProvider): AgentId {
  return provider === 'claude-code' ? 'claude' : 'codex';
}

function modelProviderFromAgentId(agentId: AgentId): ActiveModelProvider {
  return agentId === 'claude' ? 'claude-code' : 'codex';
}

function isActiveModelProvider(value: string): value is ActiveModelProvider {
  return ACTIVE_MODEL_PROVIDERS.has(value as ModelProvider);
}

function modelOptionsForProvider(
  provider: ModelProvider,
  catalog: ChatComposerAgentModelCatalogEntry[],
): ChatComposerModelOption[] {
  if (!isActiveModelProvider(provider)) return [];
  const agentId = agentIdFromModelProvider(provider);
  return catalog.find((entry) => entry.agentId === agentId)?.models ?? [];
}

function selectedModelForProvider(
  provider: ModelProvider,
  selectedModelsByProvider: Partial<Record<ActiveModelProvider, string>>,
  catalog: ChatComposerAgentModelCatalogEntry[],
): string | null {
  if (!isActiveModelProvider(provider)) return null;
  const options = modelOptionsForProvider(provider, catalog);
  if (options.length === 0) return null;

  const current = selectedModelsByProvider[provider];
  if (current && options.some((model) => model.id === current)) {
    return current;
  }

  return options.find((model) => model.id === 'default')?.id ?? options[0]?.id ?? null;
}

function unavailableReasonForProvider(
  provider: ModelProvider,
  agentAvailability: ChatComposerAgentAvailability[],
): string | null {
  return unavailableReasonForAvailability(availabilityForProvider(provider, agentAvailability));
}

function availabilityForProvider(
  provider: ModelProvider,
  agentAvailability: ChatComposerAgentAvailability[],
): ChatComposerAgentAvailability | null {
  const agentId = agentIdFromModelProvider(provider);
  return agentAvailability.find((candidate) => candidate.id === agentId) ?? null;
}

function unavailableReasonForAvailability(agent: ChatComposerAgentAvailability | null): string | null {
  return agent && !agent.available ? agent.unavailableReason ?? `${agent.label} is unavailable.` : null;
}

function canInstallUnavailableAgent(agent: ChatComposerAgentAvailability | null): boolean {
  if (!agent || agent.available) return false;
  if (agent.supported === false) return true;
  if (agent.supported === true) return false;

  return agent.authState === undefined &&
    /not installed|not available on PATH/i.test(agent.unavailableReason ?? '');
}

function readSendErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function selectedDesignFileValue(file: ContextPickerSnapshot['selectedDesignFiles'][number]): string {
  return file.id ?? file.path ?? file.name;
}

function imageFilesFromClipboardData(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }

  if (clipboardData.items.length > 0) {
    return Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) {
        return [];
      }

      const file = item.getAsFile();
      return file ? [file] : [];
    });
  }

  return Array.from(clipboardData.files).filter((file) => file.type.startsWith('image/'));
}

function StagedInputAttachments({
  files,
  uploadedAttachments,
  onRemoveFile,
  onRemoveUploadedAttachment,
}: {
  files: File[];
  uploadedAttachments: ChatAttachment[];
  onRemoveFile(index: number): void;
  onRemoveUploadedAttachment(index: number): void;
}) {
  const { t } = useTranslation();

  return (
    <div className="chat-composer__input-attachments" aria-label={t('chat.composer.stagedInputAttachments')}>
      {files.map((file, index) => (
        <StagedLocalInputAttachment
          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
          file={file}
          onRemove={() => onRemoveFile(index)}
        />
      ))}
      {uploadedAttachments.map((attachment, index) => (
        <StagedUploadedInputAttachment
          key={`${attachment.path}-${index}`}
          attachment={attachment}
          onRemove={() => onRemoveUploadedAttachment(index)}
        />
      ))}
    </div>
  );
}

function StagedLocalInputAttachment({
  file,
  onRemove,
}: {
  file: File;
  onRemove(): void;
}) {
  const previewUrl = useImagePreviewUrl(file);

  return (
    <StagedInputAttachment
      name={file.name}
      isImage={file.type.startsWith('image/')}
      previewUrl={previewUrl}
      onRemove={onRemove}
    />
  );
}

function StagedUploadedInputAttachment({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove(): void;
}) {
  return (
    <StagedInputAttachment
      name={attachment.name}
      isImage={attachment.kind === 'image'}
      previewUrl={null}
      onRemove={onRemove}
    />
  );
}

function StagedInputAttachment({
  name,
  isImage,
  previewUrl,
  onRemove,
}: {
  name: string;
  isImage: boolean;
  previewUrl: string | null;
  onRemove(): void;
}) {
  const { t } = useTranslation();

  return (
    <div className={`chat-composer__attachment${isImage ? ' chat-composer__attachment--image' : ''}`}>
      <span className="chat-composer__attachment-preview" aria-hidden="true">
        {isImage && previewUrl ? (
          <img src={previewUrl} alt={name} />
        ) : isImage ? (
          <ImageFileIcon size={15} />
        ) : (
          <FileTextIcon size={15} />
        )}
      </span>
      <span className="chat-composer__attachment-name">{name}</span>
      <Button
        type="button"
        className="chat-composer__attachment-remove"
        size="icon-sm"
        variant="ghost"
        aria-label={t('chat.composer.removeAttachment', { name })}
        onClick={onRemove}
      >
        <CloseIcon size={12} aria-hidden />
      </Button>
    </div>
  );
}

function useImagePreviewUrl(file: File): string | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') {
      setPreviewUrl(null);
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [file]);

  return previewUrl;
}

function CommentAttachmentChips({
  ariaLabel,
  commentAttachments,
}: {
  ariaLabel: string;
  commentAttachments: CanvasCommentAttachment[];
}) {
  return (
    <div className="chat-composer__chips" aria-label={ariaLabel}>
      {commentAttachments.map((attachment) => (
        <Badge key={attachment.id} className="preview-comment-attachment-chip" variant="outline">
          <span>{attachment.selectionKind}</span>
          <span>{attachment.label || attachment.targetId}</span>
          <span>{attachment.filePath}</span>
        </Badge>
      ))}
    </div>
  );
}
