import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter';

export type SkillMode =
  | 'prototype'
  | 'deck'
  | 'image'
  | 'video'
  | 'audio'
  | 'template'
  | 'design-system';
export type SkillSurface = 'web' | 'image' | 'video' | 'audio';
export type SkillSource = 'user' | 'built-in';
export type SkillPlatform = 'desktop' | 'mobile' | null;
export type SkillCritiquePolicy = 'required' | 'opt-out' | 'opt-in' | null;

export interface SkillInfo {
  id: string;
  name: string;
  displayName?: Record<string, string>;
  description: string;
  descriptionI18n?: Record<string, string>;
  triggers: unknown[];
  mode: SkillMode;
  surface: SkillSurface;
  source: SkillSource;
  craftRequires: string[];
  platform: SkillPlatform;
  scenario: string;
  category: string | null;
  previewType: string;
  designSystemRequired: boolean;
  defaultFor: string[];
  upstream: string | null;
  featured: number | null;
  fidelity: 'wireframe' | 'high-fidelity' | null;
  speakerNotes: boolean | null;
  animations: boolean | null;
  examplePrompt: string;
  examplePromptI18n?: Record<string, string>;
  aggregatesExamples: boolean;
  critiquePolicy: SkillCritiquePolicy;
  body: string;
  dir: string;
}

export interface DerivedSkillIdParts {
  parentId: string;
  childKey: string;
}

export interface ImportUserSkillInput {
  name: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface ImportedUserSkill {
  id: string;
  slug: string;
  dir: string;
}

type FrontmatterRecord = Record<string, unknown>;

export const SKILL_ID_ALIASES = Object.freeze({
  'editorial-collage': 'vibe-design-landing',
  'editorial-collage-deck': 'vibe-design-landing-deck',
});

const VALID_MODES = new Set<SkillMode>([
  'prototype',
  'deck',
  'image',
  'video',
  'audio',
  'template',
  'design-system',
]);
const VALID_SURFACES = new Set<SkillSurface>(['web', 'image', 'video', 'audio']);
const VALID_PLATFORMS = new Set<Exclude<SkillPlatform, null>>(['desktop', 'mobile']);
const VALID_FIDELITY = new Set<NonNullable<SkillInfo['fidelity']>>([
  'wireframe',
  'high-fidelity',
]);
const VALID_CRITIQUE = new Set<Exclude<SkillCritiquePolicy, null>>([
  'required',
  'opt-out',
  'opt-in',
]);

export function resolveSkillId(id: string): string {
  return SKILL_ID_ALIASES[id as keyof typeof SKILL_ID_ALIASES] ?? id;
}

export function findSkillById(
  skills: readonly SkillInfo[],
  id: string,
): SkillInfo | undefined {
  return skills.find((skill) => skill.id === resolveSkillId(id));
}

export async function listSkills(
  skillsRoots: string | readonly string[],
): Promise<SkillInfo[]> {
  const roots = Array.isArray(skillsRoots) ? skillsRoots : [skillsRoots];
  const listed: SkillInfo[] = [];
  const seenIds = new Set<string>();

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    if (!root) {
      continue;
    }

    const source: SkillSource = rootIndex === 0 ? 'user' : 'built-in';
    let entries: Dirent[];

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) {
        continue;
      }

      const dir = join(root, entry.name);
      const skill = await readSkillDirectory(dir, source);
      if (!skill || seenIds.has(skill.id)) {
        continue;
      }

      const derivedExamples = await collectDerivedExamples(dir);
      listed.push({ ...skill, aggregatesExamples: derivedExamples.length > 0 });
      seenIds.add(skill.id);

      for (const example of derivedExamples) {
        const id = `${skill.id}:${example.key}`;
        if (seenIds.has(id)) {
          continue;
        }

        listed.push({
          ...skill,
          id,
          name: humanizeExampleKey(example.key),
          craftRequires: [],
          defaultFor: [],
          featured: null,
          aggregatesExamples: false,
        });
        seenIds.add(id);
      }
    }
  }

  return listed;
}

export function splitDerivedSkillId(id: unknown): DerivedSkillIdParts | null {
  if (typeof id !== 'string') {
    return null;
  }

  const separator = id.indexOf(':');
  if (separator <= 0 || separator === id.length - 1) {
    return null;
  }

  const parentId = id.slice(0, separator);
  const childKey = id.slice(separator + 1);

  if (!isSafeExampleKey(childKey)) {
    return null;
  }

  return { parentId, childKey };
}

export function resolveDerivedExamplePath(
  parentDir: string,
  childKey: string,
): string | null {
  if (!isSafeExampleKey(childKey)) {
    return null;
  }

  return join(parentDir, 'examples', `${childKey}.html`);
}

export async function importUserSkill(
  userRoot: string,
  input: ImportUserSkillInput,
): Promise<ImportedUserSkill> {
  const slug = slugifySkillName(input.name);
  if (!slug) {
    throw new Error('Skill name must contain at least one letter or number.');
  }

  const body = input.body.trim();
  if (!body) {
    throw new Error('Skill body is required.');
  }

  const dir = join(userRoot, slug);
  await mkdir(userRoot, { recursive: true });
  try {
    await mkdir(dir);
  } catch (error) {
    if (isFileAlreadyExistsError(error)) {
      throw new Error(`Skill import conflict: ${slug} already exists.`);
    }

    throw error;
  }
  await writeFile(
    join(dir, 'SKILL.md'),
    renderUserSkillMarkdown({
      name: slug,
      description: input.description ?? '',
      triggers: input.triggers ?? [],
      body,
    }),
    'utf8',
  );

  return { id: slug, slug, dir };
}

export async function deleteUserSkill(
  skills: readonly SkillInfo[],
  id: string,
): Promise<void> {
  const skill = findSkillById(skills, id);

  if (!skill) {
    throw new Error(`Skill not found: ${id}`);
  }

  if (skill.source !== 'user') {
    throw new Error(`Cannot delete built-in skill: ${skill.id}`);
  }

  await rm(skill.dir, { recursive: true, force: true });
}

async function readSkillDirectory(
  dir: string,
  source: SkillSource,
): Promise<SkillInfo | null> {
  try {
    const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    return buildSkillInfo(frontmatter, body, source, dir);
  } catch {
    return null;
  }
}

function buildSkillInfo(
  frontmatter: FrontmatterRecord,
  body: string,
  source: SkillSource,
  dir: string,
): SkillInfo | null {
  const od = asRecord(frontmatter.od);
  const id = asNonEmptyString(frontmatter.name);
  const description = stringOrEmpty(frontmatter.description);
  const triggers = normalizeTriggers(frontmatter.triggers);

  if (!id || !triggers) {
    return null;
  }

  const mode = normalizeMode(od.mode);
  const surface = normalizeSurface(od.surface, mode);
  const displayName = localizedFromFields(frontmatter.en_name, frontmatter.zh_name);
  const descriptionI18n = localizedFromFields(
    frontmatter.en_description,
    frontmatter.zh_description,
  );
  const examplePromptI18n = localizedFromRecord(od.example_prompt_i18n);

  return {
    id,
    name: id,
    ...(displayName ? { displayName } : {}),
    description,
    ...(descriptionI18n ? { descriptionI18n } : {}),
    triggers,
    mode,
    surface,
    source,
    craftRequires: normalizeSlugList(asRecord(od.craft).requires),
    platform: normalizePlatform(od.platform),
    scenario: stringOrEmpty(od.scenario),
    category: nullableString(od.category),
    previewType: stringOrDefault(asRecord(od.preview).type, 'html'),
    designSystemRequired: booleanOrDefault(
      asRecord(od.design_system).required,
      true,
    ),
    defaultFor: normalizeStringList(od.default_for),
    upstream: nullableString(od.upstream),
    featured: normalizeFeatured(od.featured),
    fidelity: normalizeLiteral(od.fidelity, VALID_FIDELITY, null),
    speakerNotes: normalizeBooleanHint(od.speaker_notes),
    animations: normalizeBooleanHint(od.animations),
    examplePrompt: deriveExamplePrompt(od.example_prompt, description),
    ...(examplePromptI18n ? { examplePromptI18n } : {}),
    aggregatesExamples: false,
    critiquePolicy: normalizeLiteral(
      asRecord(od.critique).policy,
      VALID_CRITIQUE,
      null,
    ),
    body,
    dir,
  };
}

async function collectDerivedExamples(dir: string): Promise<Array<{ key: string }>> {
  let entries: Dirent[];

  try {
    entries = await readdir(join(dir, 'examples'), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith('.html'))
    .map((name) => name.replace(/\.html$/i, ''))
    .filter(isSafeExampleKey)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({ key }));
}

function asRecord(value: unknown): FrontmatterRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as FrontmatterRecord;
  }

  return {};
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrDefault(value: unknown, fallback: string): string {
  const text = asNonEmptyString(value);
  return text ?? fallback;
}

function nullableString(value: unknown): string | null {
  return asNonEmptyString(value);
}

function normalizeTriggers(value: unknown): unknown[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    return null;
  }

  return value;
}

function normalizeMode(value: unknown): SkillMode {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return VALID_MODES.has(normalized as SkillMode)
    ? (normalized as SkillMode)
    : 'prototype';
}

function normalizeSurface(value: unknown, mode: SkillMode): SkillSurface {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (VALID_SURFACES.has(normalized as SkillSurface)) {
    return normalized as SkillSurface;
  }

  if (mode === 'image' || mode === 'video' || mode === 'audio') {
    return mode;
  }

  return 'web';
}

function normalizePlatform(value: unknown): SkillPlatform {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return VALID_PLATFORMS.has(normalized as Exclude<SkillPlatform, null>)
    ? (normalized as Exclude<SkillPlatform, null>)
    : null;
}

function normalizeStringList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  const rawItems = Array.isArray(value) ? value : [value];
  return rawItems
    .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
    .filter(Boolean);
}

function normalizeSlugList(value: unknown): string[] {
  const seen = new Set<string>();
  const slugs: string[] = [];

  for (const item of normalizeStringList(value)) {
    const slug = item.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    slugs.push(slug);
  }

  return slugs;
}

function normalizeFeatured(value: unknown): number | null {
  if (value === true) {
    return 1;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeBooleanHint(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1'].includes(normalized)) {
    return true;
  }

  if (['false', 'no', '0'].includes(normalized)) {
    return false;
  }

  return null;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeLiteral<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T | null,
): T | null {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return allowed.has(normalized as T) ? (normalized as T) : fallback;
}

function localizedFromFields(
  enValue: unknown,
  zhValue: unknown,
): Record<string, string> | undefined {
  const localized: Record<string, string> = {};
  const en = asNonEmptyString(enValue);
  const zh = asNonEmptyString(zhValue);

  if (en) {
    localized.en = en;
  }

  if (zh) {
    localized['zh-CN'] = zh;
  }

  return Object.keys(localized).length > 0 ? localized : undefined;
}

function localizedFromRecord(value: unknown): Record<string, string> | undefined {
  const source = asRecord(value);
  const localized: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    const text = asNonEmptyString(rawValue);
    if (text) {
      localized[key] = text;
    }
  }

  return Object.keys(localized).length > 0 ? localized : undefined;
}

function deriveExamplePrompt(value: unknown, description: string): string {
  const explicit = asNonEmptyString(value);
  if (explicit) {
    return explicit;
  }

  const compact = description.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  return compact.match(/^.+?[.!?。！？](?:\s|$)/)?.[0]?.trim() ?? compact;
}

function isSafeExampleKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith('.') &&
    !key.includes(':') &&
    /^[A-Za-z0-9._-]+$/.test(key)
  );
}

function humanizeExampleKey(key: string): string {
  return key
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderUserSkillMarkdown(input: {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}): string {
  const lines = [
    '---',
    `name: ${quoteYaml(input.name)}`,
    `description: ${quoteYaml(input.description)}`,
  ];

  if (input.triggers.length > 0) {
    lines.push('triggers:');
    for (const trigger of input.triggers) {
      lines.push(`  - ${quoteYaml(trigger)}`);
    }
  }

  lines.push('---', input.body);
  return lines.join('\n');
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}
