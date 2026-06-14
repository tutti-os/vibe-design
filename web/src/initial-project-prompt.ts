const INITIAL_PROJECT_PROMPT_PREFIX = 'vibe-design:initial-project-prompt:';

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

function initialProjectPromptKey(projectId: string): string {
  return `${INITIAL_PROJECT_PROMPT_PREFIX}${projectId}`;
}
