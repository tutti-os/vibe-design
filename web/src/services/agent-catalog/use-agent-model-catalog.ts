import * as React from 'react';
import { fetchAgentModelCatalog } from './agent-catalog-api';
import type { AgentModelCatalogEntry } from './agent-catalog-types';

export interface AgentModelCatalogState {
  catalog: AgentModelCatalogEntry[];
  loading: boolean;
  ensureLoaded(): Promise<AgentModelCatalogEntry[]>;
  refresh(): Promise<AgentModelCatalogEntry[]>;
}

export function useAgentModelCatalog(
  initialCatalog: AgentModelCatalogEntry[],
): AgentModelCatalogState {
  const [catalog, setCatalog] = React.useState(initialCatalog);
  const [loading, setLoading] = React.useState(false);
  const catalogRef = React.useRef(initialCatalog);
  const loadedRef = React.useRef(initialCatalog.length > 0);
  const inFlightRef = React.useRef<Promise<AgentModelCatalogEntry[]> | null>(null);

  const load = React.useCallback((force: boolean): Promise<AgentModelCatalogEntry[]> => {
    if (!force && loadedRef.current) return Promise.resolve(catalogRef.current);
    if (inFlightRef.current) return inFlightRef.current;

    setLoading(true);
    const request = fetchAgentModelCatalog()
      .then((nextCatalog) => {
        loadedRef.current = true;
        catalogRef.current = nextCatalog;
        setCatalog(nextCatalog);
        return nextCatalog;
      })
      .catch(() => catalogRef.current)
      .finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null;
        setLoading(false);
      });
    inFlightRef.current = request;
    return request;
  }, []);

  const ensureLoaded = React.useCallback(() => load(false), [load]);
  const refresh = React.useCallback(() => load(true), [load]);

  return { catalog, loading, ensureLoaded, refresh };
}
