import { fetchAgentModelCatalog } from '../agent-catalog-api';
import type {
  AgentCatalogSnapshot,
  IAgentCatalogService,
} from '../agent-catalog-service.interface';
import type { AgentModelCatalogEntry } from '../agent-catalog-types';
import {
  loadTuttiAgentTargetIconUrls,
  mergeTuttiAgentTargetPresentations,
} from './tutti-agent-target-presentation-adapter';

export class AgentCatalogService implements IAgentCatalogService {
  readonly _serviceBrand = undefined;

  private snapshot: AgentCatalogSnapshot;
  private loaded: boolean;
  private inFlight: Promise<AgentModelCatalogEntry[]> | null = null;
  private presentationAttempted = false;
  private presentationInFlight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(initialCatalog: AgentModelCatalogEntry[] = []) {
    this.snapshot = {
      catalog: cloneCatalog(initialCatalog),
      loading: false,
      error: null,
    };
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
    if (!force && this.loaded) {
      this.requestPresentations(false);
      return Promise.resolve(cloneCatalog(this.snapshot.catalog));
    }
    if (this.inFlight) return this.inFlight;

    this.setSnapshot({ loading: true, error: null });
    const request = fetchAgentModelCatalog({ refresh: force })
      .then((catalog) => {
        this.loaded = true;
        this.setSnapshot({ catalog, loading: false, error: null });
        this.requestPresentations(force);
        return cloneCatalog(catalog);
      })
      .catch((error: unknown) => {
        this.setSnapshot({
          loading: false,
          error: error instanceof Error ? error.message : 'Agent model catalog request failed.',
        });
        return cloneCatalog(this.snapshot.catalog);
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = null;
      });
    this.inFlight = request;
    return request;
  }

  private requestPresentations(force: boolean): void {
    if (this.presentationInFlight || (!force && this.presentationAttempted)) return;
    this.presentationAttempted = true;
    const request = loadTuttiAgentTargetIconUrls()
      .then((iconUrls) => {
        if (iconUrls.size === 0) return;
        this.setSnapshot({
          catalog: mergeTuttiAgentTargetPresentations(
            this.snapshot.catalog,
            iconUrls,
          ),
        });
      })
      .finally(() => {
        if (this.presentationInFlight === request) this.presentationInFlight = null;
      });
    this.presentationInFlight = request;
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
