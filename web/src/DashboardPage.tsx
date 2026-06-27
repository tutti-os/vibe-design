import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmationDialog,
  Input,
} from '@tutti-os/ui-system';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@tutti-os/ui-system/components';
import {
  ChevronDownIcon,
  CloseIcon,
  DeleteIcon,
  MoreHorizontalIcon,
  SearchIcon,
  ToolsIcon,
  UploadIcon,
} from '@tutti-os/ui-system/icons';
import { AtSign } from 'lucide-react';
import { useService } from '@tutti-os/infra/di';
import React from 'react';
import {
  ComposerDesignSystemTrigger,
  ComposerIconButton,
  ComposerModelPicker,
  ComposerSendButton,
  type ComposerModelGroup,
  type ComposerModelProvider,
} from './components/ComposerControls';
import {
  extractMentionQuery,
  removeActiveMentionToken,
  replaceActiveMentionToken,
} from './components/composer-mention';
import {
  getTuttiExternalAtMentionIconUrl,
  getTuttiExternalAtMentionSubtitle,
  isTuttiExternalAtMentionItem,
  queryTuttiExternalAtMentions,
  renderTuttiExternalAtInsert,
  type TuttiExternalAtMentionItem,
} from './lib/tuttiExternalAt';
import { stashInitialProjectPrompt, stashInitialProjectSkills } from './initial-project-prompt';
import { DesignSystemPickerDialog } from './components/DesignSystemPickerDialog';
import { PromptInput, type PromptInputHandle } from './components/PromptInput';
import type { ChatComposerAgentModelCatalogEntry } from './components/ChatComposer';
import { useServiceSnapshot } from './hooks/use-service-snapshot';
import { IContextPickerService } from './services/context-picker/context-picker-service.interface';
import type {
  ContextPickerSnapshot,
  ContextSearchResultItem,
} from './services/context-picker/context-picker-types';
import { type TranslateFn, useTranslation } from './i18n';
import { IProjectService } from './services/projects/project-service.interface';

export interface DashboardProject {
  id: string;
  title: string;
  prompt: string;
  projectKind: string;
  createdAt: number;
  updatedAt: number;
  coverUrl?: string;
}

const EMPTY_DASHBOARD_PROJECTS: DashboardProject[] = [];
const DASHBOARD_MODEL_OPTIONS: DashboardModelOption[] = [
  {
    key: 'codex:default',
    provider: 'codex',
    agentId: 'codex',
    providerLabel: 'Codex',
    modelId: 'default',
    modelLabel: 'Default (CLI config)',
  },
  {
    key: 'claude-code:default',
    provider: 'claude-code',
    agentId: 'claude',
    providerLabel: 'Claude Code',
    modelId: 'default',
    modelLabel: 'Default (recommended)',
  },
];

type DashboardMentionItem = ContextSearchResultItem | TuttiExternalAtMentionItem;
type DashboardMentionFilter = 'all' | 'skill' | TuttiExternalAtMentionItem['kind'];
const DASHBOARD_MENTION_FILTERS: DashboardMentionFilter[] = ['all', 'skill', 'workspace-app'];

export function DashboardPage({
  openProject = openProjectInCurrentWindow,
  recentProjects = EMPTY_DASHBOARD_PROJECTS,
}: {
  openProject?: (projectId: string) => void;
  recentProjects?: DashboardProject[];
}) {
  const { locale, t } = useTranslation();
  const projectService = useService(IProjectService);
  const [projects, setProjects] = React.useState<DashboardProject[]>(recentProjects);
  const [selectedDesignSystemId, setSelectedDesignSystemId] = React.useState<string | null>(null);
  const [pendingDesignSystemId, setPendingDesignSystemId] = React.useState<string | null>(null);
  const [designSystems, setDesignSystems] = React.useState<DashboardDesignSystem[]>([]);
  const [designSystemsLocale, setDesignSystemsLocale] = React.useState<string | null>(null);
  const [designSystemLoadState, setDesignSystemLoadState] = React.useState<DesignSystemLoadState>('idle');
  const [designSystemError, setDesignSystemError] = React.useState<string | null>(null);
  const [designSystemDialogOpen, setDesignSystemDialogOpen] = React.useState(false);
  const designSystemLoadIdRef = React.useRef(0);
  const projectLoadIdRef = React.useRef(0);
  const selectedDesignSystem = designSystems.find((system) => system.id === selectedDesignSystemId) ?? null;
  const pendingDesignSystem = designSystems.find((system) => system.id === pendingDesignSystemId) ?? null;

  React.useEffect(() => {
    setProjects(recentProjects);
  }, [recentProjects]);

  React.useEffect(() => {
    function refreshWhenVisible(): void {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void loadProjects();
    }

    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  async function loadProjects(): Promise<void> {
    const loadId = projectLoadIdRef.current + 1;
    projectLoadIdRef.current = loadId;

    try {
      const response = await fetch('/api/projects');
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return;
      }

      const nextProjects = readDashboardProjects(data);
      if (projectLoadIdRef.current === loadId) {
        setProjects(nextProjects);
      }
    } catch {
      // Keep the server-rendered list if a background refresh fails.
    }
  }

  const loadDesignSystems = React.useCallback(async (): Promise<void> => {
    if (designSystemLoadState === 'loading') {
      return;
    }

    const loadId = designSystemLoadIdRef.current + 1;
    const requestedLocale = locale;
    designSystemLoadIdRef.current = loadId;
    setDesignSystemLoadState('loading');
    setDesignSystemError(null);

    try {
      const response = await fetch(`/api/design-systems?locale=${encodeURIComponent(locale)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readDesignSystemError(data, t('dashboard.designSystem.loadError')));
      }

      const nextSystems = readDesignSystems(data, t('dashboard.designSystem.cardFallbackCategory')).filter(
        (system) => system.source === 'built-in',
      );
      if (designSystemLoadIdRef.current !== loadId) {
        return;
      }

      setDesignSystems(nextSystems);
      setDesignSystemsLocale(requestedLocale);
      setDesignSystemLoadState('ready');
      setSelectedDesignSystemId((currentId) => {
        if (currentId && nextSystems.some((system) => system.id === currentId)) {
          return currentId;
        }
        return null;
      });
      setPendingDesignSystemId((currentId) => {
        if (currentId && nextSystems.some((system) => system.id === currentId)) {
          return currentId;
        }
        return null;
      });
    } catch (loadError) {
      if (designSystemLoadIdRef.current !== loadId) {
        return;
      }
      setDesignSystems([]);
      setDesignSystemsLocale(null);
      setSelectedDesignSystemId(null);
      setPendingDesignSystemId(null);
      setDesignSystemLoadState('error');
      setDesignSystemError(loadError instanceof Error ? loadError.message : t('dashboard.designSystem.loadError'));
    }
  }, [designSystemLoadState, locale, t]);

  React.useEffect(() => {
    if (!designSystemDialogOpen && !selectedDesignSystemId) {
      return;
    }

    if (designSystemLoadState === 'loading') {
      return;
    }

    if (designSystemLoadState === 'ready' && designSystemsLocale === locale) {
      return;
    }

    void loadDesignSystems();
  }, [
    designSystemDialogOpen,
    designSystemLoadState,
    designSystemsLocale,
    loadDesignSystems,
    locale,
    selectedDesignSystemId,
  ]);

  function openDesignSystemPicker(): void {
    setPendingDesignSystemId(selectedDesignSystemId);
    setDesignSystemDialogOpen(true);
    if (designSystemLoadState === 'idle' || designSystemLoadState === 'error' || designSystemsLocale !== locale) {
      void loadDesignSystems();
    }
  }

  function updateDesignSystemDialogOpen(open: boolean): void {
    setDesignSystemDialogOpen(open);
    if (!open) {
      setPendingDesignSystemId(selectedDesignSystemId);
    }
  }

  function commitPendingDesignSystem(): void {
    setSelectedDesignSystemId(pendingDesignSystemId);
    setDesignSystemDialogOpen(false);
  }

  return (
    <main className="min-h-screen overflow-y-auto bg-[var(--background)] text-[var(--foreground)]">
      <DashboardTopBar />
      <div className="mx-auto flex w-full max-w-[1560px] flex-col px-5 pb-10 pt-10 sm:px-8 2xl:px-12">
        <ProjectCreator
          openProject={openProject}
          designSystemId={selectedDesignSystemId}
          selectedDesignSystem={selectedDesignSystem}
          onSetupDesignSystem={openDesignSystemPicker}
        />
        <ProjectBrowser
          projects={projects}
          onDeleteProject={async (projectId) => {
            await projectService.deleteProject(projectId);
            setProjects((current) => current.filter((p) => p.id !== projectId));
          }}
        />
        <DashboardDesignSystemPicker
          designSystems={designSystems}
          error={designSystemError}
          loadState={designSystemLoadState}
          open={designSystemDialogOpen}
          selectedDesignSystem={pendingDesignSystem}
          onDone={commitPendingDesignSystem}
          onOpenChange={updateDesignSystemDialogOpen}
          onClearDesignSystem={() => setPendingDesignSystemId(null)}
          onSelectDesignSystem={setPendingDesignSystemId}
        />
      </div>
    </main>
  );
}

function DashboardTopBar() {
  return (
    <header className="border-b border-[var(--border-1)] bg-[var(--background)]">
      <div className="mx-auto flex h-14 w-full max-w-[1560px] items-center px-5 sm:px-8 2xl:px-12">
        <BrandHeader />
      </div>
    </header>
  );
}

function BrandHeader() {
  return (
    <div>
      <div className="flex items-center gap-3">
        <BrandGlyph />
        <div className="min-w-0">
          <h1 className="shrink-0 text-[20px] leading-6 tracking-normal text-[var(--text-primary)]">
            <span className="font-semibold">Prototype</span>{' '}
            <span className="font-semibold italic [font-family:var(--vd-font-serif)]">Design</span>
          </h1>
        </div>
      </div>
    </div>
  );
}
function BrandGlyph() {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="block size-8 shrink-0 object-contain"
      data-testid="brand-icon"
      draggable={false}
      src="/icon.png"
    />
  );
}

function ProjectCreator({
  designSystemId,
  openProject,
  selectedDesignSystem,
  onSetupDesignSystem,
}: {
  designSystemId: string | null;
  openProject: (projectId: string) => void;
  selectedDesignSystem: DashboardDesignSystem | null;
  onSetupDesignSystem: () => void;
}) {
  const { t } = useTranslation();
  const projectService = useService(IProjectService);
  const context = useService(IContextPickerService);
  const contextSnapshot = useServiceSnapshot<ContextPickerSnapshot>(context);
  const [projectPrompt, setProjectPrompt] = React.useState('');
  const [stagedImages, setStagedImages] = React.useState<File[]>([]);
  const [selectedModel, setSelectedModel] = React.useState<DashboardModelOption>(DASHBOARD_MODEL_OPTIONS[0]);
  const [agentModelCatalog, setAgentModelCatalog] = React.useState<ChatComposerAgentModelCatalogEntry[]>([]);
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionItems, setMentionItems] = React.useState<DashboardMentionItem[]>([]);
  const [mentionFilter, setMentionFilter] = React.useState<DashboardMentionFilter>('all');
  const [mentionPending, setMentionPending] = React.useState(false);
  const [mentionError, setMentionError] = React.useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = React.useState<{ top: number; left: number } | null>(null);
  const [selectingContextId, setSelectingContextId] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const promptInputRef = React.useRef<PromptInputHandle | null>(null);
  const modelCatalogRequestedRef = React.useRef(false);
  const createProjectInFlightRef = React.useRef(false);

  // The dashboard has no project yet, so project files are unavailable here.
  const selectedSkillChips = React.useMemo(
    () =>
      contextSnapshot.selectedSkills.map((skill) => ({
        id: `skill:${skill.id}`,
        value: skill.id,
        label: skill.name,
      })),
    [contextSnapshot.selectedSkills],
  );
  const filteredMentionItems = React.useMemo(
    () =>
      mentionFilter === 'all'
        ? mentionItems
        : mentionItems.filter((item) => item.kind === mentionFilter),
    [mentionFilter, mentionItems],
  );

  React.useEffect(() => {
    if (mentionQuery === null) {
      setMentionItems([]);
      setMentionFilter('all');
      setMentionPending(false);
      setMentionError(null);
      return;
    }

    let canceled = false;
    setMentionPending(true);
    setMentionError(null);
    void Promise.allSettled([
      context.search(mentionQuery),
      queryTuttiExternalAtMentions({ keyword: mentionQuery, maxResults: 20 }),
    ]).then(([contextResult, externalAtResult]) => {
      if (canceled) return;

      const skillItems =
        contextResult.status === 'fulfilled'
          ? contextResult.value.items.filter((item) => item.kind === 'skill')
          : [];
      const externalAtItems = externalAtResult.status === 'fulfilled' ? externalAtResult.value : [];

      setMentionItems([...skillItems, ...externalAtItems]);
      setMentionPending(false);
      setMentionError(
        contextResult.status === 'rejected' && externalAtItems.length === 0
          ? t('chat.composer.contextSearchUnavailable')
          : null,
      );
    });

    return () => {
      canceled = true;
    };
  }, [context, mentionQuery, t]);

  // Position the mention popover just beneath the caret (the active "@"),
  // measured relative to the composer form so it tracks where the user typed.
  function computeMentionAnchor(): { top: number; left: number } | null {
    if (typeof window === 'undefined') return null;
    const form = formRef.current;
    const selection = window.getSelection();
    if (!form || !selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    let rect = range.getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.left === 0 && rect.height === 0)) {
      const rects = range.getClientRects();
      rect = rects.length > 0 ? rects[0] : rect;
    }
    if (!rect) return null;

    const formRect = form.getBoundingClientRect();
    const menuWidth = Math.min(360, formRect.width);
    const left = Math.max(0, Math.min(rect.left - formRect.left, formRect.width - menuWidth));
    return { top: rect.bottom - formRect.top + 6, left };
  }

  function updatePrompt(value: string): void {
    setProjectPrompt(value);
    const query = extractMentionQuery(value);
    setMentionQuery(query);
    setMentionAnchor(query === null ? null : computeMentionAnchor());
  }

  function insertMentionTrigger(): void {
    promptInputRef.current?.insertText('@');
  }

  function submitPromptFromEditor(event: KeyboardEvent): boolean {
    if (!isPlainEnter(event)) {
      return false;
    }

    event.preventDefault();
    if (mentionQuery !== null && filteredMentionItems.length > 0) {
      void selectMention(filteredMentionItems[0]);
    } else {
      formRef.current?.requestSubmit();
    }
    return true;
  }

  async function selectMention(item: DashboardMentionItem): Promise<void> {
    if (selectingContextId !== null) return;
    setSelectingContextId(item.id);
    setMentionError(null);
    try {
      if (isTuttiExternalAtMentionItem(item)) {
        const insertedText = renderTuttiExternalAtInsert(item);
        if (!insertedText) {
          throw new Error('Empty at mention insert result');
        }
        updatePrompt(replaceActiveMentionToken(projectPrompt, insertedText));
        requestAnimationFrame(() => {
          promptInputRef.current?.focusToEnd();
        });
      } else {
        await context.selectResult(item);
        updatePrompt(removeActiveMentionToken(projectPrompt));
      }
      setMentionQuery(null);
      setMentionAnchor(null);
      setMentionItems([]);
      setMentionFilter('all');
    } catch {
      setMentionError(t('chat.composer.contextSelectionFailed'));
    } finally {
      setSelectingContextId(null);
    }
  }
  const modelOptions = React.useMemo(() => {
    const catalogOptions = dashboardModelOptionsFromCatalog(agentModelCatalog);
    return catalogOptions.length > 0 ? catalogOptions : DASHBOARD_MODEL_OPTIONS;
  }, [agentModelCatalog]);
  const canCreate = projectPrompt.trim().length > 0 && !isCreating;

  React.useEffect(() => {
    if (modelOptions.some((model) => model.key === selectedModel.key)) return;
    setSelectedModel(
      modelOptions.find((model) => model.provider === selectedModel.provider) ??
        modelOptions[0] ??
        DASHBOARD_MODEL_OPTIONS[0],
    );
  }, [modelOptions, selectedModel.key, selectedModel.provider]);

  async function createProject(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const formPrompt = formData.get('prompt');
    const formProjectKind = formData.get('projectKind');
    const nextPrompt = typeof formPrompt === 'string' ? formPrompt.trim() : '';
    if (!nextPrompt || createProjectInFlightRef.current) {
      return;
    }

    const selectedSkillIds = context.buildRunContext()?.skillIds ?? [];

    createProjectInFlightRef.current = true;
    setIsCreating(true);
    setError(null);
    try {
      const project = await projectService.createProject({
        title: t('dashboard.creator.untitledProjectTitle'),
        prompt: nextPrompt,
        projectKind: typeof formProjectKind === 'string' ? formProjectKind : 'prototype',
        ...(designSystemId ? { designSystemId } : {}),
        ...(shouldSendDashboardModel(selectedModel)
          ? { agentId: selectedModel.agentId, model: selectedModel.modelId }
          : {}),
      });
      await uploadDashboardImages(project.id, stagedImages);
      stashInitialProjectPrompt(project.id, nextPrompt);
      stashInitialProjectSkills(project.id, selectedSkillIds);
      setMentionQuery(null);
      setMentionAnchor(null);
      setStagedImages([]);
      // Clear the dashboard's skill selections so they don't leak into the next project.
      for (const skillId of selectedSkillIds) {
        context.removeSelection('skill', skillId);
      }
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
      openProject(project.id);
    } catch (projectError) {
      setError(projectError instanceof Error ? projectError.message : t('dashboard.creator.errorFallback'));
    } finally {
      createProjectInFlightRef.current = false;
      setIsCreating(false);
    }
  }

  function stageImages(fileList: FileList | null): void {
    const images = Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    setStagedImages((currentImages) => [...currentImages, ...images]);
    setError(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }

  function removeStagedImage(index: number): void {
    setStagedImages((currentImages) => currentImages.filter((_, imageIndex) => imageIndex !== index));
  }

  async function loadModelCatalog(): Promise<void> {
    if (modelCatalogRequestedRef.current || typeof fetch !== 'function') return;
    modelCatalogRequestedRef.current = true;
    setAgentModelCatalog(await fetchDashboardModelCatalog());
  }

  React.useEffect(() => {
    void loadModelCatalog();
  }, []);

  return (
    <section className="mx-auto flex w-full max-w-[700px] flex-col items-center text-center">
      <h2 className="text-[32px] font-semibold leading-tight tracking-normal text-[var(--text-primary)]">
        {t('dashboard.creator.heroTitle')}
      </h2>
      <form
        ref={formRef}
        className="relative mt-6 w-full"
        method="post"
        action="/projects"
        onSubmit={(event) => void createProject(event)}
      >
        <input type="hidden" name="projectKind" value="prototype" />
        {designSystemId ? <input type="hidden" name="designSystemId" value={designSystemId} /> : null}
        <Card className="rounded-[20px] border-[var(--border-1)] bg-[var(--background-fronted)] py-0 shadow-[0_14px_32px_rgba(15,23,42,0.10)] transition-colors focus-within:border-[var(--border-2)]">
          <CardContent className="px-4 pt-4 pb-0 text-left sm:px-5 sm:pt-5 sm:pb-0">
            <h3 className="sr-only">
              {t('dashboard.creator.title')}
            </h3>
            {selectedSkillChips.length > 0 ? (
              <div className="chat-composer__chips" aria-label={t('chat.composer.selectedContext')}>
                {selectedSkillChips.map((chip) => (
                  <Badge key={chip.id} className="chat-composer__context-chip" variant="secondary">
                    {chip.label}
                    <Button
                      type="button"
                      className="chat-composer__context-remove"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('chat.composer.removeContext', { name: chip.label })}
                      onClick={() => context.removeSelection('skill', chip.value)}
                    >
                      <CloseIcon size={10} aria-hidden />
                    </Button>
                  </Badge>
                ))}
              </div>
            ) : null}
            <PromptInput
              ref={promptInputRef}
              ariaLabel={t('dashboard.creator.projectNameLabel')}
              className="dashboard-prompt-input h-[112px] px-2 py-2"
              editorClassName="dashboard-prompt-input__editor h-[96px] overflow-y-auto text-sm font-normal leading-5 text-[var(--text-primary)]"
              name="prompt"
              placeholder={t('dashboard.creator.projectNamePlaceholder')}
              value={projectPrompt}
              onChange={updatePrompt}
              onEditorKeyDown={submitPromptFromEditor}
            />
            {stagedImages.length > 0 ? (
              <div
                aria-label={t('dashboard.creator.stagedImages')}
                className="mt-3 flex flex-wrap gap-2"
              >
                {stagedImages.map((image, index) => (
                  <DashboardStagedImage
                    key={`${image.name}-${image.lastModified}-${index}`}
                    file={image}
                    onRemove={() => removeStagedImage(index)}
                  />
                ))}
              </div>
            ) : null}
            {error ? <div className="mt-3 text-sm text-[var(--state-danger)]">{error}</div> : null}
            <div className="composer-row mt-5 flex-wrap" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
              <input
                ref={imageInputRef}
                aria-label={t('dashboard.creator.uploadImages')}
                accept="image/*"
                className="sr-only"
                multiple
                type="file"
                onChange={(event) => stageImages(event.currentTarget.files)}
              />
              <ComposerIconButton
                ariaLabel={t('dashboard.creator.chooseImages')}
                title={t('dashboard.creator.chooseImages')}
                onClick={() => imageInputRef.current?.click()}
              >
                <UploadIcon aria-hidden="true" size={16} />
              </ComposerIconButton>
              <ComposerIconButton
                ariaLabel={t('chat.composer.openMentions')}
                title={t('chat.composer.openMentions')}
                onClick={insertMentionTrigger}
              >
                <AtSign aria-hidden="true" size={16} />
              </ComposerIconButton>
              <DesignSystemPrompt selectedDesignSystem={selectedDesignSystem} onSetup={onSetupDesignSystem} />
              <span className="min-w-0 flex-1" />
              <ComposerModelPicker
                ariaLabel={t('dashboard.creator.modelLabel')}
                groups={groupDashboardModelOptions(modelOptions)}
                selectedKey={selectedModel.key}
                selectedProvider={selectedModel.provider}
                selectedProviderLabel={selectedModel.providerLabel}
                selectedModelLabel={selectedModel.modelLabel}
                onOpenMenu={() => void loadModelCatalog()}
                onSelect={(provider, modelId) => {
                  const option = modelOptions.find((m) => m.provider === provider && m.modelId === modelId);
                  if (option) setSelectedModel(option);
                }}
              />
              <ComposerSendButton
                ariaLabel={t('dashboard.creator.createAria')}
                disabled={!canCreate}
                loading={isCreating}
                onClick={() => formRef.current?.requestSubmit()}
              >
                {t('dashboard.creator.createAction')}
              </ComposerSendButton>
            </div>
          </CardContent>
        </Card>
        {mentionQuery !== null && (!mentionError || mentionItems.length > 0) ? (
          <div
            className="chat-composer__mention-list dashboard-mention-list"
            aria-label={t('chat.composer.mentionResults')}
            style={mentionAnchor ? { top: mentionAnchor.top, left: mentionAnchor.left, right: 'auto' } : undefined}
          >
            {mentionPending ? (
              <div className="chat-composer__mention-empty">{t('chat.composer.searchingContext')}</div>
            ) : mentionItems.length > 0 ? (
              <>
                <div className="chat-composer__mention-tabs" role="tablist" aria-label={t('chat.composer.mentionFilters')}>
                  {DASHBOARD_MENTION_FILTERS.map((filter) => (
                    <Button
                      key={filter}
                      type="button"
                      className="chat-composer__mention-tab"
                      role="tab"
                      aria-selected={mentionFilter === filter}
                      variant={mentionFilter === filter ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setMentionFilter(filter)}
                    >
                      {dashboardMentionFilterLabel(filter, t)}
                    </Button>
                  ))}
                </div>
                {filteredMentionItems.length > 0 ? (
                  filteredMentionItems.map((item) => (
                    <Button
                      className="chat-composer__mention-button"
                      key={item.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={selectingContextId !== null}
                      onClick={() => void selectMention(item)}
                    >
                      <DashboardMentionResultIcon item={item} />
                      <span>{item.label}</span>
                      {dashboardMentionItemSubtitle(item) ? (
                        <span className="chat-composer__meta">{dashboardMentionItemSubtitle(item)}</span>
                      ) : null}
                    </Button>
                  ))
                ) : (
                  <div className="chat-composer__mention-empty">{t('chat.composer.noContextResults')}</div>
                )}
              </>
            ) : (
              <div className="chat-composer__mention-empty">{t('chat.composer.noContextResults')}</div>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}

async function uploadDashboardImages(projectId: string, images: File[]): Promise<void> {
  if (images.length === 0) return;

  for (const image of images) {
    const formData = new FormData();
    formData.append('file', image);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Could not upload images.');
    }
  }
}

function dashboardMentionFilterLabel(
  filter: DashboardMentionFilter,
  t: TranslateFn,
): string {
  if (filter === 'skill') return t('chat.composer.mentionFilterSkills');
  if (filter === 'workspace-app') return t('chat.composer.mentionFilterApps');
  return t('chat.composer.mentionFilterAll');
}

function DashboardMentionResultIcon({ item }: { item: DashboardMentionItem }) {
  if (isTuttiExternalAtMentionItem(item)) {
    const iconUrl = getTuttiExternalAtMentionIconUrl(item);
    if (iconUrl) {
      return (
        <img
          alt=""
          className="chat-composer__mention-icon"
          data-mention-icon={item.kind}
          src={iconUrl}
        />
      );
    }
    return <ToolsIcon size={14} aria-hidden data-mention-icon={item.kind} />;
  }
  return <ToolsIcon size={14} aria-hidden data-mention-icon="skill" />;
}

function dashboardMentionItemSubtitle(item: DashboardMentionItem): string | null {
  if (isTuttiExternalAtMentionItem(item)) {
    return getTuttiExternalAtMentionSubtitle(item);
  }
  return null;
}

async function fetchDashboardModelCatalog(): Promise<ChatComposerAgentModelCatalogEntry[]> {
  const response = await fetch('/api/agents/models').catch(() => null);
  if (!response) return [];

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return [];
  }

  return readDashboardModelCatalog(data);
}

function readDashboardModelCatalog(data: unknown): ChatComposerAgentModelCatalogEntry[] {
  const value = isRecord(data) ? data.agents : null;
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item) || !isDashboardAgentId(item.id) || typeof item.label !== 'string' || !Array.isArray(item.models)) {
      return [];
    }

    const models = item.models.flatMap((model) => {
      if (!isRecord(model) || typeof model.id !== 'string' || typeof model.label !== 'string') {
        return [];
      }

      return [{
        id: model.id,
        label: model.label,
        ...(typeof model.description === 'string' && model.description.trim()
          ? { description: model.description }
          : {}),
      }];
    });

    return [{ agentId: item.id, label: item.label, models }];
  });
}

function dashboardModelOptionsFromCatalog(
  catalog: ChatComposerAgentModelCatalogEntry[],
): DashboardModelOption[] {
  return catalog.flatMap((entry) => {
    const provider = dashboardModelProviderFromAgentId(entry.agentId);
    if (!provider) return [];

    return entry.models.map((model) => ({
      key: `${provider}:${model.id}`,
      provider,
      agentId: entry.agentId,
      providerLabel: entry.label,
      modelId: model.id,
      modelLabel: model.label,
      ...(model.description ? { description: model.description } : {}),
    }));
  });
}

function groupDashboardModelOptions(modelOptions: DashboardModelOption[]): ComposerModelGroup[] {
  const groups: ComposerModelGroup[] = [];

  for (const model of modelOptions) {
    const group = groups.find((g) => g.provider === model.provider);
    if (group) {
      group.models.push({
        id: model.modelId,
        label: model.modelLabel,
        ...(model.description ? { description: model.description } : {}),
      });
      continue;
    }

    groups.push({
      provider: model.provider,
      providerLabel: model.providerLabel,
      models: [{
        id: model.modelId,
        label: model.modelLabel,
        ...(model.description ? { description: model.description } : {}),
      }],
    });
  }

  return groups;
}

function dashboardModelProviderFromAgentId(agentId: 'codex' | 'claude'): ComposerModelProvider | null {
  if (agentId === 'codex') return 'codex';
  if (agentId === 'claude') return 'claude-code';
  return null;
}

function shouldSendDashboardModel(model: DashboardModelOption): boolean {
  return !(model.agentId === 'codex' && model.modelId === 'default');
}

function isDashboardAgentId(value: unknown): value is 'codex' | 'claude' {
  return value === 'codex' || value === 'claude';
}

interface DashboardModelOption {
  key: string;
  provider: ComposerModelProvider;
  agentId: 'codex' | 'claude';
  providerLabel: string;
  modelId: string;
  modelLabel: string | null;
  description?: string;
}

function DashboardStagedImage({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <span className="dashboard-staged-image">
      {previewUrl ? (
        <img
          alt={file.name}
          className="size-8 rounded-[var(--project-radius-sm)] object-cover"
          src={previewUrl}
        />
      ) : null}
      <span className="max-w-[120px] truncate text-xs text-[var(--text-primary)]">{file.name}</span>
      <button
        type="button"
        className="dashboard-staged-image__remove"
        aria-label={t('dashboard.creator.removeImage', { name: file.name })}
        onClick={onRemove}
      >
        <CloseIcon aria-hidden="true" size={11} />
      </button>
    </span>
  );
}


interface DashboardDesignSystem {
  id: string;
  title: string;
  category: string;
  summary: string;
  swatches: string[];
  source: 'built-in' | 'user';
  status: 'published' | 'draft';
  isEditable: boolean;
}

type DesignSystemLoadState = 'idle' | 'loading' | 'ready' | 'error';

function DesignSystemPrompt({
  onSetup,
  selectedDesignSystem,
}: {
  onSetup: () => void;
  selectedDesignSystem: DashboardDesignSystem | null;
}) {
  const { t } = useTranslation();
  const swatches = selectedDesignSystem?.swatches.slice(0, 4) ?? [];
  const label = selectedDesignSystem
    ? `${t('dashboard.designSystem.title')} ${selectedDesignSystem.title}`
    : `${t('dashboard.designSystem.title')} ${t('dashboard.designSystem.emptySelectedShort')}`;

  return (
    <section
      className="min-w-0"
      data-testid="dashboard-creator-design-system"
    >
      <ComposerDesignSystemTrigger
        ariaLabel={t('chat.composer.chooseDesignSystem')}
        label={label}
        onClick={onSetup}
      />
      {selectedDesignSystem ? (
        <span
          className="sr-only"
          data-testid="dashboard-selected-design-system"
        >
          {selectedDesignSystem.title}
          {swatches.length > 0 ? (
            <span
              aria-label={t('dashboard.designSystem.swatchesAria', { title: selectedDesignSystem.title })}
            >
              {swatches.map((swatch) => (
                <span
                  key={`${selectedDesignSystem.id}-${swatch}`}
                  className="size-3 rounded-[var(--project-radius-xs)] border border-[var(--border-1)]"
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </section>
  );
}

function DashboardDesignSystemPicker({
  designSystems,
  error,
  loadState,
  open,
  selectedDesignSystem,
  onDone,
  onClearDesignSystem,
  onOpenChange,
  onSelectDesignSystem,
}: {
  designSystems: DashboardDesignSystem[];
  error: string | null;
  loadState: DesignSystemLoadState;
  open: boolean;
  selectedDesignSystem: DashboardDesignSystem | null;
  onDone: () => void;
  onClearDesignSystem: () => void;
  onOpenChange: (open: boolean) => void;
  onSelectDesignSystem: (designSystemId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <DesignSystemPickerDialog
      designSystems={designSystems}
      error={error}
      loadState={loadState}
      open={open}
      selectedDesignSystem={selectedDesignSystem}
      text={{
        allSelected: t('dashboard.designSystem.allSelected'),
        availableLabel: t('dashboard.designSystem.availableLabel'),
        availableListLabel: t('dashboard.designSystem.availableListLabel'),
        clearSelectionAria: (title) => t('dashboard.designSystem.clearSelectionAria', { title }),
        dialogDescription: t('dashboard.designSystem.dialogDescription'),
        dialogTitle: t('dashboard.designSystem.dialogTitle'),
        done: t('common.done'),
        emptySelected: t('dashboard.designSystem.emptySelected'),
        errorFallback: t('dashboard.designSystem.loadError'),
        importHint: t('dashboard.designSystem.importHint'),
        loading: t('common.loading'),
        selectAria: (title) => t('dashboard.designSystem.selectAria', { title }),
        selectedLabel: t('dashboard.designSystem.selectedLabel'),
        setupPrompt: t('dashboard.designSystem.setupPrompt'),
      }}
      onClearDesignSystem={onClearDesignSystem}
      onDone={onDone}
      onOpenChange={onOpenChange}
      onSelectDesignSystem={onSelectDesignSystem}
    />
  );
}

function readDesignSystems(data: unknown, fallbackCategory: string): DashboardDesignSystem[] {
  if (!isRecord(data) || !Array.isArray(data.designSystems)) {
    return [];
  }

  return data.designSystems.flatMap((value): DashboardDesignSystem[] => {
    const system = readDesignSystem(value, fallbackCategory);
    return system ? [system] : [];
  });
}

function readDesignSystem(value: unknown, fallbackCategory: string): DashboardDesignSystem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    category: typeof value.category === 'string' ? value.category : fallbackCategory,
    summary: typeof value.summary === 'string' ? value.summary : '',
    swatches: Array.isArray(value.swatches)
      ? value.swatches.filter((swatch): swatch is string => typeof swatch === 'string')
      : [],
    source: value.source === 'user' ? 'user' : 'built-in',
    status: value.status === 'draft' ? 'draft' : 'published',
    isEditable: value.isEditable === true,
  };
}

function readDashboardProjects(data: unknown): DashboardProject[] {
  if (!isRecord(data) || !Array.isArray(data.projects)) {
    return [];
  }

  return data.projects.flatMap((value): DashboardProject[] => {
    const project = readDashboardProject(value);
    return project ? [project] : [];
  });
}

function readDashboardProject(value: unknown): DashboardProject | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.prompt !== 'string' ||
    typeof value.projectKind !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    prompt: value.prompt,
    projectKind: value.projectKind,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(typeof value.coverUrl === 'string' && value.coverUrl ? { coverUrl: value.coverUrl } : {}),
  };
}

function readDesignSystemError(data: unknown, fallbackMessage: string): string {
  const error = isRecord(data) ? data.error : null;
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  if (isRecord(data) && typeof data.message === 'string') {
    return data.message;
  }

  return fallbackMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function openProjectInCurrentWindow(projectId: string): void {
  if (typeof window !== 'undefined') {
    window.location.assign(`/project/${encodeURIComponent(projectId)}`);
  }
}

function ProjectBrowser({
  projects,
  onDeleteProject,
}: {
  projects: DashboardProject[];
  onDeleteProject: (projectId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState('');
  const visibleProjects = React.useMemo(
    () => sortProjectsByUpdatedTime(filterProjects(projects, search)),
    [projects, search],
  );

  return (
    <section
      className="mt-10 min-h-0 min-w-0 overflow-y-auto"
      data-testid="dashboard-project-browser"
    >
      <div data-testid="dashboard-search-row" className="flex justify-end">
        <label className="relative block w-full sm:w-[224px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]">
            <SearchIcon aria-hidden="true" size={15} />
          </span>
          <Input
            aria-label={t('dashboard.search.label')}
            className="h-8 rounded-md border-[var(--border-1)] bg-[var(--project-input-bg)] pl-8 text-xs hover:bg-[var(--project-input-hover-bg)]"
            placeholder={t('dashboard.search.placeholder')}
            type="search"
            value={search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(event.currentTarget.value)
            }
          />
        </label>
      </div>
      <div
        className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4"
        data-testid="dashboard-project-grid"
      >
        {visibleProjects.map((project) => (
          <ProjectCard key={project.id} project={project} onDelete={onDeleteProject} />
        ))}
        {projects.length === 0 ? <EmptyProjectCard /> : null}
      </div>
    </section>
  );
}

function DesignSystemBrowser({
  designSystems,
  error,
  loadState,
  selectedDesignSystemId,
  onSelect,
}: {
  designSystems: DashboardDesignSystem[];
  error: string | null;
  loadState: DesignSystemLoadState;
  selectedDesignSystemId: string | null;
  onSelect: (designSystemId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-4" data-testid="dashboard-design-system-browser">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('dashboard.designSystem.browserTitle')}
          </h2>
          <p className="mt-1 text-xs font-normal leading-5 text-[var(--text-secondary)]">
            {t('dashboard.designSystem.browserDescription')}
          </p>
        </div>
      </div>

      {loadState === 'error' ? (
        <div className="rounded-md border border-[var(--state-danger)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--state-danger)]">
          {error}
        </div>
      ) : null}

      {loadState === 'ready' && designSystems.length === 0 ? (
        <div className="rounded-md border border-[var(--border-1)] bg-[var(--background)] px-3 py-8 text-center text-sm font-normal text-[var(--text-secondary)]">
          {t('dashboard.designSystem.browserEmpty')}
        </div>
      ) : null}

      {loadState !== 'error' && designSystems.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {designSystems.map((system) => (
            <DesignSystemCard
              key={system.id}
              designSystem={system}
              selected={system.id === selectedDesignSystemId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DesignSystemCard({
  designSystem,
  selected,
  onSelect,
}: {
  designSystem: DashboardDesignSystem;
  selected: boolean;
  onSelect: (designSystemId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        'flex min-h-[180px] flex-col items-stretch rounded-md border bg-[var(--background)] p-4 text-left shadow-none transition-colors',
        selected
          ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]'
          : 'border-[var(--border-1)] hover:border-[var(--border-2)]',
      ].join(' ')}
      onClick={() => onSelect(designSystem.id)}
    >
      <div className="grid min-h-[52px] grid-cols-1 items-start gap-3">
        <div className="min-w-0 self-start">
          <div className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--text-primary)]">
            {designSystem.title}
          </div>
          <div className="mt-1 truncate text-xs font-normal text-[var(--text-tertiary)]">
            {designSystem.category || t('dashboard.designSystem.cardFallbackCategory')}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1">
        {designSystem.swatches.slice(0, 5).map((swatch) => (
          <span
            key={`${designSystem.id}-${swatch}`}
            aria-hidden="true"
            className="h-5 w-5 rounded-sm border border-[var(--border-1)]"
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
      {designSystem.summary ? (
        <p className="mt-4 line-clamp-3 text-xs font-normal leading-5 text-[var(--text-secondary)]">
          {designSystem.summary}
        </p>
      ) : null}
    </button>
  );
}

function ProjectCard({ project, onDelete }: { project: DashboardProject; onDelete: (projectId: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  async function handleConfirmDelete(): Promise<void> {
    setDeleting(true);
    try {
      await onDelete(project.id);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="group/card relative block">
      <a className="block" href={`/project/${encodeURIComponent(project.id)}`}>
        <Card className="gap-0 overflow-hidden rounded-[var(--project-radius-lg)] border-[var(--border-1)] bg-[var(--background-fronted)] py-0 shadow-none transition-colors hover:border-[var(--border-2)]">
          <ProjectThumbnail project={project} />
          <CardContent className="px-3 pb-3 pt-2">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{project.title}</div>
            <div
              data-testid="dashboard-project-metadata"
              className="mt-1 flex min-w-0 items-center gap-2 text-xs font-normal text-[var(--text-secondary)]"
            >
              <span className="truncate">{relativeProjectTime(project.updatedAt, t)}</span>
            </div>
          </CardContent>
        </Card>
      </a>
      <div className="absolute bottom-[10px] right-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('dashboard.projectCard.moreActions', { title: project.title })}
              className="flex size-6 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              onClick={(e) => e.preventDefault()}
            >
              <MoreHorizontalIcon aria-hidden="true" size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem
              className="text-[var(--state-danger)] focus:text-[var(--state-danger)]"
              onSelect={() => setConfirmOpen(true)}
            >
              <DeleteIcon aria-hidden="true" size={14} />
              {t('dashboard.projectCard.deleteProject')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmationDialog
        open={confirmOpen}
        tone="destructive"
        title={t('dashboard.projectCard.deleteConfirmTitle')}
        description={t('dashboard.projectCard.deleteConfirmDescription', { title: project.title })}
        confirmLabel={t('dashboard.projectCard.deleteConfirmAction')}
        cancelLabel={t('common.cancel')}
        confirmBusy={deleting}
        disableCloseWhileBusy
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmOpen(false)}
        onOpenChange={setConfirmOpen}
      />
    </div>
  );
}

function ProjectThumbnail({ project }: { project: DashboardProject }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const coverUrl = project.coverUrl && !imageFailed ? project.coverUrl : null;

  return (
    <div className="grid h-40 place-items-center overflow-hidden bg-[var(--background-soft)] sm:h-36 xl:h-40">
      {coverUrl ? (
        <img
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-top"
          data-testid="project-preview-image"
          draggable={false}
          loading="lazy"
          src={coverUrl}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <ProjectEmptyPlaceholderIcon />
      )}
    </div>
  );
}

function EmptyProjectCard() {
  const { t } = useTranslation();

  return (
    <Card className="gap-0 overflow-hidden rounded-[var(--project-radius-lg)] border-[var(--border-1)] bg-[var(--background-fronted)] py-0 shadow-none">
      <div className="flex h-40 items-center justify-center bg-[var(--background-soft)] sm:h-36 xl:h-40">
        <ProjectEmptyPlaceholderIcon />
      </div>
      <CardContent className="px-3 pb-3 pt-2">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {t('dashboard.emptyProject.title')}
        </div>
        <p className="mt-2 text-xs font-normal text-[var(--text-secondary)]">
          {t('dashboard.emptyProject.description')}
        </p>
      </CardContent>
    </Card>
  );
}

function ProjectEmptyPlaceholderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-8 text-[var(--text-placeholder)]"
      data-testid="project-empty-placeholder-icon"
      fill="none"
      height="32"
      viewBox="0 0 24 24"
      width="32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.92969 2C9.42628 2.00008 9.91537 2.12381 10.3525 2.35938C10.7897 2.59498 11.1624 2.93486 11.4355 3.34961H11.4346L12.2393 4.54004L12.2451 4.5498C12.3371 4.68949 12.4627 4.8042 12.6104 4.88281C12.7579 4.96136 12.9227 5.00158 13.0898 5H20C20.7957 5 21.5585 5.3163 22.1211 5.87891C22.6837 6.44152 23 7.20435 23 8V19C23 19.7957 22.6837 20.5585 22.1211 21.1211C21.5585 21.6837 20.7957 22 20 22H4C3.20435 22 2.44152 21.6837 1.87891 21.1211C1.3163 20.5585 1 19.7957 1 19V5C1 4.20435 1.3163 3.44152 1.87891 2.87891C2.44152 2.3163 3.20435 2 4 2H8.92969Z"
        fill="currentColor"
      />
    </svg>
  );
}

function filterProjects(projects: DashboardProject[], query: string): DashboardProject[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return projects;
  }

  return projects.filter((project) =>
    [project.title, project.prompt, project.projectKind].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}

function sortProjectsByUpdatedTime(projects: DashboardProject[]): DashboardProject[] {
  return [...projects].sort(compareProjectsByUpdatedTime);
}

function compareProjectsByUpdatedTime(left: DashboardProject, right: DashboardProject): number {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id);
}

function isPlainEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

function filterDesignSystems(designSystems: DashboardDesignSystem[], query: string): DashboardDesignSystem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return designSystems;
  }

  return designSystems.filter((system) =>
    [system.title, system.category, system.summary].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}

function relativeProjectTime(updatedAt: number, t: TranslateFn): string {
  const elapsedMs = Math.max(0, Date.now() - updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return t('dashboard.time.justNow');
  if (elapsedMinutes < 60) return t('dashboard.time.minutesAgo', { count: elapsedMinutes });
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t('dashboard.time.hoursAgo', { count: elapsedHours });
  return t('dashboard.time.daysAgo', { count: Math.floor(elapsedHours / 24) });
}
