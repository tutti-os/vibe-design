import { createRoleMarkerGuard, type RoleMarkerGuard } from './role-marker-guard.js';

export type AgentEvent =
  | { type: 'status'; label: string; model?: unknown; sessionId?: unknown; ttftMs?: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'tool_use'; id: unknown; name: unknown; input: unknown }
  | { type: 'tool_result'; toolUseId: unknown; content: string; isError: boolean }
  | { type: 'usage'; usage: unknown; costUsd: unknown; durationMs: unknown; stopReason: unknown }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'raw'; line: string }
  | { type: 'fabricated_role_marker'; marker: string; messageId: string };

interface BlockState {
  type: string;
  id?: unknown;
  name?: unknown;
  inputJson: string;
}

type EmitAgentEvent = (event: AgentEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') {
          return item.text;
        }

        return JSON.stringify(item);
      })
      .join('');
  }

  return content === undefined ? '' : JSON.stringify(content);
}

function parseToolInput(inputJson: string): { ok: true; input: unknown } | { ok: false } {
  if (inputJson.length === 0) {
    return { ok: false };
  }

  try {
    return { ok: true, input: JSON.parse(inputJson) };
  } catch {
    return { ok: false };
  }
}

export function createClaudeStreamHandler(emit: EmitAgentEvent) {
  let buffered = '';
  let currentMessageId: string | undefined;
  let anonymousMessageSequence = 0;
  const blocks = new Map<number, BlockState>();
  const streamedToolUseIds = new Set<unknown>();
  const roleGuards = new Map<string, RoleMarkerGuard>();
  const warnedRoleGuardIds = new Set<string>();
  const textStreamed = new Set<string>();
  const thinkingStreamed = new Set<string>();

  function nextAnonymousMessageId(): string {
    anonymousMessageSequence += 1;
    return `anonymous-${anonymousMessageSequence}`;
  }

  function messageStreamKey(): string {
    currentMessageId ??= nextAnonymousMessageId();
    return currentMessageId;
  }

  function pruneMessageState(messageId: string): void {
    roleGuards.delete(messageId);
    warnedRoleGuardIds.delete(messageId);
    textStreamed.delete(messageId);
    thinkingStreamed.delete(messageId);
    if (currentMessageId === messageId) {
      currentMessageId = undefined;
    }
  }

  function emitTextDelta(text: string, options: { markStreamed?: boolean } = {}): void {
    if (text.length === 0) {
      return;
    }

    const messageId = messageStreamKey();
    let guard = roleGuards.get(messageId);
    if (!guard) {
      guard = createRoleMarkerGuard(messageId);
      roleGuards.set(messageId, guard);
    }

    if (options.markStreamed !== false) {
      textStreamed.add(messageId);
    }

    const safeText = guard.feedText(text);
    if (safeText.length > 0) {
      emit({ type: 'text_delta', delta: safeText });
    }

    const warningEvent = guard.warningEvent();
    if (warningEvent && !warnedRoleGuardIds.has(messageId)) {
      warnedRoleGuardIds.add(messageId);
      emit(warningEvent);
    }
  }

  function handleStreamEvent(event: Record<string, unknown>): void {
    switch (event.type) {
      case 'message_start': {
        const message = isRecord(event.message) ? event.message : {};
        currentMessageId = typeof message.id === 'string' ? message.id : nextAnonymousMessageId();
        blocks.clear();

        if (typeof event.ttft_ms === 'number') {
          emit({ type: 'status', label: 'streaming', ttftMs: event.ttft_ms });
        }
        return;
      }

      case 'content_block_start': {
        if (typeof event.index !== 'number' || !isRecord(event.content_block)) {
          return;
        }

        const block = event.content_block;
        if (typeof block.type !== 'string') {
          return;
        }

        blocks.set(event.index, {
          type: block.type,
          id: block.id,
          name: block.name,
          inputJson: '',
        });

        if (block.type === 'thinking') {
          emit({ type: 'thinking_start' });
        }
        return;
      }

      case 'content_block_delta': {
        if (!isRecord(event.delta)) {
          return;
        }

        const delta = event.delta;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          emitTextDelta(delta.text);
          return;
        }

        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          thinkingStreamed.add(messageStreamKey());
          emit({ type: 'thinking_delta', delta: delta.thinking });
          return;
        }

        if (
          delta.type === 'input_json_delta' &&
          typeof event.index === 'number' &&
          typeof delta.partial_json === 'string'
        ) {
          const block = blocks.get(event.index);
          if (block) {
            block.inputJson += delta.partial_json;
          }
        }
        return;
      }

      case 'content_block_stop': {
        if (typeof event.index !== 'number') {
          return;
        }

        const block = blocks.get(event.index);
        if (!block || block.type !== 'tool_use') {
          blocks.delete(event.index);
          return;
        }

        const parsedInput = parseToolInput(block.inputJson);
        blocks.delete(event.index);
        if (!parsedInput.ok) {
          return;
        }

        streamedToolUseIds.add(block.id);
        emit({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: parsedInput.input,
        });
        return;
      }

      default:
        return;
    }
  }

  function handleAssistant(value: Record<string, unknown>): void {
    const message = isRecord(value.message) ? value.message : {};
    if (typeof message.id === 'string') {
      currentMessageId = message.id;
    }
    const messageId = messageStreamKey();

    const content = Array.isArray(message.content) ? message.content : [];
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }

      if (item.type === 'text' && typeof item.text === 'string' && !textStreamed.has(messageId)) {
        emitTextDelta(item.text, { markStreamed: false });
        continue;
      }

      if (item.type === 'thinking' && typeof item.thinking === 'string' && !thinkingStreamed.has(messageId)) {
        emit({ type: 'thinking_delta', delta: item.thinking });
        continue;
      }

      if (item.type === 'tool_use' && streamedToolUseIds.has(item.id)) {
        streamedToolUseIds.delete(item.id);
        continue;
      }

      if (item.type === 'tool_use') {
        emit({ type: 'tool_use', id: item.id, name: item.name, input: item.input });
      }
    }

    if (typeof message.stop_reason === 'string') {
      emit({ type: 'turn_end', stopReason: message.stop_reason });
    }
    pruneMessageState(messageId);
  }

  function handleUser(value: Record<string, unknown>): void {
    const message = isRecord(value.message) ? value.message : {};
    const content = Array.isArray(message.content) ? message.content : [];

    for (const item of content) {
      if (!isRecord(item) || item.type !== 'tool_result') {
        continue;
      }

      emit({
        type: 'tool_result',
        toolUseId: item.tool_use_id,
        content: stringifyToolResult(item.content),
        isError: item.is_error === true,
      });
    }
  }

  function handleObject(value: Record<string, unknown>): void {
    if (value.type === 'system' && value.subtype === 'init') {
      emit({
        type: 'status',
        label: 'initializing',
        model: value.model,
        sessionId: value.session_id,
      });
      return;
    }

    if (value.type === 'system' && value.subtype === 'status') {
      emit({ type: 'status', label: typeof value.status === 'string' ? value.status : 'status' });
      return;
    }

    if (value.type === 'stream_event' && isRecord(value.event)) {
      handleStreamEvent(value.event);
      return;
    }

    if (value.type === 'assistant') {
      handleAssistant(value);
      return;
    }

    if (value.type === 'user') {
      handleUser(value);
      return;
    }

    if (value.type === 'result') {
      emit({
        type: 'usage',
        usage: value.usage,
        costUsd: value.total_cost_usd,
        durationMs: value.duration_ms,
        stopReason: value.stop_reason,
      });
    }
  }

  function handleLine(line: string): void {
    if (line.length === 0) {
      return;
    }

    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) {
        handleObject(value);
      } else {
        emit({ type: 'raw', line });
      }
    } catch {
      emit({ type: 'raw', line });
    }
  }

  function feed(chunk: string): void {
    buffered += chunk;

    while (true) {
      const lineBreakIndex = buffered.indexOf('\n');
      if (lineBreakIndex === -1) {
        return;
      }

      const line = buffered.slice(0, lineBreakIndex);
      buffered = buffered.slice(lineBreakIndex + 1);
      handleLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
  }

  function flush(): void {
    const line = buffered;
    buffered = '';
    handleLine(line);
  }

  return { feed, flush };
}
