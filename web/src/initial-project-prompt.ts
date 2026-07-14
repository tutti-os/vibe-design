const INITIAL_PROJECT_PROMPT_PREFIX = 'vibe-design:initial-project-prompt:';
const INITIAL_PROJECT_SKILLS_PREFIX = 'vibe-design:initial-project-skills:';
const INITIAL_PROJECT_AGENT_PREFIX = 'vibe-design:initial-project-agent:';

export interface InitialProjectAgentSelection {
  agentTargetId: string;
  model?: string;
}

export interface InitialProjectAgentHandoff {
  selection: InitialProjectAgentSelection | null;
  unresolvedLegacyProviderId?: string;
}

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

export function stashInitialProjectAgent(
  projectId: string,
  selection: InitialProjectAgentSelection,
): void {
  const agentTargetId = selection.agentTargetId.trim();
  const model = selection.model?.trim();
  if (!agentTargetId || typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      initialProjectAgentKey(projectId),
      JSON.stringify({ agentTargetId, ...(model ? { model } : {}) }),
    );
  } catch {
    // Session storage is a best-effort handoff between dashboard navigation and the project page.
  }
}

export function consumeInitialProjectAgent(
  projectId: string,
  catalog: readonly { agentTargetId: string; providerId?: string }[] = [],
): InitialProjectAgentSelection | null {
  return consumeInitialProjectAgentHandoff(projectId, catalog).selection;
}

export function consumeInitialProjectAgentHandoff(
  projectId: string,
  catalog: readonly { agentTargetId: string; providerId?: string }[] = [],
): InitialProjectAgentHandoff {
  if (typeof window === 'undefined') {
    return { selection: null };
  }

  try {
    const key = initialProjectAgentKey(projectId);
    const raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (!raw) return { selection: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { selection: null };
    const agentTargetId = 'agentTargetId' in parsed && typeof parsed.agentTargetId === 'string'
      ? parsed.agentTargetId.trim()
      : '';
    const model = 'model' in parsed && typeof parsed.model === 'string'
      ? parsed.model.trim()
      : '';
    if (agentTargetId) {
      return { selection: { agentTargetId, ...(model ? { model } : {}) } };
    }
    const legacyProviderId = 'agentId' in parsed && typeof parsed.agentId === 'string'
      ? parsed.agentId.trim()
      : '';
    const matches = catalog.filter((entry) => entry.providerId === legacyProviderId);
    if (legacyProviderId && matches.length === 1 && matches[0]) {
      return {
        selection: { agentTargetId: matches[0].agentTargetId, ...(model ? { model } : {}) },
      };
    }
    return legacyProviderId
      ? { selection: null, unresolvedLegacyProviderId: legacyProviderId }
      : { selection: null };
  } catch {
    return { selection: null };
  }
}

function initialProjectPromptKey(projectId: string): string {
  return `${INITIAL_PROJECT_PROMPT_PREFIX}${projectId}`;
}

function initialProjectSkillsKey(projectId: string): string {
  return `${INITIAL_PROJECT_SKILLS_PREFIX}${projectId}`;
}

function initialProjectAgentKey(projectId: string): string {
  return `${INITIAL_PROJECT_AGENT_PREFIX}${projectId}`;
}
