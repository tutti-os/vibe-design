import { fetchAgentModelCatalog } from '../agent-catalog-api';
import type {
  AgentCatalogSnapshot,
  IAgentCatalogService,
} from '../agent-catalog-service.interface';
import type { AgentModelCatalogEntry } from '../agent-catalog-types';

export class AgentCatalogService implements IAgentCatalogService {
  readonly _serviceBrand = undefined;

  private snapshot: AgentCatalogSnapshot;
  private loaded: boolean;
  private inFlight: Promise<AgentModelCatalogEntry[]> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(initialCatalog: AgentModelCatalogEntry[] = []) {
    this.snapshot = { catalog: cloneCatalog(initialCatalog), loading: false };
    this.loaded = initialCatalog.length > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AgentCatalogSnapshot {
    return { ...this.snapshot, catalog: cloneCatalog(this.snapshot.catalog) };
  }

  ensureLoaded(): Promise<AgentModelCatalogEntry[]> {
    return this.load(false);
  }

  refresh(): Promise<AgentModelCatalogEntry[]> {
    return this.load(true);
  }

  private load(force: boolean): Promise<AgentModelCatalogEntry[]> {
    if (!force && this.loaded) return Promise.resolve(cloneCatalog(this.snapshot.catalog));
    if (this.inFlight) return this.inFlight;

    this.setSnapshot({ loading: true });
    const request = fetchAgentModelCatalog()
      .then((catalog) => {
        this.loaded = true;
        this.setSnapshot({ catalog, loading: false });
        return cloneCatalog(catalog);
      })
      .catch(() => {
        this.setSnapshot({ loading: false });
        return cloneCatalog(this.snapshot.catalog);
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = null;
      });
    this.inFlight = request;
    return request;
  }

  private setSnapshot(next: Partial<AgentCatalogSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...next,
      catalog: next.catalog ? cloneCatalog(next.catalog) : this.snapshot.catalog,
    };
    for (const listener of this.listeners) listener();
  }
}

function cloneCatalog(catalog: AgentModelCatalogEntry[]): AgentModelCatalogEntry[] {
  return catalog.map((entry) => ({
    ...entry,
    models: entry.models.map((model) => ({ ...model })),
  }));
}
