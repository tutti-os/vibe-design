import { renderToString } from 'react-dom/server';
import { createVibeDesignI18nRuntime, defaultVibeDesignLocale, toDocumentLanguage } from './i18n/core';
import { createVibeDesignFlow, type VibeDesignFlowOptions } from './launch/vibe-design-flow';

export function renderPage(options?: VibeDesignFlowOptions): string {
  const appHtml = renderToString(createVibeDesignFlow(options).render());
  const initialData = escapeJsonForHtml(options ?? {});
  const locale = options?.locale ?? defaultVibeDesignLocale;
  const i18n = createVibeDesignI18nRuntime(locale);
  const documentLanguage = toDocumentLanguage(locale);
  const documentTitle = escapeHtml(i18n.t('common.appTitle'));

  return `<!doctype html><html lang="${documentLanguage}" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" type="image/png" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png"><link rel="stylesheet" href="/styles.css"><title>${documentTitle}</title></head><body><div id="root">${appHtml}</div><script>window.__VIBE_DESIGN_INITIAL__=${initialData};</script><script type="module" src="/client.js"></script></body></html>`;
}

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return character;
    }
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}
