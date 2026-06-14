import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import type { I18nParams, TranslationDictionary, VibeDesignI18nKey } from './types';

export const vibeDesignLocales = ['en', 'zh-CN'] as const;
export type VibeDesignLocale = (typeof vibeDesignLocales)[number];

export const defaultVibeDesignLocale: VibeDesignLocale = 'en';

export interface VibeDesignI18nRuntime {
  has(key: VibeDesignI18nKey): boolean;
  t(key: VibeDesignI18nKey, params?: I18nParams): string;
}

const dictionaries: Record<VibeDesignLocale, TranslationDictionary> = {
  en,
  'zh-CN': zhCN,
};

const runtimes = new Map<VibeDesignLocale, VibeDesignI18nRuntime>();

export function isVibeDesignLocale(value: unknown): value is VibeDesignLocale {
  return typeof value === 'string' && vibeDesignLocales.includes(value as VibeDesignLocale);
}

export function normalizeVibeDesignLocale(value: string | null | undefined): VibeDesignLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

export function resolveVibeDesignLocaleFromCandidates(
  candidates: readonly (string | null | undefined)[],
  fallback: VibeDesignLocale = defaultVibeDesignLocale,
): VibeDesignLocale {
  for (const candidate of candidates) {
    const locale = normalizeVibeDesignLocale(candidate);
    if (locale) return locale;
  }
  return fallback;
}

export function toDocumentLanguage(locale: VibeDesignLocale): string {
  return locale;
}

export function createVibeDesignI18nRuntime(locale: VibeDesignLocale): VibeDesignI18nRuntime {
  const existing = runtimes.get(locale);
  if (existing) return existing;

  const localeDictionaries = locale === 'en' ? [dictionaries.en] : [dictionaries[locale], dictionaries.en];
  const runtime = {
    has(key: VibeDesignI18nKey) {
      return resolveI18nValue(localeDictionaries, key) !== null;
    },
    t(key: VibeDesignI18nKey, params?: I18nParams) {
      const resolved = resolveI18nValue(localeDictionaries, key);
      return resolved ? interpolateI18nTemplate(resolved, params) : key;
    },
  };
  runtimes.set(locale, runtime);
  return runtime;
}

function resolveI18nValue(dictionariesToSearch: readonly TranslationDictionary[], key: string): string | null {
  for (const dictionary of dictionariesToSearch) {
    const resolved = resolveDictionaryValue(dictionary, key);
    if (resolved !== null) return resolved;
  }
  return null;
}

function resolveDictionaryValue(dictionary: TranslationDictionary, key: string): string | null {
  const segments = key.split('.');
  let current: string | Record<string, unknown> | undefined = dictionary;

  for (const segment of segments) {
    if (typeof current === 'string' || !current) return null;
    current = current[segment] as string | Record<string, unknown> | undefined;
  }

  return typeof current === 'string' ? current : null;
}

function interpolateI18nTemplate(template: string, params: I18nParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match: string, key: string) => {
    const value = params[key];
    return value === null || value === undefined ? '' : String(value);
  });
}
