import { createDecorator } from '@tutti-os/infra/di';
import type { AgentModelCatalogEntry } from './agent-catalog-types';

export interface AgentCatalogSnapshot {
  catalog: AgentModelCatalogEntry[];
  loading: boolean;
  error: string | null;
}

export interface IAgentCatalogService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  getSnapshot(): AgentCatalogSnapshot;
  ensureLoaded(): Promise<AgentModelCatalogEntry[]>;
  refresh(): Promise<AgentModelCatalogEntry[]>;
}

export const IAgentCatalogService = createDecorator<IAgentCatalogService>('agent-catalog-service');
