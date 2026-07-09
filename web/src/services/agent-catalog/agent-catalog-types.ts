export interface AgentAvailability {
  id: string;
  label: string;
  available: boolean;
  authState?: 'ok' | 'missing' | 'expired' | 'unknown';
  supported?: boolean;
  unavailableReason?: string;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface AgentModelCatalogEntry {
  agentId: string;
  label: string;
  models: AgentModelOption[];
}
