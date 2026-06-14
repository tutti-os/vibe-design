import type { IContextPickerService } from '../context-picker-service.interface';
import type {
  ContextPickerApi,
  ContextPickerSnapshot,
  ContextSearchResult,
  ContextSearchResultItem,
  ProjectFile,
  RunContextSelection,
  SkillSummary,
} from '../context-picker-types';
import { filterMentionResults } from './mention-query';

export class ContextPickerService implements IContextPickerService {
  readonly _serviceBrand = undefined;

  private selectedSkills: SkillSummary[] = [];
  private selectedDesignFiles: ProjectFile[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly api: ContextPickerApi) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async search(query: string): Promise<ContextSearchResult> {
    const [skills, designFiles] = await Promise.all([this.api.listSkills(), this.api.listDesignFiles()]);
    return {
      query,
      items: filterMentionResults(query, { skills, designFiles }),
    };
  }

  async selectSkill(skillId: string): Promise<void> {
    if (this.selectedSkills.some((skill) => skill.id === skillId)) {
      return;
    }

    const skill = (await this.api.listSkills()).find((candidate) => candidate.id === skillId);
    if (skill && !this.selectedSkills.some((selectedSkill) => selectedSkill.id === skillId)) {
      this.selectedSkills = [...this.selectedSkills, cloneSkill(skill)];
      this.emitChange();
    }
  }

  async selectDesignFile(designFileId: string): Promise<void> {
    if (this.selectedDesignFiles.some((file) => matchesDesignFile(file, designFileId))) {
      return;
    }

    const file = (await this.api.listDesignFiles()).find((candidate) => matchesDesignFile(candidate, designFileId));
    if (file && !this.selectedDesignFiles.some((selectedFile) => matchesDesignFile(selectedFile, designFileId))) {
      this.selectedDesignFiles = [...this.selectedDesignFiles, cloneProjectFile(file)];
      this.emitChange();
    }
  }

  selectResult(item: ContextSearchResultItem): Promise<void> {
    if (item.kind === 'skill') {
      return this.selectSkill(item.value);
    }
    return this.selectDesignFile(item.value);
  }

  removeSelection(kind: ContextSearchResultItem['kind'], id: string): void {
    if (kind === 'skill') {
      const nextSkills = this.selectedSkills.filter((skill) => skill.id !== id);
      if (nextSkills.length !== this.selectedSkills.length) {
        this.selectedSkills = nextSkills;
        this.emitChange();
      }
      return;
    }

    const nextDesignFiles = this.selectedDesignFiles.filter((file) => !matchesDesignFile(file, id));
    if (nextDesignFiles.length !== this.selectedDesignFiles.length) {
      this.selectedDesignFiles = nextDesignFiles;
      this.emitChange();
    }
  }

  buildRunContext(): RunContextSelection | undefined {
    if (this.selectedSkills.length === 0 && this.selectedDesignFiles.length === 0) {
      return undefined;
    }

    return {
      skillIds: this.selectedSkills.map((skill) => skill.id),
      designFileIds: this.selectedDesignFiles.flatMap((file) => (file.id ? [file.id] : [])),
      designFilePaths: this.selectedDesignFiles.flatMap((file) => (file.path ? [file.path] : [])),
    };
  }

  getSnapshot(): ContextPickerSnapshot {
    return {
      selectedSkills: this.selectedSkills.map(cloneSkill),
      selectedDesignFiles: this.selectedDesignFiles.map(cloneProjectFile),
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function cloneSkill(skill: SkillSummary): SkillSummary {
  return {
    ...skill,
    triggers: skill.triggers ? [...skill.triggers] : undefined,
  };
}

function cloneProjectFile(file: ProjectFile): ProjectFile {
  return { ...file };
}

function matchesDesignFile(file: ProjectFile, idOrPath: string): boolean {
  return file.id === idOrPath || file.path === idOrPath;
}
