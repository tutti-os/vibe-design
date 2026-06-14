import React from 'react';
import {
  createVibeDesignI18nRuntime,
  type VibeDesignI18nRuntime,
  type VibeDesignLocale,
} from './core';
import {
  applyLocale,
  getActiveLocale,
  readHostLocale,
  subscribeHostLocale,
  subscribeLocale,
  syncDocumentLanguage,
} from './runtime';
import type { I18nParams, VibeDesignI18nKey } from './types';

export {
  createVibeDesignI18nRuntime,
  defaultVibeDesignLocale,
  isVibeDesignLocale,
  normalizeVibeDesignLocale,
  resolveVibeDesignLocaleFromCandidates,
  toDocumentLanguage,
  vibeDesignLocales,
  type VibeDesignLocale,
} from './core';
export { applyLocale, getActiveLocale, readInitialLocale } from './runtime';
export type { I18nParams, TranslationDictionary, VibeDesignI18nKey } from './types';

export type TranslateFn = (key: VibeDesignI18nKey, params?: I18nParams) => string;

const I18nContext = React.createContext<{
  i18n: VibeDesignI18nRuntime;
  locale: VibeDesignLocale;
  t: TranslateFn;
} | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: VibeDesignLocale;
}) {
  const [locale, setLocale] = React.useState<VibeDesignLocale>(() => initialLocale ?? getActiveLocale());

  React.useEffect(() => {
    applyLocale(initialLocale ?? locale);
  }, [initialLocale, locale]);

  React.useEffect(() => {
    syncDocumentLanguage(getActiveLocale());

    const unsubscribeLocale = subscribeLocale((nextLocale) => {
      setLocale((currentLocale) => (currentLocale === nextLocale ? currentLocale : nextLocale));
    });
    const unsubscribeHostLocale = subscribeHostLocale(applyLocale);
    let disposed = false;

    void readHostLocale().then((hostLocale) => {
      if (!disposed && hostLocale) applyLocale(hostLocale);
    });

    return () => {
      disposed = true;
      unsubscribeHostLocale();
      unsubscribeLocale();
    };
  }, []);

  const value = React.useMemo(() => {
    const i18n = createVibeDesignI18nRuntime(locale);
    return {
      i18n,
      locale,
      t: (key: VibeDesignI18nKey, params?: I18nParams) => i18n.t(key, params),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): {
  i18n: VibeDesignI18nRuntime;
  locale: VibeDesignLocale;
  t: TranslateFn;
} {
  const context = React.useContext(I18nContext);
  if (context) return context;

  const locale = getActiveLocale();
  const i18n = createVibeDesignI18nRuntime(locale);
  return {
    i18n,
    locale,
    t: (key: VibeDesignI18nKey, params?: I18nParams) => i18n.t(key, params),
  };
}
