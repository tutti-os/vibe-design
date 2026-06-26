import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillMaterializationFile, SkillMaterializationRecord } from '@tutti-os/agent-acp-kit';

const execFileAsync = promisify(execFile);
const TUTTI_SKILL_BUNDLE_TIMEOUT_MS = 10_000;
const TUTTI_SKILL_BUNDLE_MAX_BUFFER = 1024 * 1024;
const FALLBACK_RECOMMENDED_SYSTEM_PROMPT = [
  'Tutti workspace context may be available through injected Tutti skills.',
  'When a request contains a mention:// URI, do not treat it as plain text or ask the user to paste the target content.',
  'First read the injected Tutti skills and use the documented Tutti CLI command to recover the referenced context.',
].join('\n');

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; maxBuffer: number; timeout: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface ResolveTuttiAgentSkillManifestInput {
  agentSessionId?: string | null;
  provider: string;
  command?: string | null;
  cwd?: string | null;
  execFileAsync?: ExecFileAsync;
}

export interface TuttiRecommendedSystemPrompt {
  content: string;
  format?: string;
}

export interface ResolvedTuttiAgentSkillBundle {
  skills: SkillMaterializationRecord[];
  recommendedSystemPrompt?: TuttiRecommendedSystemPrompt;
}

export function configuredTuttiCliPath(): string {
  return process.env.VIBE_TUTTI_CLI?.trim() || process.env.TUTTI_CLI?.trim() || '';
}

export function tuttiCliEnv(): Record<string, string> {
  const command = configuredTuttiCliPath();
  return command ? { TUTTI_CLI: command } : {};
}

export async function resolveTuttiAgentSkillBundle(
  input: ResolveTuttiAgentSkillManifestInput,
): Promise<ResolvedTuttiAgentSkillBundle> {
  const command = (input.command ?? configuredTuttiCliPath()).trim();
  if (!command) {
    return { skills: [] };
  }
  const agentSessionId = input.agentSessionId?.trim();
  const cwd = input.cwd?.trim() || undefined;
  const commandArgs = [
    [
      'agent',
      'tutti-cli-skill-bundle',
      '--provider',
      input.provider,
      ...(agentSessionId ? ['--agent-session-id', agentSessionId] : []),
      '--json',
    ],
    [
      'agent',
      'skill-bundle',
      '--provider',
      input.provider,
      ...(agentSessionId ? ['--agent-session-id', agentSessionId] : []),
      '--json',
    ],
  ];

  let lastError: unknown;
  for (const [index, args] of commandArgs.entries()) {
    try {
      const { stdout } = await (input.execFileAsync ?? execFileAsync)(
        command,
        args,
        {
          ...(cwd ? { cwd } : {}),
          env: process.env,
          maxBuffer: TUTTI_SKILL_BUNDLE_MAX_BUFFER,
          timeout: TUTTI_SKILL_BUNDLE_TIMEOUT_MS,
        },
      );
      const bundle = parseTuttiAgentSkillBundle(stdout.toString('utf8'));
      return index === 0 ? bundle : withFallbackRecommendedSystemPrompt(bundle);
    } catch (error) {
      lastError = error;
    }
  }

  console.warn(`[vibe-design] Unable to load Tutti agent skill bundle: ${errorMessage(lastError)}`);
  return { skills: [] };
}

function withFallbackRecommendedSystemPrompt(
  bundle: ResolvedTuttiAgentSkillBundle,
): ResolvedTuttiAgentSkillBundle {
  if (bundle.recommendedSystemPrompt || bundle.skills.length === 0) {
    return bundle;
  }

  return {
    ...bundle,
    recommendedSystemPrompt: {
      format: 'text/markdown',
      content: FALLBACK_RECOMMENDED_SYSTEM_PROMPT,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function resolveTuttiAgentSkillManifest(
  input: ResolveTuttiAgentSkillManifestInput,
): Promise<SkillMaterializationRecord[]> {
  return (await resolveTuttiAgentSkillBundle(input)).skills;
}

export function parseTuttiAgentSkillBundle(stdout: string): ResolvedTuttiAgentSkillBundle {
  const payload = readRecord(JSON.parse(stdout));
  if (!payload || !Array.isArray(payload.skills)) {
    return { skills: [] };
  }

  const skills = payload.skills.flatMap((skill): SkillMaterializationRecord[] => {
    const parsed = parseSkillRecord(skill);
    return parsed ? [parsed] : [];
  });
  const recommendedSystemPrompt = parseRecommendedSystemPrompt(payload.recommendedSystemPrompt);
  return {
    skills,
    ...(recommendedSystemPrompt ? { recommendedSystemPrompt } : {}),
  };
}

function parseSkillRecord(value: unknown): SkillMaterializationRecord | null {
  const record = readRecord(value);
  const skillId = readString(record?.skillId);
  const slug = readString(record?.slug);
  const deliveryMode = readDeliveryMode(record?.deliveryMode);
  if (!record || !skillId || !slug || !deliveryMode) {
    return null;
  }

  const files = parseSkillFiles(record.files);
  const content = typeof record.content === 'string' ? record.content : undefined;
  return {
    skillId,
    slug,
    deliveryMode,
    ...(content !== undefined ? { content } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

function parseSkillFiles(value: unknown): SkillMaterializationFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((file): SkillMaterializationFile[] => {
    const record = readRecord(file);
    const path = readString(record?.path);
    const content = typeof record?.content === 'string' ? record.content : null;
    return path && content !== null ? [{ path, content }] : [];
  });
}

function parseRecommendedSystemPrompt(value: unknown): TuttiRecommendedSystemPrompt | null {
  const record = readRecord(value);
  const content = readString(record?.content);
  if (!record || !content) {
    return null;
  }

  const format = readString(record.format);
  return {
    content,
    ...(format ? { format } : {}),
  };
}

function readDeliveryMode(value: unknown): SkillMaterializationRecord['deliveryMode'] | null {
  return value === 'materialized-files' ||
    value === 'prompt-injection' ||
    value === 'project-instructions'
    ? value
    : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
