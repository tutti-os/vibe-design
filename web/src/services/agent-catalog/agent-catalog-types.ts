export interface AgentAvailability {
  id: string;
  label: string;
  supported: boolean;
  authState: 'ok' | 'missing' | 'expired' | 'unknown';
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
  supported?: boolean;
  models: AgentModelOption[];
}
