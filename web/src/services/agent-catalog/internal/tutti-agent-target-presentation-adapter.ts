import type {
  TuttiExternalAgentTargetCatalog,
  TuttiExternalBridge,
} from '@tutti-os/workspace-external-core/contracts';
import type { AgentModelCatalogEntry } from '../agent-catalog-types';

type AgentActivityBridge = {
  agentActivity?: {
    listTargets?: () => Promise<TuttiExternalAgentTargetCatalog>;
  };
};

export async function loadTuttiAgentTargetIconUrls(
  bridge: AgentActivityBridge | null = readTuttiExternalBridge(),
): Promise<ReadonlyMap<string, string>> {
  const listTargets = bridge?.agentActivity?.listTargets;
  if (typeof listTargets !== 'function') return new Map();

  try {
    const catalog = await listTargets();
    return new Map(
      catalog.agents.flatMap((agent) => {
        const agentTargetId = agent.agentTargetId.trim();
        const iconUrl = agent.iconUrl.trim();
        return agentTargetId && iconUrl ? [[agentTargetId, iconUrl] as const] : [];
      }),
    );
  } catch {
    return new Map();
  }
}

export function mergeTuttiAgentTargetPresentations(
  catalog: AgentModelCatalogEntry[],
  iconUrls: ReadonlyMap<string, string>,
): AgentModelCatalogEntry[] {
  return catalog.map((entry) => {
    const iconUrl = iconUrls.get(entry.agentTargetId);
    return {
      ...entry,
      ...(iconUrl ? { iconUrl } : {}),
      models: entry.models.map((model) => ({ ...model })),
    };
  });
}

function readTuttiExternalBridge(): AgentActivityBridge | null {
  if (typeof window === 'undefined') return null;
  return (window.tuttiExternal as Partial<TuttiExternalBridge> | undefined) ?? null;
}
