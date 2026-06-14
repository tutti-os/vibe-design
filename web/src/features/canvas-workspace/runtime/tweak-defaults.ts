export interface DesignTweakSourceFile {
  name: string;
  path: string;
  contents?: string;
  mime: string;
}

export interface DesignTweakDefaults {
  sourcePath: string;
  defaults: Record<string, unknown>;
}

const EDITMODE_PATTERN = /\/\*EDITMODE-BEGIN\*\/([\s\S]*?)\/\*EDITMODE-END\*\//;

export function extractDesignTweakDefaults(files: DesignTweakSourceFile[]): DesignTweakDefaults | null {
  for (const file of files) {
    const contents = file.contents;
    if (contents === undefined) {
      continue;
    }

    const match = EDITMODE_PATTERN.exec(contents);
    if (!match) {
      continue;
    }

    const defaults = parseTweakDefaults(match[1]);
    if (defaults) {
      return { sourcePath: file.path, defaults };
    }
  }

  return null;
}

export function replaceDesignTweakDefaults(source: string, tweaks: Record<string, unknown>): string | null {
  if (!EDITMODE_PATTERN.test(source)) {
    return null;
  }

  const payload = `${JSON.stringify(tweaks, null, 2)}`;
  return source.replace(EDITMODE_PATTERN, `/*EDITMODE-BEGIN*/${payload}/*EDITMODE-END*/`);
}

function parseTweakDefaults(payload: string | undefined): Record<string, unknown> | null {
  if (payload === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
