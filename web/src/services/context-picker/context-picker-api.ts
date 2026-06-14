import type { ProjectFile, SkillSummary } from '../../types';
import { readProjectFile } from '../project-file-normalizer';
import type { ContextPickerApi } from './context-picker-types';

export class FetchContextPickerApi implements ContextPickerApi {
  constructor(private readonly projectId: string | null = null) {}

  async listSkills(): Promise<SkillSummary[]> {
    const response = await fetch('/api/skills');
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not list skills.'));
    }

    return readSkillList(data);
  }

  async listDesignFiles(): Promise<ProjectFile[]> {
    if (!this.projectId) return [];

    const response = await fetch(`/api/projects/${encodeURIComponent(this.projectId)}/files`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not list design files.'));
    }

    return readProjectFileList(data);
  }
}

function readSkillList(data: unknown): SkillSummary[] {
  const rows = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.skills) ? data.skills : [];
  return rows.flatMap((row) => (isSkillSummary(row) ? [row] : []));
}

function readProjectFileList(data: unknown): ProjectFile[] {
  const rows = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.files) ? data.files : [];
  return rows.flatMap((row) => {
    const file = readProjectFile(row);
    return file ? [file] : [];
  });
}

function isSkillSummary(value: unknown): value is SkillSummary {
  return isObject(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function readErrorMessage(data: unknown, fallbackMessage: string): string {
  if (isObject(data) && typeof data.message === 'string') {
    return data.message;
  }
  return fallbackMessage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
