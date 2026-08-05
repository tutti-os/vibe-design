import { renderToString } from 'react-dom/server';
import { createVibeDesignI18nRuntime, defaultVibeDesignLocale, toDocumentLanguage } from './i18n/core';
import { createVibeDesignFlow, type VibeDesignFlowOptions } from './launch/vibe-design-flow';

export interface RenderPageRuntimeOptions {
  liveReload?: boolean;
}

export function renderPage(
  options?: VibeDesignFlowOptions,
  runtimeOptions: RenderPageRuntimeOptions = {},
): string {
  const appHtml = renderToString(createVibeDesignFlow(options).render());
  const initialData = escapeJsonForHtml(options ?? {});
  const locale = options?.locale ?? defaultVibeDesignLocale;
  const i18n = createVibeDesignI18nRuntime(locale);
  const documentLanguage = toDocumentLanguage(locale);
  const documentTitle = escapeHtml(i18n.t('common.appTitle'));

  const liveReload = runtimeOptions.liveReload ? renderLiveReloadScript() : '';

  return `<!doctype html><html lang="${documentLanguage}" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" type="image/png" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png"><link rel="stylesheet" href="/styles.css"><title>${documentTitle}</title></head><body><div id="root">${appHtml}</div><script>window.__VIBE_DESIGN_INITIAL__=${initialData};</script><script type="module" src="/client.js"></script>${liveReload}</body></html>`;
}

function renderLiveReloadScript(): string {
  return `<script data-vibe-design-dev-reload>(()=>{const e=["/client.js","/styles.css","/healthz"];let t=null,l=false;const n=async()=>{try{const n=(await Promise.all(e.map(async e=>{const t=await fetch(e,{method:"HEAD",cache:"no-store"});if(!t.ok)throw new Error("asset unavailable");return[t.headers.get("etag"),t.headers.get("content-length"),t.headers.get("x-vibe-design-dev-instance")].join(":")}))).join("|");if(l||t!==null&&t!==n){window.location.reload();return}t=n;l=false}catch{l=true}};void n();window.setInterval(()=>void n(),750)})();</script>`;
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
