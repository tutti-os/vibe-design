import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
} from '@tutti-os/ui-system';
import {
  AddIcon,
  SearchIcon,
} from '@tutti-os/ui-system/icons';
import { useService } from '@tutti-os/infra/di';
import React from 'react';
import { DesignSystemPickerDialog } from './components/DesignSystemPickerDialog';
import { ProjectSecondaryButton } from './components/ProjectSecondaryButton';
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

export function DashboardPage({
  openProject = openProjectInCurrentWindow,
  recentProjects = EMPTY_DASHBOARD_PROJECTS,
}: {
  openProject?: (projectId: string) => void;
  recentProjects?: DashboardProject[];
}) {
  const { locale, t } = useTranslation();
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
    <main className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <DashboardSidebar
          openProject={openProject}
          selectedDesignSystem={selectedDesignSystem}
          selectedDesignSystemId={selectedDesignSystemId}
          onSetupDesignSystem={openDesignSystemPicker}
        />
        <ProjectBrowser
          projects={projects}
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

function DashboardSidebar({
  openProject,
  selectedDesignSystem,
  selectedDesignSystemId,
  onSetupDesignSystem,
}: {
  openProject: (projectId: string) => void;
  selectedDesignSystem: DashboardDesignSystem | null;
  selectedDesignSystemId: string | null;
  onSetupDesignSystem: () => void;
}) {
  return (
    <aside className="flex max-h-full min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b border-[var(--border-1)] bg-[var(--background)] px-5 py-7 sm:px-6 lg:h-full lg:w-[360px] xl:w-[380px] lg:border-b-0 lg:border-r">
      <BrandHeader />
      <ProjectCreator
        openProject={openProject}
        designSystemId={selectedDesignSystemId}
        selectedDesignSystem={selectedDesignSystem}
        onSetupDesignSystem={onSetupDesignSystem}
      />
    </aside>
  );
}

function BrandHeader() {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3">
        <BrandGlyph />
        <div className="min-w-0">
          <h1 className="shrink-0 text-[20px] leading-6 tracking-normal text-[var(--text-primary)]">
            <span className="font-semibold">Vibe</span>{' '}
            <span className="font-semibold italic [font-family:var(--vd-font-serif)]">Design</span>
          </h1>
        </div>
      </div>
    </header>
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
  const [projectName, setProjectName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canCreate = projectName.trim().length > 0 && !isCreating;

  async function createProject(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const formPrompt = formData.get('prompt');
    const formProjectKind = formData.get('projectKind');
    const nextPrompt = typeof formPrompt === 'string' ? formPrompt.trim() : '';
    if (!nextPrompt || isCreating) {
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const project = await projectService.createProject({
        prompt: nextPrompt,
        projectKind: typeof formProjectKind === 'string' ? formProjectKind : 'prototype',
        ...(designSystemId ? { designSystemId } : {}),
      });
      setProjectName('');
      openProject(project.id);
    } catch (projectError) {
      setError(projectError instanceof Error ? projectError.message : t('dashboard.creator.errorFallback'));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section>
      <form
        className="w-full"
        method="post"
        action="/projects"
        onSubmit={(event) => void createProject(event)}
      >
        <input type="hidden" name="projectKind" value="prototype" />
        {designSystemId ? <input type="hidden" name="designSystemId" value={designSystemId} /> : null}
        <Card className="rounded-[var(--project-radius-xl)] border-[var(--border-1)] bg-[var(--background-fronted)] py-0 shadow-[var(--project-shadow-none)]">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              {t('dashboard.creator.title')}
            </h2>
            <Input
              aria-label={t('dashboard.creator.projectNameLabel')}
              autoComplete="off"
              className="h-9 rounded-md border-[var(--border-1)] bg-[var(--project-input-bg)] text-sm hover:bg-[var(--project-input-hover-bg)]"
              name="prompt"
              placeholder={t('dashboard.creator.projectNamePlaceholder')}
              type="text"
              value={projectName}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setProjectName(event.currentTarget.value)
              }
            />
            <DesignSystemPrompt selectedDesignSystem={selectedDesignSystem} onSetup={onSetupDesignSystem} />
            {error ? <div className="mt-3 text-sm text-[var(--state-danger)]">{error}</div> : null}
            <Button
              type="submit"
              className="project-primary-button mt-3 h-9 w-full rounded-md text-xs font-medium"
              aria-label={t('dashboard.creator.createAria')}
              disabled={!canCreate}
            >
              <AddIcon size={13} />
              {t('dashboard.creator.createAction')}
            </Button>
          </CardContent>
        </Card>
      </form>
    </section>
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

  return (
    <section
      className="mt-4 rounded-[var(--project-radius-lg)] border border-[var(--border-1)] bg-[var(--background)] p-3"
      data-testid="dashboard-creator-design-system"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {selectedDesignSystem ? (
            <div data-testid="dashboard-selected-design-system">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
                  {selectedDesignSystem.title}
                </p>
              </div>
              <p className="mt-2 w-full text-xs font-normal leading-[1.3] text-[var(--text-secondary)]">
                {selectedDesignSystem.summary || selectedDesignSystem.category}
              </p>
              <div
                className="mt-3 flex items-center gap-1.5"
                aria-label={t('dashboard.designSystem.swatchesAria', { title: selectedDesignSystem.title })}
              >
                {selectedDesignSystem.swatches.slice(0, 4).map((swatch) => (
                  <span
                    key={`${selectedDesignSystem.id}-${swatch}`}
                    className="h-5 w-5 rounded-[var(--project-radius-sm)] border border-[var(--border-1)]"
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('dashboard.designSystem.title')}
              </h2>
              <p className="mt-1 text-sm font-normal leading-[1.3] text-[var(--text-secondary)]">
                {t('dashboard.designSystem.titleDescription')}
              </p>
            </>
          )}
        </div>
      </div>

      {selectedDesignSystem ? (
        <ProjectSecondaryButton
          type="button"
          className="mt-4 h-9 w-full text-xs font-medium"
          onClick={onSetup}
        >
          {t('dashboard.designSystem.updateAction')}
        </ProjectSecondaryButton>
      ) : (
        <ProjectSecondaryButton
          type="button"
          className="mt-4 h-9 w-full rounded-md text-xs font-medium"
          onClick={onSetup}
        >
          {t('dashboard.designSystem.setupAction')}
        </ProjectSecondaryButton>
      )}
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

function ProjectBrowser({ projects }: { projects: DashboardProject[] }) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState('');
  const visibleProjects = React.useMemo(
    () => sortProjectsByUpdatedTime(filterProjects(projects, search)),
    [projects, search],
  );

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--background-fronted)] px-6 py-7 sm:px-8">
      <div data-testid="dashboard-search-row" className="flex justify-start">
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
        className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4"
        data-testid="dashboard-project-grid"
      >
        {visibleProjects.map((project) => (
          <ProjectCard key={project.id} project={project} />
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

function ProjectCard({ project }: { project: DashboardProject }) {
  const { t } = useTranslation();

  return (
    <a className="block" href={`/project/${encodeURIComponent(project.id)}`}>
      <Card className="gap-0 overflow-hidden rounded-[var(--project-radius-lg)] border-[var(--border-1)] bg-[var(--background-fronted)] py-0 shadow-none transition-colors hover:border-[var(--border-2)]">
        <ProjectThumbnail project={project} />
        <CardContent className="px-3 pb-3 pt-2">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{project.title}</div>
          <div
            data-testid="dashboard-project-metadata"
            className="mt-1 flex min-w-0 items-center gap-2 text-xs font-normal text-[var(--text-secondary)]"
          >
            <span className="shrink-0">{t('dashboard.projectCard.type')}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{relativeProjectTime(project.updatedAt, t)}</span>
            <Badge variant="secondary" className="ml-auto shrink-0 font-normal">
              {t('dashboard.projectCard.owner')}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </a>
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
