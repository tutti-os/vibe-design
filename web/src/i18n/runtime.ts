import {
  defaultVibeDesignLocale,
  normalizeVibeDesignLocale,
  resolveVibeDesignLocaleFromCandidates,
  toDocumentLanguage,
  type VibeDesignLocale,
} from './core';

type MaybePromise<T> = T | Promise<T>;

interface TuttiAppContextSnapshot {
  locale?: unknown;
  language?: unknown;
}

interface TuttiAppContext {
  locale?: unknown;
  language?: unknown;
  get?(): MaybePromise<TuttiAppContextSnapshot | null | undefined>;
  getLocale?(): MaybePromise<unknown>;
  subscribe?(listener: (context: TuttiAppContextSnapshot | null | undefined) => void): unknown;
  onLocaleChanged?(listener: (locale: unknown) => void): unknown;
}

declare global {
  interface Window {
    tutti?: {
      appContext?: TuttiAppContext;
    };
    tuttiAppContext?: TuttiAppContext;
  }
}

const localeListeners = new Set<(locale: VibeDesignLocale) => void>();

let activeLocale: VibeDesignLocale = readInitialLocale();

export function readInitialLocale(): VibeDesignLocale {
  if (typeof window === 'undefined') {
    return defaultVibeDesignLocale;
  }

  return resolveVibeDesignLocaleFromCandidates([
    readHostLocaleFromStaticContext(),
    document.documentElement.lang,
    ...(navigator.languages ?? []),
    navigator.language,
  ]);
}

export async function readHostLocale(): Promise<VibeDesignLocale | null> {
  const appContext = getTuttiAppContext();
  if (!appContext) return null;

  if (typeof appContext.get === 'function') {
    const context = await Promise.resolve(appContext.get()).catch(() => null);
    const locale = normalizeLocaleCandidate(readLocaleCandidate(context));
    if (locale) return locale;
  }

  const staticLocale = normalizeLocaleCandidate(readLocaleCandidate(appContext));
  if (staticLocale) return staticLocale;

  if (typeof appContext.getLocale === 'function') {
    const locale = normalizeLocaleCandidate(await Promise.resolve(appContext.getLocale()).catch(() => null));
    if (locale) return locale;
  }

  return null;
}

export function getActiveLocale(): VibeDesignLocale {
  return activeLocale;
}

export function applyLocale(locale: VibeDesignLocale): void {
  if (activeLocale === locale) {
    syncDocumentLanguage(locale);
    return;
  }

  activeLocale = locale;
  syncDocumentLanguage(locale);
  localeListeners.forEach((listener) => listener(locale));
}

export function subscribeLocale(listener: (locale: VibeDesignLocale) => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

export function subscribeHostLocale(listener: (locale: VibeDesignLocale) => void): () => void {
  const appContext = getTuttiAppContext();
  if (typeof appContext?.subscribe === 'function') {
    return normalizeUnsubscribe(
      appContext.subscribe((context) => {
        const locale = normalizeLocaleCandidate(readLocaleCandidate(context));
        if (locale) listener(locale);
      }),
    );
  }

  if (typeof appContext?.onLocaleChanged === 'function') {
    return normalizeUnsubscribe(
      appContext.onLocaleChanged((candidate) => {
        const locale = normalizeLocaleCandidate(candidate);
        if (locale) listener(locale);
      }),
    );
  }

  return () => {};
}

export function syncDocumentLanguage(locale: VibeDesignLocale): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = toDocumentLanguage(locale);
}

function getTuttiAppContext(): TuttiAppContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.tutti?.appContext ??
    window.tuttiAppContext ??
    null
  );
}

function readHostLocaleFromStaticContext(): string | null {
  return readLocaleCandidate(getTuttiAppContext());
}

function readLocaleCandidate(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null;
  const snapshot = context as TuttiAppContextSnapshot;
  if (typeof snapshot.locale === 'string') return snapshot.locale;
  if (typeof snapshot.language === 'string') return snapshot.language;
  return null;
}

function normalizeLocaleCandidate(value: unknown): VibeDesignLocale | null {
  return typeof value === 'string' ? normalizeVibeDesignLocale(value) : null;
}

function normalizeUnsubscribe(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => {};
}
