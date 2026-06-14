import type { ProjectFile, RunContextSelection, SkillSummary } from '../../types';

export interface ContextPickerSnapshot {
  selectedSkills: SkillSummary[];
  selectedDesignFiles: ProjectFile[];
}

export type ContextSearchResultItem =
  | { id: string; kind: 'skill'; label: string; value: string; description?: string }
  | { id: string; kind: 'design-file'; label: string; value: string; path: string };

export interface ContextSearchResult {
  query: string;
  items: ContextSearchResultItem[];
}

export interface ContextPickerApi {
  listSkills(): Promise<SkillSummary[]>;
  listDesignFiles(): Promise<ProjectFile[]>;
}

export type { ProjectFile, RunContextSelection, SkillSummary };
