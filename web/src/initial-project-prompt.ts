const INITIAL_PROJECT_PROMPT_PREFIX = 'vibe-design:initial-project-prompt:';
const INITIAL_PROJECT_SKILLS_PREFIX = 'vibe-design:initial-project-skills:';

export function stashInitialProjectPrompt(projectId: string, prompt: string): void {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(initialProjectPromptKey(projectId), normalizedPrompt);
  } catch {
    // Session storage is a best-effort handoff between dashboard navigation and the project page.
  }
}

export function consumeInitialProjectPrompt(projectId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const key = initialProjectPromptKey(projectId);
    const prompt = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    return prompt?.trim() || null;
  } catch {
    return null;
  }
}

// Carries the skills selected with "@" on the dashboard into the freshly created
// project so they apply to the project's first run.
export function stashInitialProjectSkills(projectId: string, skillIds: string[]): void {
  const normalizedSkillIds = Array.from(
    new Set(skillIds.map((skillId) => skillId.trim()).filter((skillId) => skillId.length > 0)),
  );
  if (normalizedSkillIds.length === 0 || typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(initialProjectSkillsKey(projectId), JSON.stringify(normalizedSkillIds));
  } catch {
    // Session storage is a best-effort handoff between dashboard navigation and the project page.
  }
}

export function consumeInitialProjectSkills(projectId: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const key = initialProjectSkillsKey(projectId);
    const raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0);
  } catch {
    return [];
  }
}

function initialProjectPromptKey(projectId: string): string {
  return `${INITIAL_PROJECT_PROMPT_PREFIX}${projectId}`;
}

function initialProjectSkillsKey(projectId: string): string {
  return `${INITIAL_PROJECT_SKILLS_PREFIX}${projectId}`;
}
