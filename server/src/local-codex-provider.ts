import { readFile, writeFile } from 'node:fs/promises';
import {
  createCodexProvider,
  type LocalAgentProviderAdapter,
  type LocalAgentProviderPlugin,
  type ProviderLaunchPlan,
} from '@tutti-os/agent-acp-kit';

type CodexAdapter = LocalAgentProviderAdapter<'local-agent', 'codex'>;

export function createVibeCodexProvider(): LocalAgentProviderPlugin<'local-agent', 'codex'> {
  const provider = createCodexProvider();

  return {
    ...provider,
    createAdapter() {
      const adapter = provider.createAdapter?.();
      if (!adapter) {
        throw new Error('Codex provider adapter is unavailable.');
      }

      return {
        ...adapter,
        async buildLaunchPlan(params) {
          return isolateCodexLaunchPlan(await adapter.buildLaunchPlan(withoutMcpServers(params)));
        },
      } satisfies CodexAdapter;
    },
    async buildLaunchPlan(params) {
      return isolateCodexLaunchPlan(await provider.buildLaunchPlan(withoutMcpServers(params)));
    },
  };
}

async function isolateCodexLaunchPlan(plan: ProviderLaunchPlan): Promise<ProviderLaunchPlan> {
  const isolatedFallback = plan.fallbackPlan ? await isolateCodexLaunchPlan(plan.fallbackPlan) : undefined;
  await stripMcpServersFromRunScopedCodexConfig(plan);
  const { mcpServers: _mcpServers, ...planWithoutMcpServers } = plan;

  return {
    ...planWithoutMcpServers,
    ...(isolatedFallback ? { fallbackPlan: isolatedFallback } : {}),
  };
}

function withoutMcpServers<T extends { mcpServers?: unknown }>(params: T): T {
  const { mcpServers: _mcpServers, ...rest } = params;
  return rest as T;
}

async function stripMcpServersFromRunScopedCodexConfig(plan: ProviderLaunchPlan): Promise<void> {
  const codexHome = plan.env?.CODEX_HOME;
  if (!codexHome) return;

  const configPath = `${codexHome}/config.toml`;
  try {
    const content = await readFile(configPath, 'utf8');
    const stripped = stripCodexMcpServerTables(content);
    if (stripped !== content) {
      await writeFile(configPath, stripped, 'utf8');
    }
  } catch {
    // The upstream provider creates this file for normal Codex runs. If a future
    // provider changes that behavior, absence of config should not block launch.
  }
}

function stripCodexMcpServerTables(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let inMcpTable = false;

  for (const line of lines) {
    const tableName = readTomlTableName(line);
    if (tableName) {
      inMcpTable = tableName === 'mcp_servers' || tableName.startsWith('mcp_servers.');
    }
    if (!inMcpTable) {
      output.push(line);
    }
  }

  return `${output.join('\n').trimEnd()}\n`;
}

function readTomlTableName(line: string): string | null {
  const match = line.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
  return match?.[1]?.trim() ?? null;
}
