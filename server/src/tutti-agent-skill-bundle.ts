import type { DetectContext, SkillMaterializationRecord } from '@tutti-os/agent-acp-kit';
import {
  loadTuttiAgentSkillContext,
  type LoadTuttiAgentSkillContextInput,
  type TuttiAgentSkillContext,
} from '@tutti-os/agent-acp-kit/tutti';

export interface ResolveTuttiAgentSkillManifestInput {
  agentSessionId?: string | null;
  provider: string;
  command?: string | null;
  cwd?: string | null;
  detectContext?: DetectContext;
  env?: NodeJS.ProcessEnv;
  runTuttiCli?: LoadTuttiAgentSkillContextInput['runTuttiCli'];
}

export type ResolvedTuttiAgentSkillBundle = TuttiAgentSkillContext;

export async function resolveTuttiAgentSkillBundle(
  input: ResolveTuttiAgentSkillManifestInput,
): Promise<ResolvedTuttiAgentSkillBundle> {
  return loadTuttiAgentSkillContext({
    agentSessionId: input.agentSessionId,
    command: input.command,
    cwd: input.cwd,
    detectContext: input.detectContext,
    env: input.env ?? process.env,
    provider: input.provider,
    runTuttiCli: input.runTuttiCli,
  });
}

export async function resolveTuttiAgentSkillManifest(
  input: ResolveTuttiAgentSkillManifestInput,
): Promise<SkillMaterializationRecord[]> {
  return (await resolveTuttiAgentSkillBundle(input)).skillManifest;
}
