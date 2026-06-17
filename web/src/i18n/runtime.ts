import {
  defaultVibeDesignLocale,
  normalizeVibeDesignLocale,
  resolveVibeDesignLocaleFromCandidates,
  toDocumentLanguage,
  type VibeDesignLocale,
} from './core';

type MaybePromise<T> = T | Promise<T>;

interface TuttiExternalContextSnapshot {
  locale?: unknown;
  language?: unknown;
}

interface TuttiExternalApp {
  getContext?(): MaybePromise<TuttiExternalContextSnapshot | null | undefined>;
  subscribe?(listener: (context: TuttiExternalContextSnapshot | null | undefined) => void): unknown;
}

declare global {
  interface Window {
    tuttiExternal?: {
      app?: TuttiExternalApp;
    };
  }
}

const localeListeners = new Set<(locale: VibeDesignLocale) => void>();

let activeLocale: VibeDesignLocale = readInitialLocale();

export function readInitialLocale(): VibeDesignLocale {
  if (typeof window === 'undefined') {
    return defaultVibeDesignLocale;
  }

  return resolveVibeDesignLocaleFromCandidates([
    document.documentElement.lang,
    ...(navigator.languages ?? []),
    navigator.language,
  ]);
}

export async function readHostLocale(): Promise<VibeDesignLocale | null> {
  const externalApp = getTuttiExternalApp();
  if (typeof externalApp?.getContext !== 'function') return null;

  const context = await Promise.resolve(externalApp.getContext()).catch(() => null);
  const staticLocale = normalizeLocaleCandidate(readLocaleCandidate(context));
  if (staticLocale) return staticLocale;

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
  const externalApp = getTuttiExternalApp();
  if (typeof externalApp?.subscribe !== 'function') {
    return () => {};
  }
  return normalizeUnsubscribe(
    externalApp.subscribe((context) => {
      const locale = normalizeLocaleCandidate(readLocaleCandidate(context));
      if (locale) listener(locale);
    }),
  );
}

export function syncDocumentLanguage(locale: VibeDesignLocale): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = toDocumentLanguage(locale);
}

function getTuttiExternalApp(): TuttiExternalApp | null {
  if (typeof window === 'undefined') return null;
  return window.tuttiExternal?.app ?? null;
}

function readLocaleCandidate(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null;
  const snapshot = context as TuttiExternalContextSnapshot;
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
