import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesCss = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

describe('styles.css', () => {
  it('uses the system ui sans stack by default for Chinese locales', () => {
    expect(stylesCss).toContain(':root:lang(zh)');
    expect(stylesCss).toContain('--vd-font-sans: ui-sans-serif, system-ui, sans-serif');
  });

  it('keeps input borders visible when focused', () => {
    expect(stylesCss).toContain("input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file']):not([type='hidden']):focus");
    expect(stylesCss).toContain('textarea:focus-visible');
    expect(stylesCss).toContain('border-color: var(--border-2)');
  });

  it('sets every button default radius to six pixels', () => {
    expect(stylesCss).toContain('--project-button-radius: 6px');
    expect(stylesCss).toContain('--project-radius-lg: 8px');
    expect(stylesCss).toContain('--project-shadow-popover: 0 4px 8px');
    expect(stylesCss).toContain('--project-font-body: 13px');
    expect(stylesCss).toContain('button[class]');
    expect(stylesCss).toContain('border-radius: var(--project-button-radius)');
  });

  it('keeps secondary button surfaces aligned with the accent color', () => {
    expect(stylesCss).toContain('--project-input-bg: rgb(246 244 241)');
    expect(stylesCss).toContain('--project-workspace-bg: rgb(252 250 248)');
    expect(stylesCss).toContain('--project-secondary-bg: var(--project-primary-alpha-8)');
    expect(stylesCss).toContain('--project-secondary-hover-bg: var(--project-primary-alpha-12)');
    expect(stylesCss).toContain('--project-secondary-disabled-bg: var(--project-primary-alpha-4)');
    expect(stylesCss).toContain('--project-message-border: rgb(238 235 230)');
  });

  it('defines orange-brown primary tokens from the shared rgb base', () => {
    expect(stylesCss).toContain('--project-primary-rgb: 194 62 1');
    expect(stylesCss).toContain('--project-primary: rgb(var(--project-primary-rgb))');
    expect(stylesCss).toContain('--project-primary-alpha-4: rgb(var(--project-primary-rgb) / 0.04)');
    expect(stylesCss).toContain('--project-primary-alpha-8: rgb(var(--project-primary-rgb) / 0.08)');
    expect(stylesCss).toContain('--project-primary-alpha-10: rgb(var(--project-primary-rgb) / 0.1)');
    expect(stylesCss).toContain('--project-primary-alpha-12: rgb(var(--project-primary-rgb) / 0.12)');
    expect(stylesCss).toContain('--project-primary-alpha-16: rgb(var(--project-primary-rgb) / 0.16)');
    expect(stylesCss).toContain('--project-primary-alpha-24: rgb(var(--project-primary-rgb) / 0.24)');
    expect(stylesCss).toContain('--project-primary-alpha-32: rgb(var(--project-primary-rgb) / 0.32)');
    expect(stylesCss).toContain('--project-primary-alpha-40: rgb(var(--project-primary-rgb) / 0.4)');
    expect(stylesCss).toContain('--project-primary-bg: var(--project-primary)');
    expect(stylesCss).toContain('--project-accent: var(--project-primary)');
    expect(stylesCss).toContain('--project-comment-marker-bg: var(--project-primary)');
    expect(stylesCss).toContain('--primary: var(--project-primary)');
  });
});
