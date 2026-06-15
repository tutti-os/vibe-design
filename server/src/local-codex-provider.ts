import {
  createCodexProvider,
  type AgentEvent,
  type LocalAgentProviderAdapter,
  type LocalAgentProviderPlugin,
  type ProviderLaunchPlan,
} from '@tutti-os/agent-acp-kit';

type CodexAdapter = LocalAgentProviderAdapter<'local-agent', 'codex'>;
type CodexRawStream = Parameters<CodexAdapter['parseEvents']>[0];

const DISABLED_CODEX_TOOL_FEATURES = [
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
] as const;

const CODEX_USER_CONFIG_ISOLATION_ARGS = [
  ...DISABLED_CODEX_TOOL_FEATURES.flatMap((feature) => ['--disable', feature]),
] as const;

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
          return isolateCodexLaunchPlan(await adapter.buildLaunchPlan(params));
        },
        parseEvents(stream) {
          return parseVibeCodexEvents(stream, adapter);
        },
      } satisfies CodexAdapter;
    },
    async buildLaunchPlan(params) {
      return isolateCodexLaunchPlan(await provider.buildLaunchPlan(params));
    },
  };
}

function isolateCodexLaunchPlan(plan: ProviderLaunchPlan): ProviderLaunchPlan {
  return {
    ...plan,
    args: insertCodexIsolationArgs(plan.args),
  };
}

function insertCodexIsolationArgs(args: string[]): string[] {
  const insertionIndex = args[0] === 'exec' && args[1] === 'resume' ? 3 : 2;
  const filteredArgs = args.filter((arg, index) => {
    if (arg === '--ignore-user-config') return false;
    if (arg === '--disable' && isDisabledCodexToolFeature(args[index + 1])) return false;
    if (isDisabledCodexToolFeature(arg) && args[index - 1] === '--disable') return false;
    return true;
  });

  return [
    ...filteredArgs.slice(0, insertionIndex),
    ...CODEX_USER_CONFIG_ISOLATION_ARGS,
    ...filteredArgs.slice(insertionIndex),
  ];
}

function isDisabledCodexToolFeature(value: string | undefined): boolean {
  return DISABLED_CODEX_TOOL_FEATURES.includes(value as (typeof DISABLED_CODEX_TOOL_FEATURES)[number]);
}

async function* parseVibeCodexEvents(stream: CodexRawStream, cleanupAdapter: CodexAdapter): AsyncIterable<AgentEvent> {
  let sessionId: string | undefined;

  try {
    for await (const item of stream) {
      const record = readRecord(item);
      const payload = readRecord(record?.payload);
      const candidateSessionId = readString(record?.sessionId)
        ?? readString(record?.session_id)
        ?? (record?.type === 'session_meta' ? readString(payload?.id) : null);
      if (candidateSessionId) {
        sessionId = candidateSessionId;
      }

      for (const event of parseCodexJsonItem(item)) {
        if (event.type === 'done' && sessionId && !event.sessionId) {
          yield { ...event, sessionId };
          continue;
        }
        yield event;
      }
    }
  } finally {
    for await (const _event of cleanupAdapter.parseEvents(emptyRawStream())) {
      // Draining the underlying adapter's empty stream triggers its run-scoped cleanup.
    }
  }
}

async function* emptyRawStream(): CodexRawStream {
  // Empty by design.
}

function parseCodexJsonItem(item: unknown): AgentEvent[] {
  const record = readRecord(item);
  if (!record) return [];

  const event = parseKnownAgentEvent(record);
  if (event) return [event];

  if (record.type === 'item.started' || record.type === 'item.completed') {
    const itemRecord = readRecord(record.item);
    return itemRecord ? parseCodexPayload(itemRecord, record.type === 'item.started' ? 'started' : 'completed') : [];
  }

  if (record.type === 'response_item') {
    const payload = readRecord(record.payload);
    return payload ? parseCodexPayload(payload) : [];
  }

  if (record.type === 'event_msg') {
    return parseCodexEventMessage(readRecord(record.payload));
  }

  return parseCodexPayload(record);
}

function parseKnownAgentEvent(record: Record<string, unknown>): AgentEvent | null {
  if (
    record.type === 'done' ||
    record.type === 'error' ||
    record.type === 'status' ||
    record.type === 'text_delta' ||
    record.type === 'thinking_delta' ||
    record.type === 'tool_call' ||
    record.type === 'tool_result' ||
    record.type === 'file_write' ||
    record.type === 'stderr'
  ) {
    return record as AgentEvent;
  }

  if (record.type === 'turn.failed') {
    return {
      type: 'error',
      code: 'codex_error',
      message: readString(record.message) ?? 'Codex turn failed',
    };
  }

  return null;
}

function parseCodexPayload(payload: Record<string, unknown>, phase?: 'started' | 'completed'): AgentEvent[] {
  if (payload.type === 'message' || payload.type === 'agent_message') {
    const text = readMessageText(payload);
    return text && readString(payload.role) !== 'user' ? [{ type: 'text_delta', text }] : [];
  }

  if (payload.type === 'reasoning') {
    const text = readReasoningText(payload);
    return text ? [{ type: 'thinking_delta', text }] : [];
  }

  if (payload.type === 'function_call' || payload.type === 'tool_call') {
    const id = readString(payload.call_id) ?? readString(payload.id);
    const name = readString(payload.name) ?? readString(payload.tool) ?? 'unknown_tool';
    if (!id) return [];
    return [{
      type: 'tool_call',
      id,
      name,
      input: readToolInput(payload.arguments ?? payload.input),
    }];
  }

  if (payload.type === 'function_call_output' || payload.type === 'tool_result') {
    const id = readString(payload.call_id) ?? readString(payload.id);
    if (!id) return [];
    const isError = Boolean(payload.is_error ?? payload.isError ?? payload.error);
    const summary = readString(payload.message) ?? readString(readRecord(payload.error)?.message);
    return [{
      type: 'tool_result',
      id,
      ...(payload.output !== undefined || payload.result !== undefined ? { output: payload.output ?? payload.result } : {}),
      ...(summary ? { summary } : {}),
      status: isError ? 'failed' : 'completed',
      isError,
    }];
  }

  if (payload.type === 'command_execution') {
    const id = readString(payload.id);
    if (!id) return [];
    if (phase === 'started' || payload.status === 'in_progress') {
      return [{ type: 'tool_call', id, name: 'Bash', input: { command: readString(payload.command) ?? '' } }];
    }
    const output = readString(payload.aggregated_output);
    const failed = typeof payload.exit_code === 'number' && payload.exit_code !== 0;
    const summary = output ?? readString(readRecord(payload.error)?.message);
    return [{
      type: 'tool_result',
      id,
      name: 'Bash',
      ...(output ? { output: { output } } : {}),
      ...(summary ? { summary } : {}),
      status: failed ? 'failed' : 'completed',
      isError: failed,
    }];
  }

  if (payload.type === 'error') {
    return [{
      type: 'error',
      code: readString(readRecord(payload.error)?.code) ?? 'codex_error',
      message: readString(readRecord(payload.error)?.message) ?? readString(payload.message) ?? 'Codex run failed',
    }];
  }

  return [];
}

function parseCodexEventMessage(payload: Record<string, unknown> | null): AgentEvent[] {
  if (!payload) return [];
  if (payload.type === 'turn_completed' || payload.type === 'turn_complete') {
    return [{ type: 'done', status: 'completed', reason: 'completed' }];
  }
  if (payload.type === 'turn_failed') {
    return [{
      type: 'error',
      code: 'codex_error',
      message: readString(payload.message) ?? 'Codex turn failed',
    }];
  }
  return [];
}

function readMessageText(payload: Record<string, unknown>): string | null {
  return readString(payload.text) ?? readString(payload.message) ?? readContentText(payload.content);
}

function readReasoningText(payload: Record<string, unknown>): string | null {
  return readContentText(payload.summary) ?? readString(payload.text);
}

function readContentText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const text = value.flatMap((entry): string[] => {
    const record = readRecord(entry);
    const content = readString(record?.text) ?? readString(record?.content);
    return content ? [content] : [];
  }).join('');
  return text || null;
}

function readToolInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
