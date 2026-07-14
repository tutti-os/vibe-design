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
import type {
  AgentAvailability as ChatComposerAgentAvailability,
  AgentModelCatalogEntry as ChatComposerAgentModelCatalogEntry,
  AgentModelOption as ChatComposerModelOption,
} from '../services/agent-catalog/agent-catalog-types';
import { normalizeLegacyProviderId } from '../services/agent-catalog/agent-catalog-types';
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

type AgentTargetId = string;

type ModelProviderEntry = {
  value: ComposerModelProvider;
  providerId: ComposerModelProvider;
  label: string;
  comingSoon?: boolean;
};

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
  lockedAgentTargetId?: AgentTargetId | null;
  unresolvedAgentTargetLock?: boolean;
  lockedModel?: string | null;
  onOpenDesignSystemPicker?(): void | Promise<void>;
  onSelectDesignSystem?(designSystemId: string | null): void | Promise<void>;
  onAgentChange?(agentTargetId: AgentTargetId, label: string): void;
  onDraftChange?(draft: string): void;
  onSend(input: {
    draft: string;
    files: File[];
    attachments?: ChatAttachment[];
    agentTargetId: AgentTargetId;
    model?: string;
    commentAttachments?: CanvasCommentAttachment[];
  }): void | Promise<void>;
  onStop(): void | Promise<void>;
}

export type {
  ChatComposerAgentAvailability,
  ChatComposerAgentModelCatalogEntry,
  ChatComposerModelOption,
};

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
    lockedAgentTargetId = null,
    unresolvedAgentTargetLock = false,
    lockedModel = null,
    onOpenDesignSystemPicker,
    onSelectDesignSystem,
    onAgentChange,
    onDraftChange,
    onSend,
    onStop,
  }, ref) {
    const { t } = useTranslation();
    const [uncontrolledDraft, setUncontrolledDraft] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [uploadedAttachments, setUploadedAttachments] = useState<ChatAttachment[]>([]);
    const [modelProvider, setModelProvider] = useState<string>(() => (
      unresolvedAgentTargetLock
      ? ''
      : lockedAgentTargetId?.trim()
      || agentModelCatalog.find((entry) => entry.isDefault && entry.supported)?.agentTargetId
      || agentModelCatalog.find((entry) => entry.supported)?.agentTargetId
      || ''
    ));
    const [selectedModelsByProvider, setSelectedModelsByProvider] = useState<Partial<Record<string, string>>>({});
    const [sendPending, setSendPending] = useState(false);
    const [stopPending, setStopPending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [designSystemDialogOpen, setDesignSystemDialogOpen] = useState(false);
    const [draftDesignSystemId, setDraftDesignSystemId] = useState<string | null>(null);
    const [selectingDesignSystemId, setSelectingDesignSystemId] = useState<string | null>(null);
    const [designSystemSelectionError, setDesignSystemSelectionError] = useState<string | null>(null);
    const promptInputRef = useRef<PromptInputHandle | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const draft = controlledDraft ?? uncontrolledDraft;
    const hasCommentAttachments = commentAttachments.length > 0;
    const activeModelProviders = useMemo<ModelProviderEntry[]>(() => {
      return agentModelCatalog.map((entry) => ({
        value: entry.agentTargetId,
        providerId: normalizeComposerIconProvider(entry.providerId),
        label: entry.label,
      }));
    }, [agentModelCatalog]);
    const modelProviders = activeModelProviders;
    const activeModelProviderIds = useMemo(
      () => new Set(activeModelProviders.map((provider) => provider.value)),
      [activeModelProviders],
    );
    const lockedModelProvider = lockedAgentTargetId?.trim() || null;
    const providerLocked = lockedModelProvider !== null || unresolvedAgentTargetLock;
    const selectedProviderUnavailableReason = unavailableReasonForProvider(modelProvider, agentAvailability);
    const selectedModelOptions = modelOptionsForProvider(modelProvider, agentModelCatalog);
    const selectedModel = selectedModelForProvider(modelProvider, selectedModelsByProvider, agentModelCatalog);
    const selectedProviderLabel =
      modelProviders.find((provider) => provider.value === modelProvider)?.label ?? modelProvider;
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
    const canSend =
      hasSendableInput &&
      !sendPending &&
      !unresolvedAgentTargetLock &&
      activeModelProviderIds.has(modelProvider) &&
      !selectedProviderUnavailableReason;

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
      if (unresolvedAgentTargetLock) {
        setModelProvider('');
        return;
      }
      if (lockedModelProvider) {
        setModelProvider(lockedModelProvider);
      }
    }, [lockedModelProvider, unresolvedAgentTargetLock]);

    useEffect(() => {
      if (!lockedModelProvider || !lockedModel) return;
      const composerModel = normalizeLockedComposerModel(
        lockedModelProvider,
        lockedModel,
        agentModelCatalog,
      );
      setSelectedModelsByProvider((current) => {
        if (current[lockedModelProvider] === composerModel) return current;
        return {
          ...current,
          [lockedModelProvider]: composerModel,
        };
      });
    }, [agentModelCatalog, lockedModel, lockedModelProvider]);

    useEffect(() => {
      if (providerLocked) return;
      // Once the user has chosen an exact target, preserve that identity across
      // catalog refreshes. A missing or newly unavailable target must disable
      // send until the user explicitly selects another target.
      if (modelProvider) return;
      if (activeModelProviders.length === 0) return;
      const defaultTargetId = agentModelCatalog.find((entry) => entry.isDefault)?.agentTargetId;
      const preferred = activeModelProviders.find(
        (provider) => provider.value === defaultTargetId
          && !unavailableReasonForProvider(provider.value, agentAvailability),
      ) ?? activeModelProviders.find((provider) => !unavailableReasonForProvider(provider.value, agentAvailability))
        ?? activeModelProviders[0];
      if (preferred && preferred.value !== modelProvider) {
        setModelProvider(preferred.value);
      }
    }, [activeModelProviders, agentAvailability, agentModelCatalog, modelProvider, providerLocked]);

    useEffect(() => {
      const label = modelProviders.find((provider) => provider.value === modelProvider)?.label ?? modelProvider;
      onAgentChange?.(modelProvider, label);
    }, [modelProvider, modelProviders, onAgentChange]);

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
          agentTargetId: modelProvider,
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
      if (activeModelProviderIds.has(value)) {
        if (unavailableReasonForProvider(value, agentAvailability)) return;
        setModelProvider(value);
      }
    }

    function selectProviderModel(provider: string, modelId: string): void {
      if (providerLocked && provider !== lockedModelProvider) return;
      if (unavailableReasonForProvider(provider, agentAvailability)) return;
      const providerModels = modelOptionsForProvider(provider, agentModelCatalog);
      if (!providerModels.some((model) => model.id === modelId)) return;
      setModelProvider(provider);
      setSelectedModelsByProvider((current) => ({
        ...current,
        [provider]: modelId,
      }));
    }

    function renderModelProviderMenuEntry(provider: ModelProviderEntry): React.ReactNode {
      const isLockedOption = providerLocked && provider.value !== lockedModelProvider;
      const availability = availabilityForProvider(provider.value, agentAvailability);
      const unavailableReason = unavailableReasonForAvailability(availability);
      const disabledReason = provider.comingSoon
        ? t('chat.composer.comingSoon')
        : isLockedOption ? t('chat.composer.lockedModelProvider') : unavailableReason;
      const providerDisabled = provider.comingSoon || isLockedOption || Boolean(unavailableReason);
      if (!activeModelProviderIds.has(provider.value)) {
        return renderDisabledModelProviderEntry(provider, disabledReason ?? t('chat.composer.comingSoon'));
      }

      const activeProvider = provider.value;
      const providerModels = modelOptionsForProvider(activeProvider, agentModelCatalog);

      if (providerDisabled) {
        return renderDisabledModelProviderEntry(provider, disabledReason ?? null);
      }

      if (providerModels.length === 0) {
        return (
          <DropdownMenuItem
            className="composer-model-menu-item"
            data-provider-option={provider.value}
            key={provider.value}
            onSelect={() => updateModelProvider(provider.value)}
          >
            <ComposerModelProviderIcon provider={provider.providerId} />
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
            <ComposerModelProviderIcon provider={provider.providerId} />
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
      provider: ModelProviderEntry,
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
          <ComposerModelProviderIcon provider={provider.providerId} />
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
                groups={modelProviders.flatMap((p): ComposerModelGroup[] => {
                  if (!activeModelProviderIds.has(p.value)) return [];
                  if (p.comingSoon) return [];
                  if (unavailableReasonForProvider(p.value, agentAvailability)) return [];
                  if (providerLocked && p.value !== lockedModelProvider) return [];
                  return [{
                    provider: p.value,
                    iconProvider: p.providerId,
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
                selectedIconProvider={modelProviders.find((provider) => provider.value === modelProvider)?.providerId}
                selectedProviderLabel={selectedProviderLabel}
                selectedModelLabel={selectedModelLabel}
                menuClassName="composer-model-menu-content"
                onSelect={(provider, modelId) => {
                  if (modelId) {
                    selectProviderModel(provider, modelId);
                  } else {
                    updateModelProvider(provider);
                  }
                }}
                additionalItems={modelProviders
                  .filter((p) =>
                    !activeModelProviderIds.has(p.value) ||
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

function normalizeLockedComposerModel(
  provider: string,
  model: string,
  catalog: ChatComposerAgentModelCatalogEntry[],
): string {
  const options = modelOptionsForProvider(provider, catalog);
  if (options.some((option) => option.id === model)) {
    return model;
  }
  const modelProviderId = catalog.find((entry) => entry.agentTargetId === provider)?.providerId?.trim()
    || provider;
  const separatorIndex = model.indexOf(':');
  const prefixedProviderId = separatorIndex > 0 ? model.slice(0, separatorIndex) : '';
  if (
    prefixedProviderId
    && normalizeLegacyProviderId(prefixedProviderId) === normalizeLegacyProviderId(modelProviderId)
  ) {
    const stripped = model.slice(separatorIndex + 1);
    if (options.some((option) => option.id === stripped)) {
      return stripped;
    }
  }
  return model;
}

function normalizeComposerIconProvider(providerId: string | undefined): string {
  const normalized = providerId?.trim() ?? '';
  return normalized === 'claude' ? 'claude-code' : normalized;
}

function modelOptionsForProvider(
  provider: string,
  catalog: ChatComposerAgentModelCatalogEntry[],
): ChatComposerModelOption[] {
  return catalog.find((entry) => entry.agentTargetId === provider)?.models ?? [];
}

function selectedModelForProvider(
  provider: string,
  selectedModelsByProvider: Partial<Record<string, string>>,
  catalog: ChatComposerAgentModelCatalogEntry[],
): string | null {
  const options = modelOptionsForProvider(provider, catalog);
  if (options.length === 0) return null;

  const current = selectedModelsByProvider[provider];
  if (current && options.some((model) => model.id === current)) {
    return current;
  }

  return options.find((model) => model.id === 'default')?.id ?? options[0]?.id ?? null;
}

function unavailableReasonForProvider(
  provider: string,
  agentAvailability: ChatComposerAgentAvailability[],
): string | null {
  return unavailableReasonForAvailability(availabilityForProvider(provider, agentAvailability));
}

function availabilityForProvider(
  provider: string,
  agentAvailability: ChatComposerAgentAvailability[],
): ChatComposerAgentAvailability | null {
  return agentAvailability.find((candidate) => candidate.agentTargetId === provider) ?? null;
}

function unavailableReasonForAvailability(agent: ChatComposerAgentAvailability | null): string | null {
  if (!agent) return 'This agent is not available from Tutti.';
  return !agent.supported ? agent.unavailableReason ?? `${agent.label} is unavailable.` : null;
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
