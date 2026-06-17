// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHostLocale, readInitialLocale, subscribeHostLocale } from './runtime';

const originalLanguageDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
const originalLanguagesDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');

afterEach(() => {
  delete window.tuttiExternal;
  document.documentElement.removeAttribute('lang');
  restoreNavigatorProperty('language', originalLanguageDescriptor);
  restoreNavigatorProperty('languages', originalLanguagesDescriptor);
});

describe('Prototype Design i18n runtime', () => {
  it('keeps the server-rendered document language ahead of browser language fallback', () => {
    document.documentElement.lang = 'en';
    setNavigatorProperty('language', 'zh-CN');
    setNavigatorProperty('languages', ['zh-CN']);

    expect(readInitialLocale()).toBe('en');
  });

  it('reads locale from the Tutti app context before browser fallback', async () => {
    window.tuttiExternal = {
      app: {
        getContext: async () => ({ locale: 'zh-CN' }),
      },
    };

    await expect(readHostLocale()).resolves.toBe('zh-CN');
  });

  it('subscribes to locale changes through the Tutti external app context', () => {
    const unsubscribe = vi.fn();
    const listener = vi.fn();
    window.tuttiExternal = {
      app: {
        subscribe(callback) {
          callback({ locale: 'zh-CN' });
          return unsubscribe;
        },
      },
    };

    expect(subscribeHostLocale(listener)).toBe(unsubscribe);
    expect(listener).toHaveBeenCalledWith('zh-CN');
  });

});

function setNavigatorProperty(key: 'language' | 'languages', value: unknown): void {
  Object.defineProperty(Navigator.prototype, key, {
    configurable: true,
    get: () => value,
  });
}

function restoreNavigatorProperty(
  key: 'language' | 'languages',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(Navigator.prototype, key, descriptor);
  } else {
    delete (Navigator.prototype as Partial<Navigator>)[key];
  }
}
