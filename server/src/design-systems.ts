import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, type FrontmatterObject } from './frontmatter.js';

export type DesignSystemSource = 'built-in' | 'user';
export type DesignSystemStatus = 'published' | 'draft';
export type DesignSystemImportMode = 'normalized' | 'hybrid' | 'verbatim';

export interface DesignSystemSummary {
  id: string;
  title: string;
  category: string;
  summary: string;
  swatches: string[];
  source: DesignSystemSource;
  status: DesignSystemStatus;
  isEditable: boolean;
  body: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DesignSystemManifest {
  schemaVersion?: string;
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  files?: {
    design?: string;
    tokens?: string;
    components?: string;
  };
  usage?: string;
  importMode?: DesignSystemImportMode;
  status?: DesignSystemStatus;
  createdAt?: string;
  updatedAt?: string;
  i18n?: Record<string, DesignSystemLocaleOverride>;
}

export interface DesignSystemLocaleOverride {
  name?: string;
  category?: string;
  description?: string;
  files?: {
    design?: string;
    tokens?: string;
    components?: string;
  };
  usage?: string;
}

export interface DesignSystemPackageInfo {
  manifest?: DesignSystemManifest;
}

export interface DesignSystemAssets {
  usageMd?: string;
  tokensCss?: string;
  fixtureHtml?: string;
  componentsManifest?: string;
  importMode?: DesignSystemImportMode;
}

export interface DesignSystemDetail extends DesignSystemSummary {
  packageInfo?: DesignSystemPackageInfo;
}

interface ListRootOptions {
  source: DesignSystemSource;
  isEditable: boolean;
  status: DesignSystemStatus;
  idPrefix?: string;
  locale?: string;
}

const DESIGN_SYSTEM_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const USER_DESIGN_SYSTEM_ID_PREFIX = 'user:';

export async function listAvailableDesignSystems(input: {
  builtInRoot: string;
  userRoot: string;
  locale?: string;
}): Promise<DesignSystemSummary[]> {
  const [userSystems, builtInSystems] = await Promise.all([
    listDesignSystems(input.userRoot, {
      source: 'user',
      isEditable: true,
      status: 'draft',
      idPrefix: USER_DESIGN_SYSTEM_ID_PREFIX,
      locale: input.locale,
    }),
    listDesignSystems(input.builtInRoot, {
      source: 'built-in',
      isEditable: false,
      status: 'published',
      locale: input.locale,
    }),
  ]);
  const userIds = new Set(userSystems.map((system) => system.id));
  return [
    ...userSystems.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')),
    ...builtInSystems.filter((system) => !userIds.has(system.id)),
  ];
}

export async function listDesignSystems(
  root: string,
  options: ListRootOptions,
): Promise<DesignSystemSummary[]> {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const systems: DesignSystemSummary[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!isSafeDesignSystemId(id)) continue;

    const brandRoot = path.join(root, id);
    const manifest = await readDesignSystemManifest(brandRoot);
    const designPath = resolveDesignFilePath(manifest, options.locale);
    const body = await readPackageFile(brandRoot, designPath);
    if (!body) continue;

    systems.push(buildSummary(id, body, manifest, options));
  }

  return systems;
}

export async function readAvailableDesignSystemDetail(input: {
  builtInRoot: string;
  userRoot: string;
  id: string;
  locale?: string;
}): Promise<DesignSystemDetail | null> {
  const systems = await listAvailableDesignSystems({
    builtInRoot: input.builtInRoot,
    userRoot: input.userRoot,
    locale: input.locale,
  });
  const summary = systems.find((system) => system.id === input.id);
  if (!summary) return null;

  const packageInfo = await readAvailableDesignSystemPackageInfo(input);
  return {
    ...summary,
    ...(packageInfo ? { packageInfo } : {}),
  };
}

export async function readAvailableDesignSystemBody(input: {
  builtInRoot: string;
  userRoot: string;
  id: string;
  locale?: string;
}): Promise<string | null> {
  if (input.id.startsWith(USER_DESIGN_SYSTEM_ID_PREFIX)) {
    return readDesignSystemBody(input.userRoot, input.id, input.locale);
  }

  return (
    (await readDesignSystemBody(input.builtInRoot, input.id, input.locale))
    ?? (await readDesignSystemBody(input.userRoot, input.id, input.locale))
  );
}

export async function readAvailableDesignSystemPackageInfo(input: {
  builtInRoot: string;
  userRoot: string;
  id: string;
}): Promise<DesignSystemPackageInfo | null> {
  if (input.id.startsWith(USER_DESIGN_SYSTEM_ID_PREFIX)) {
    return readDesignSystemPackageInfo(input.userRoot, input.id);
  }

  return (
    (await readDesignSystemPackageInfo(input.builtInRoot, input.id))
    ?? (await readDesignSystemPackageInfo(input.userRoot, input.id))
  );
}

export async function resolveDesignSystemAssets(input: {
  builtInRoot: string;
  userRoot: string;
  id: string;
  locale?: string;
}): Promise<DesignSystemAssets> {
  if (input.id.startsWith(USER_DESIGN_SYSTEM_ID_PREFIX)) {
    return readDesignSystemAssets(input.userRoot, input.id, input.locale);
  }

  const builtIn = await readDesignSystemAssets(input.builtInRoot, input.id, input.locale);
  const user = await readDesignSystemAssets(input.userRoot, input.id, input.locale);
  return {
    usageMd: builtIn.usageMd ?? user.usageMd,
    tokensCss: builtIn.tokensCss ?? user.tokensCss,
    fixtureHtml: builtIn.fixtureHtml ?? user.fixtureHtml,
    componentsManifest: builtIn.componentsManifest ?? user.componentsManifest,
    importMode: builtIn.importMode ?? user.importMode,
  };
}

export interface UserDesignSystemInput {
  title?: string;
  category?: string;
  summary?: string;
  body?: string;
  status?: DesignSystemStatus;
}

export async function createUserDesignSystem(root: string, input: UserDesignSystemInput): Promise<DesignSystemDetail> {
  const title = cleanInline(input.title ?? '').trim();
  if (!title) {
    throw new Error('design system title is required');
  }

  await mkdir(root, { recursive: true });
  const slug = await nextAvailableUserDesignSystemSlug(root, slugifyDesignSystemTitle(title));
  const now = new Date().toISOString();
  await writeUserDesignSystemPackage(root, slug, {
    ...input,
    title,
    status: normalizeStatus(input.status) ?? 'draft',
    createdAt: now,
    updatedAt: now,
  });
  const detail = await readAvailableDesignSystemDetail({
    builtInRoot: '',
    userRoot: root,
    id: `${USER_DESIGN_SYSTEM_ID_PREFIX}${slug}`,
  });
  if (!detail) {
    throw new Error('created design system could not be read');
  }
  return detail;
}

export async function updateUserDesignSystem(
  root: string,
  id: string,
  input: UserDesignSystemInput,
): Promise<DesignSystemDetail | null> {
  const slug = stripDesignSystemIdPrefix(id, USER_DESIGN_SYSTEM_ID_PREFIX);
  if (!slug) return null;

  const brandRoot = path.join(root, slug);
  const currentBody = await readDesignSystemBody(root, id);
  const currentManifest = await readDesignSystemManifest(brandRoot);
  if (!currentBody) return null;

  await writeUserDesignSystemPackage(root, slug, {
    title: input.title ?? currentManifest?.name ?? extractTitle(currentBody) ?? slug,
    category: input.category ?? currentManifest?.category ?? extractCategory(currentBody) ?? 'Design style',
    summary: input.summary ?? currentManifest?.description ?? extractSummary(currentBody) ?? '',
    body: input.body ?? currentBody,
    status: normalizeStatus(input.status) ?? currentManifest?.status ?? 'draft',
    createdAt: currentManifest?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return readAvailableDesignSystemDetail({
    builtInRoot: '',
    userRoot: root,
    id: `${USER_DESIGN_SYSTEM_ID_PREFIX}${slug}`,
  });
}

export async function deleteUserDesignSystem(root: string, id: string): Promise<boolean> {
  const slug = stripDesignSystemIdPrefix(id, USER_DESIGN_SYSTEM_ID_PREFIX);
  if (!slug) return false;

  try {
    await rm(path.join(root, slug), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function readDesignSystemBody(root: string, id: string, locale?: string): Promise<string | null> {
  const brandRoot = resolveBrandRoot(root, id);
  if (!brandRoot) return null;
  const manifest = await readDesignSystemManifest(brandRoot);
  return readPackageFile(brandRoot, resolveDesignFilePath(manifest, locale));
}

async function readDesignSystemPackageInfo(root: string, id: string): Promise<DesignSystemPackageInfo | null> {
  const brandRoot = resolveBrandRoot(root, id);
  if (!brandRoot) return null;
  const manifest = await readDesignSystemManifest(brandRoot);
  return manifest ? { manifest } : null;
}

async function readDesignSystemAssets(root: string, id: string, locale?: string): Promise<DesignSystemAssets> {
  const brandRoot = resolveBrandRoot(root, id);
  if (!brandRoot) return {};
  const manifest = await readDesignSystemManifest(brandRoot);
  const localized = resolveManifestLocale(manifest, locale);
  const [usageMd, tokensCss, fixtureHtml] = await Promise.all([
    readPackageFile(brandRoot, localized?.usage ?? manifest?.usage ?? 'USAGE.md'),
    readPackageFile(brandRoot, manifest?.files?.tokens ?? 'tokens.css'),
    resolveComponentsFilePath(manifest, localized) === null
      ? Promise.resolve(null)
      : readPackageFile(brandRoot, resolveComponentsFilePath(manifest, localized) ?? 'components.html'),
  ]);
  return {
    ...(usageMd ? { usageMd } : {}),
    ...(tokensCss ? { tokensCss } : {}),
    ...(fixtureHtml ? { fixtureHtml } : {}),
    ...(fixtureHtml ? { componentsManifest: summarizeFixture(id, fixtureHtml) } : {}),
    ...(manifest?.importMode ? { importMode: manifest.importMode } : {}),
  };
}

export function renderDesignSystemPreview(id: string, body: string): string {
  const title = extractTitle(body) || id;
  const summary = extractSummary(body);
  const swatches = extractSwatches(body).slice(0, 12);
  const primary = swatches[0] ?? '#f8fafc';
  const ink = swatches[1] ?? '#111827';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} preview</title>
  <style>
    :root { color-scheme: light; --preview-bg: ${primary}; --preview-ink: ${ink}; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Lexend Variable", "Lexend", ui-sans-serif, system-ui, sans-serif; background: var(--preview-bg); color: var(--preview-ink); }
    main { max-width: 920px; margin: 0 auto; padding: 56px 28px 88px; }
    .eyebrow { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; opacity: .68; }
    h1 { margin: 16px 0 12px; font-size: clamp(40px, 8vw, 72px); line-height: 1; letter-spacing: 0; }
    .summary { max-width: 62ch; font-size: 18px; line-height: 1.6; opacity: .78; }
    .palette { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; margin-top: 40px; }
    .swatch { overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 8px; background: color-mix(in srgb, white 72%, transparent); }
    .chip { height: 96px; }
    .label { padding: 10px 12px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { margin-top: 40px; overflow: auto; border-radius: 8px; padding: 18px; background: color-mix(in srgb, white 70%, transparent); }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Design style preview - ${escapeHtml(id)}</div>
    <h1>${escapeHtml(title)}</h1>
    ${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ''}
    <section class="palette" aria-label="Palette">
      ${swatches.map((swatch) => `<div class="swatch"><div class="chip" style="background:${escapeHtml(swatch)}"></div><div class="label">${escapeHtml(swatch)}</div></div>`).join('')}
    </section>
    <pre>${escapeHtml(body)}</pre>
  </main>
</body>
</html>`;
}

function buildSummary(
  id: string,
  raw: string,
  manifest: DesignSystemManifest | null,
  options: ListRootOptions,
): DesignSystemSummary {
  const { frontmatter, body } = parseFrontmatter(raw);
  const localized = resolveManifestLocale(manifest, options.locale);
  const title = localized?.name ?? manifest?.name ?? stringField(frontmatter, 'name') ?? extractTitle(body) ?? id;
  const status = normalizeStatus(manifest?.status) ?? options.status;
  return {
    id: `${options.idPrefix ?? ''}${id}`,
    title: cleanInline(title),
    category: localized?.category ?? manifest?.category ?? stringField(frontmatter, 'category') ?? extractCategory(body) ?? 'Design style',
    summary: localized?.description ?? manifest?.description ?? stringField(frontmatter, 'description') ?? extractSummary(body) ?? '',
    swatches: extractSwatches(raw),
    source: options.source,
    status,
    isEditable: options.isEditable,
    body: raw,
    ...(manifest?.createdAt ? { createdAt: manifest.createdAt } : {}),
    ...(manifest?.updatedAt ? { updatedAt: manifest.updatedAt } : {}),
  };
}

async function readDesignSystemManifest(brandRoot: string): Promise<DesignSystemManifest | null> {
  const raw = await readPackageFile(brandRoot, 'manifest.json');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DesignSystemManifest;
    return normalizeManifest(parsed);
  } catch {
    return null;
  }
}

function normalizeManifest(value: DesignSystemManifest): DesignSystemManifest {
  const importMode = value.importMode;
  return {
    ...value,
    ...(importMode === 'normalized' || importMode === 'hybrid' || importMode === 'verbatim'
      ? { importMode }
      : { importMode: undefined }),
  };
}

function resolveDesignFilePath(manifest: DesignSystemManifest | null, locale?: string): string {
  return resolveManifestLocale(manifest, locale)?.files?.design ?? manifest?.files?.design ?? 'DESIGN.md';
}

function resolveComponentsFilePath(
  manifest: DesignSystemManifest | null,
  localized: DesignSystemLocaleOverride | null,
): string | null {
  if (localized?.files?.components) {
    return localized.files.components;
  }
  if (manifest?.files?.components) {
    return manifest.files.components;
  }
  if (manifest === null) {
    return 'components.html';
  }
  return null;
}

function resolveManifestLocale(
  manifest: DesignSystemManifest | null,
  locale?: string,
): DesignSystemLocaleOverride | null {
  if (!manifest?.i18n || !locale) {
    return null;
  }

  for (const candidate of localeCandidates(locale)) {
    const localized = manifest.i18n[candidate];
    if (localized) {
      return localized;
    }
  }

  return null;
}

function localeCandidates(locale: string): string[] {
  const normalized = locale.trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  const base = normalized.split('-')[0];
  if (base && base !== normalized) {
    candidates.push(base);
  }
  return candidates;
}

async function readPackageFile(root: string, relativePath: string): Promise<string | null> {
  const safePath = sanitizeRelativePath(relativePath);
  if (!safePath) return null;
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(root, safePath);
  if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function resolveBrandRoot(root: string, id: string): string | null {
  const slug = normalizeDesignSystemSlug(id);
  if (!slug) return null;
  return path.join(root, slug);
}

export function isSafeDesignSystemId(id: string): boolean {
  return normalizeDesignSystemSlug(id) !== null;
}

function sanitizeRelativePath(value: string): string | null {
  if (!value || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  if (normalized.startsWith('..') || normalized.includes(`${path.sep}..${path.sep}`)) return null;
  return normalized;
}

function extractTitle(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match?.[1] ? cleanInline(match[1]) : null;
}

function extractCategory(body: string): string | null {
  const match = /^>\s*Category:\s*(.+?)\s*$/im.exec(body);
  return match?.[1] ? cleanInline(match[1]) : null;
}

function extractSummary(body: string): string | null {
  const withoutTitle = body.replace(/^#\s+.+?\s*$/m, '');
  const paragraph = withoutTitle
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith('>') && !part.startsWith('#'));
  return paragraph ? cleanInline(paragraph.replace(/^[-*]\s+/gm, '')) : null;
}

function extractSwatches(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of raw.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const color = match[0].toLowerCase();
    if (seen.has(color)) continue;
    seen.add(color);
    out.push(color);
  }
  return out;
}

function normalizeDesignSystemSlug(id: string): string | null {
  const slug = id.startsWith(USER_DESIGN_SYSTEM_ID_PREFIX)
    ? id.slice(USER_DESIGN_SYSTEM_ID_PREFIX.length)
    : id;
  if (
    slug.length === 0 ||
    slug.length > 128 ||
    !DESIGN_SYSTEM_ID_PATTERN.test(slug) ||
    /^\.+$/.test(slug)
  ) {
    return null;
  }
  return slug;
}

function stripDesignSystemIdPrefix(id: string, prefix: string): string | null {
  if (!id.startsWith(prefix)) return null;
  const slug = id.slice(prefix.length);
  return normalizeDesignSystemSlug(slug);
}

function normalizeStatus(value: unknown): DesignSystemStatus | undefined {
  return value === 'published' || value === 'draft' ? value : undefined;
}

function slugifyDesignSystemTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'design-system';
}

async function nextAvailableUserDesignSystemSlug(root: string, baseSlug: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      await stat(path.join(root, slug));
    } catch {
      return slug;
    }
  }
  throw new Error('could not allocate design system id');
}

async function writeUserDesignSystemPackage(
  root: string,
  slug: string,
  input: Required<Pick<UserDesignSystemInput, 'title'>> & UserDesignSystemInput & {
    createdAt: string;
    updatedAt: string;
  },
): Promise<void> {
  const dir = path.join(root, slug);
  await mkdir(dir, { recursive: true });
  const title = cleanInline(input.title);
  const category = cleanInline(input.category ?? 'Design style');
  const summary = cleanInline(input.summary ?? '');
  const body = input.body?.trim() || renderDefaultDesignSystemBody(title, category, summary);
  const manifest: DesignSystemManifest = {
    schemaVersion: 'vibe-design-system/v1',
    id: slug,
    name: title,
    category,
    description: summary || extractSummary(body) || '',
    files: {
      design: 'DESIGN.md',
      tokens: 'tokens.css',
      components: 'components.html',
    },
    usage: 'USAGE.md',
    importMode: 'normalized',
    status: normalizeStatus(input.status) ?? 'draft',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };

  await Promise.all([
    writeFile(path.join(dir, 'DESIGN.md'), `${body}\n`, 'utf8'),
    writeFile(path.join(dir, 'USAGE.md'), renderDefaultUsageMd(title), 'utf8'),
    writeFile(path.join(dir, 'tokens.css'), renderDefaultTokensCss(), 'utf8'),
    writeFile(path.join(dir, 'components.html'), renderDefaultComponentsHtml(title), 'utf8'),
    writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ]);
}

function renderDefaultDesignSystemBody(title: string, category: string, summary: string): string {
  return [
    `# ${title}`,
    '',
    `> Category: ${category}`,
    '',
    summary || 'A user-authored design system.',
    '',
    '## Color',
    '',
    '- Canvas: #f7f8fb',
    '- Ink: #111827',
    '- Accent: #2563eb',
    '',
    '## Typography',
    '',
    'Use system UI fonts with compact, legible headings and body copy.',
    '',
    '## Components',
    '',
    'Use the token contract in `tokens.css` for buttons, cards, fields, and panels.',
  ].join('\n');
}

function renderDefaultUsageMd(title: string): string {
  return `Use ${title} as the active visual source of truth. Start from tokens.css before inventing new colors, spacing, or component styling.\n`;
}

function renderDefaultTokensCss(): string {
  return [
    ':root {',
    '  --vd-canvas: #f7f8fb;',
    '  --vd-ink: #111827;',
    '  --vd-panel: #ffffff;',
    '  --vd-border: #d8dde8;',
    '  --vd-muted: #64748b;',
    '  --vd-accent: #2563eb;',
    '  --vd-accent-ink: #ffffff;',
    '  --vd-radius-sm: 6px;',
    '  --vd-radius-md: 8px;',
    '  --vd-shadow-panel: 0 18px 48px rgba(15, 23, 42, 0.08);',
    '}',
    '',
  ].join('\n');
}

function renderDefaultComponentsHtml(title: string): string {
  return [
    '<section class="vd-panel">',
    '  <div class="vd-card">',
    `    <p class="vd-eyebrow">${escapeHtml(title)}</p>`,
    '    <h2 class="vd-title">Design style preview</h2>',
    '    <p class="vd-copy">Use calm surfaces, compact controls, and visible state.</p>',
    '    <button class="vd-button-primary">Create artifact</button>',
    '  </div>',
    '</section>',
    '',
  ].join('\n');
}

function summarizeFixture(id: string, fixtureHtml: string): string {
  const classNames = new Set<string>();
  for (const match of fixtureHtml.matchAll(/class=["']([^"']+)["']/g)) {
    for (const className of (match[1] ?? '').split(/\s+/)) {
      if (className.trim()) classNames.add(`.${className.trim()}`);
    }
  }
  const selectors = [...classNames].slice(0, 24);
  return [
    `components.manifest schema v1 for ${id}`,
    selectors.length > 0 ? `Selectors: ${selectors.join(', ')}` : 'Selectors: none detected',
    'Fixture:',
    fixtureHtml.trim(),
  ].join('\n');
}

function stringField(frontmatter: FrontmatterObject, key: string): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
