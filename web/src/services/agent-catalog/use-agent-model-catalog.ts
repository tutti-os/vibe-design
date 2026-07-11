import * as React from 'react';
import { fetchAgentModelCatalog } from './agent-catalog-api';
import type { AgentModelCatalogEntry } from './agent-catalog-types';

export interface AgentModelCatalogState {
  catalog: AgentModelCatalogEntry[];
  loading: boolean;
  refresh(): Promise<AgentModelCatalogEntry[]>;
}

export function useAgentModelCatalog(
  initialCatalog: AgentModelCatalogEntry[],
): AgentModelCatalogState {
  const [catalog, setCatalog] = React.useState(initialCatalog);
  const [loading, setLoading] = React.useState(false);
  const inFlightRef = React.useRef<Promise<AgentModelCatalogEntry[]> | null>(null);

  const refresh = React.useCallback((): Promise<AgentModelCatalogEntry[]> => {
    if (inFlightRef.current) return inFlightRef.current;

    setLoading(true);
    const request = fetchAgentModelCatalog()
      .catch(() => [])
      .then((nextCatalog) => {
        setCatalog(nextCatalog);
        return nextCatalog;
      })
      .finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null;
        setLoading(false);
      });
    inFlightRef.current = request;
    return request;
  }, []);

  return { catalog, loading, refresh };
}
