import type { ContextSearchResultItem, ProjectFile, SkillSummary } from '../context-picker-types';

interface MentionQueryInput {
  skills: SkillSummary[];
  designFiles: ProjectFile[];
}

export function filterMentionResults(query: string, input: MentionQueryInput): ContextSearchResultItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (value: string | undefined): boolean =>
    normalizedQuery.length === 0 || value?.toLowerCase().includes(normalizedQuery) === true;

  const skillResults = input.skills
    .filter((skill) => matches(skill.name) || matches(skill.description) || skill.triggers?.some(matches))
    .map<ContextSearchResultItem>((skill) => ({
      id: `skill:${skill.id}`,
      kind: 'skill',
      label: skill.name,
      value: skill.id,
      description: skill.description,
    }));

  const designFileResults = input.designFiles.flatMap<ContextSearchResultItem>((file) => {
    const value = file.id ?? file.path;
    const path = file.path ?? file.name;
    if (!value || !(matches(file.name) || matches(path))) return [];

    return [
      {
        id: `design-file:${value}`,
        kind: 'design-file',
        label: file.name,
        value,
        path,
      },
    ];
  });

  return [...skillResults, ...designFileResults];
}
