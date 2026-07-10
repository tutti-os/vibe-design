import type { SkillMaterializationRecord } from '@tutti-os/agent-acp-kit';
import {
  loadTuttiAgentSkillContext,
  resolveTuttiCliCommand,
  type LoadTuttiAgentSkillContextInput,
  type TuttiAgentSkillContext,
} from '@tutti-os/agent-acp-kit/tutti';

export interface ResolveTuttiAgentSkillManifestInput {
  agentSessionId?: string | null;
  provider: string;
  command?: string | null;
  cwd?: string | null;
  env?: NodeJS.ProcessEnv;
  runTuttiCli?: LoadTuttiAgentSkillContextInput['runTuttiCli'];
}

export type ResolvedTuttiAgentSkillBundle = TuttiAgentSkillContext;

export function configuredTuttiCliPath(env: Record<string, string | undefined> = process.env): string {
  return resolveTuttiCliCommand({ env, envNames: ['VIBE_TUTTI_CLI'] });
}

export function tuttiCliEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const command = configuredTuttiCliPath(env);
  return command ? { TUTTI_CLI: command } : {};
}

export async function resolveTuttiAgentSkillBundle(
  input: ResolveTuttiAgentSkillManifestInput,
): Promise<ResolvedTuttiAgentSkillBundle> {
  try {
    return await loadTuttiAgentSkillContext({
      agentSessionId: input.agentSessionId,
      command: input.command,
      commandEnvNames: ['VIBE_TUTTI_CLI'],
      cwd: input.cwd,
      env: input.env ?? process.env,
      provider: input.provider,
      runTuttiCli: input.runTuttiCli,
    });
  } catch (error) {
    console.warn(`[vibe-design] Unable to load Tutti agent skill context: ${errorMessage(error)}`);
    return emptyTuttiAgentSkillContext();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyTuttiAgentSkillContext(): TuttiAgentSkillContext {
  return { source: 'standalone', skills: [], skillManifest: [] };
}

export async function resolveTuttiAgentSkillManifest(
  input: ResolveTuttiAgentSkillManifestInput,
): Promise<SkillMaterializationRecord[]> {
  return (await resolveTuttiAgentSkillBundle(input)).skillManifest;
}
