import { artifactFileName, isCompleteHtmlDocument } from '../../../artifacts/artifact-file';
import { createArtifactParser } from '../../../artifacts/artifact-parser';
import { deriveFileOps } from '../../../runtime/file-ops';
import { splitOnQuestionForms } from '../../../runtime/question-form';
import { isTodoWriteToolName, parseTodoWriteInput } from '../../../runtime/todos';
import type { AgentEvent } from '../../../types';
import type { GeneratedFileEntry, MessageBlock, ToolCall, ToolResult } from '../chat-timeline-types';

type ToolUseEvent = Extract<AgentEvent, { type: 'tool_use' }>;
type ToolResultEvent = Extract<AgentEvent, { type: 'tool_result' }>;

export function buildMessageBlocks(events: AgentEvent[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const artifactParser = createArtifactParser();
  const generatedFilesByName = new Map<string, GeneratedFileEntry>();
  const resultByToolId = new Map<string, ToolResultEvent>();
  const runningToolIds = runningToolUseIds(events);
  let lastQuestionInput: Record<string, unknown> | null = null;
  let activeArtifact: { identifier: string; artifactType: string; title: string; html: string } | null = null;
  let todoWriteBlock: Extract<MessageBlock, { kind: 'todo-write' }> | null = null;

  for (const event of events) {
    if (event.type === 'tool_result') resultByToolId.set(event.toolUseId, event);
  }

  for (const event of events) {
    if (isErrorEvent(event)) {
      appendErrorBlock(blocks, event);
      lastQuestionInput = null;
      continue;
    }

    if (event.type === 'text_delta') {
      const text = event.delta ?? event.text ?? '';
      for (const parsed of artifactParser.feed(text)) {
        if (parsed.type === 'text') {
          if (!isQuestionFallbackText(lastQuestionInput, parsed.delta)) {
            appendTextBlock(blocks, parsed.delta);
          }
          continue;
        }
        if (parsed.type === 'artifact:start') {
          activeArtifact = {
            identifier: parsed.identifier,
            artifactType: parsed.artifactType,
            title: parsed.title,
            html: '',
          };
          continue;
        }
        if (parsed.type === 'artifact:chunk') {
          if (activeArtifact) activeArtifact.html += parsed.delta;
          continue;
        }
        const artifact = activeArtifact
          ? { ...activeArtifact, html: parsed.fullContent }
          : { identifier: parsed.identifier, artifactType: '', title: '', html: parsed.fullContent };
        if (isCompleteHtmlDocument(artifact.html)) {
          addGeneratedFile(generatedFilesByName, {
            name: artifactFileName(artifact),
            artifactType: artifact.artifactType || undefined,
            title: artifact.title || undefined,
          });
        }
        activeArtifact = null;
      }
      lastQuestionInput = null;
      continue;
    }

    if (event.type === 'thinking_delta') {
      appendThinkingBlock(blocks, event.delta ?? event.text ?? '');
      lastQuestionInput = null;
      continue;
    }

    if (event.type !== 'tool_use') continue;

    if (isAskUserQuestionToolName(event.name)) {
      blocks.push({
        kind: 'ask-user-question',
        toolUseId: event.id,
        input: event.input,
        answered: resultByToolId.has(event.id),
      });
      lastQuestionInput = event.input;
      continue;
    }

    lastQuestionInput = null;

    if (isTodoWriteToolName(event.name)) {
      if (parseTodoWriteInput(event.input).length === 0) {
        appendToolGroupBlock(blocks, event, resultByToolId.get(event.id), runningToolIds.has(event.id));
        continue;
      }
      if (todoWriteBlock) {
        todoWriteBlock.toolUseId = event.id;
        todoWriteBlock.input = event.input;
      } else {
        todoWriteBlock = {
          kind: 'todo-write',
          toolUseId: event.id,
          input: event.input,
        };
        blocks.push(todoWriteBlock);
      }
      continue;
    }

    appendToolGroupBlock(blocks, event, resultByToolId.get(event.id), runningToolIds.has(event.id));
  }

  const normalizedBlocks = compactMessageBlocks(
    suppressRepeatedQuestionFormLeadText(expandQuestionFormTextBlocks(expandReasoningTextBlocks(blocks))),
  );
  for (const event of events) {
    if (event.type === 'generated_file') {
      addGeneratedFile(generatedFilesByName, {
        name: event.name,
        artifactType: event.artifactType,
        title: event.title,
      });
    }
  }
  const fileOps = deriveFileOps(events);
  for (const op of fileOps) {
    if (op.status === 'error' || op.opCounts.write === 0) continue;
    addGeneratedFile(generatedFilesByName, {
      name: op.fullPath,
      ...(htmlLikePath(op.fullPath) ? { artifactType: 'text/html' } : {}),
    });
  }
  if (generatedFilesByName.size > 0) {
    normalizedBlocks.push({ kind: 'generated-files', files: Array.from(generatedFilesByName.values()) });
  }
  return normalizedBlocks;
}

function addGeneratedFile(filesByName: Map<string, GeneratedFileEntry>, file: GeneratedFileEntry): void {
  if (!file.name) return;
  if (findGeneratedFileKey(filesByName, file.name)) return;
  filesByName.set(file.name, file);
}

function findGeneratedFileKey(filesByName: Map<string, GeneratedFileEntry>, name: string): string | null {
  for (const existingName of filesByName.keys()) {
    if (sameGeneratedFilePath(existingName, name)) return existingName;
  }
  return null;
}

function sameGeneratedFilePath(left: string, right: string): boolean {
  const normalizedLeft = normalizeGeneratedFilePath(left);
  const normalizedRight = normalizeGeneratedFilePath(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function normalizeGeneratedFilePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function htmlLikePath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

function isQuestionFallbackText(input: Record<string, unknown> | null, text: string): boolean {
  if (!input || text.trim().length === 0) return false;

  const fallbackParts = questionFallbackParts(input);
  const normalizedText = normalizeFallbackText(text);
  return fallbackParts.some((part) => {
    const normalizedPart = normalizeFallbackText(part);
    return normalizedPart.length > 0 && (normalizedText.includes(normalizedPart) || normalizedPart.includes(normalizedText));
  });
}

function questionFallbackParts(input: Record<string, unknown>): string[] {
  const questions = Array.isArray(input.questions) ? input.questions : [input];
  const parts: string[] = [];

  for (const rawQuestion of questions) {
    if (!rawQuestion || typeof rawQuestion !== 'object') continue;
    const question = rawQuestion as Record<string, unknown>;
    if (typeof question.question === 'string') parts.push(question.question);
    if (!Array.isArray(question.options)) continue;
    for (const rawOption of question.options) {
      if (typeof rawOption === 'string') {
        parts.push(rawOption);
      } else if (rawOption && typeof rawOption === 'object') {
        const option = rawOption as Record<string, unknown>;
        if (typeof option.label === 'string') parts.push(option.label);
        if (typeof option.description === 'string') parts.push(option.description);
      }
    }
  }

  return parts;
}

function normalizeFallbackText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function appendTextBlock(blocks: MessageBlock[], delta: string): void {
  const last = blocks.at(-1);
  if (last?.kind === 'text') {
    last.content += delta;
    return;
  }

  blocks.push({ kind: 'text', content: delta, markdown: true });
}

function expandQuestionFormTextBlocks(blocks: MessageBlock[]): MessageBlock[] {
  return blocks.flatMap((block): MessageBlock[] => {
    if (block.kind !== 'text' || !block.content.includes('<question-form')) return [block];

    return splitOnQuestionForms(block.content).flatMap((segment): MessageBlock[] => {
      if (segment.kind === 'text') {
        return segment.text.length > 0 ? [{ kind: 'text', content: segment.text, markdown: block.markdown }] : [];
      }
      return [{ kind: 'question-form', form: segment.form }];
    });
  });
}

function suppressRepeatedQuestionFormLeadText(blocks: MessageBlock[]): MessageBlock[] {
  const filtered: MessageBlock[] = [];
  const seenText = new Set<string>();

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || block.kind !== 'text') {
      filtered.push(block);
      continue;
    }

    const normalized = normalizeFallbackText(block.content);
    const leadsQuestionForm = blocks[index + 1]?.kind === 'question-form';
    if (normalized.length > 0 && leadsQuestionForm && seenText.has(normalized)) {
      continue;
    }

    filtered.push(block);
    if (normalized.length > 0) {
      seenText.add(normalized);
    }
  }

  return filtered;
}

function expandReasoningTextBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const expanded: MessageBlock[] = [];
  const reasoningRe = /<reasoning>([\s\S]*?)<\/reasoning>/gi;

  for (const block of blocks) {
    if (block.kind !== 'text' || !/<reasoning>/i.test(block.content)) {
      expanded.push(block);
      continue;
    }

    let cursor = 0;
    reasoningRe.lastIndex = 0;
    for (const match of block.content.matchAll(reasoningRe)) {
      const index = match.index ?? 0;
      if (index > cursor) {
        appendTextBlock(expanded, block.content.slice(cursor, index));
      }
      appendThinkingBlock(expanded, match[1] ?? '');
      cursor = index + match[0].length;
    }

    if (cursor < block.content.length) {
      appendTextBlock(expanded, block.content.slice(cursor));
    }
  }

  return expanded;
}

function appendThinkingBlock(blocks: MessageBlock[], delta: string): void {
  const last = blocks.at(-1);
  if (last?.kind === 'thinking') {
    last.content += delta;
    return;
  }

  blocks.push({ kind: 'thinking', content: delta });
}

function compactMessageBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const compacted: MessageBlock[] = [];

  for (const block of blocks) {
    if (block.kind === 'text' && block.content.trim().length === 0) continue;

    const last = compacted.at(-1);
    if (block.kind === 'thinking' && last?.kind === 'thinking') {
      last.content += block.content;
      continue;
    }

    compacted.push(block);
  }

  return compacted;
}

function appendErrorBlock(blocks: MessageBlock[], event: AgentEvent): void {
  const projected = projectErrorEvent(event);
  blocks.push({
    kind: 'error',
    message: projected.message,
    ...(projected.code ? { code: projected.code } : {}),
  });
}

function projectErrorEvent(event: AgentEvent): { message: string; code: string | null } {
  const record: Record<string, unknown> = isRecord(event) ? event : {};
  const nested = isRecord(record.error) ? record.error : null;
  const message =
    readNonEmptyString(record.message) ??
    readNonEmptyString(record.detail) ??
    readNonEmptyString(nested?.message) ??
    readNonEmptyString(nested?.detail) ??
    readNonEmptyString(record.error) ??
    'Agent run failed';
  const code = readNonEmptyString(record.code) ?? readNonEmptyString(nested?.code);
  return { message, code };
}

function isErrorEvent(event: AgentEvent): boolean {
  return event.type === 'error' || (isRecord(event) && event.kind === 'error');
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function appendToolGroupBlock(
  blocks: MessageBlock[],
  event: ToolUseEvent,
  result: ToolResultEvent | undefined,
  running: boolean,
): void {
  const call: ToolCall = {
    id: event.id,
    name: event.name,
    input: event.input,
  };
  const toolResult = result ? toToolResult(result) : null;
  const last = blocks.at(-1);

  if (last?.kind === 'tool-group' && toolFamily(last.calls.at(-1)?.name ?? '') === toolFamily(event.name)) {
    last.calls.push(call);
    if (toolResult) last.results.push(toolResult);
    last.running = Boolean(last.running || running);
    return;
  }

  blocks.push({
    kind: 'tool-group',
    calls: [call],
    results: toolResult ? [toolResult] : [],
    running,
  });
}

function toToolResult(event: ToolResultEvent): ToolResult {
  return {
    toolUseId: event.toolUseId,
    content: event.content,
    isError: event.isError,
  };
}

function isAskUserQuestionToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === 'askuserquestion' ||
    normalized === 'ask_user_question' ||
    normalized === 'request_user_input';
}

function toolFamily(name: string): string {
  if (name === 'Edit' || name === 'str_replace_edit' || name === 'MultiEdit' || name === 'multi_edit') {
    return 'edit';
  }
  if (name === 'Write' || name === 'write' || name === 'create_file') return 'write';
  if (name === 'Read' || name === 'read_file') return 'read';
  if (name === 'Glob' || name === 'list_files') return 'glob';
  if (name === 'Grep') return 'grep';
  if (name === 'Bash') return 'bash';
  if (name === 'WebFetch' || name === 'web_fetch') return 'fetch';
  if (name === 'WebSearch' || name === 'web_search') return 'search';
  return name.toLowerCase();
}

function runningToolUseIds(events: AgentEvent[]): Set<string> {
  const resultIds = new Set<string>();
  const runningIds = new Set<string>();
  let hasLaterSettlingEvent = false;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;

    if (event.type === 'tool_result') {
      resultIds.add(event.toolUseId);
      continue;
    }

    if (event.type === 'tool_use') {
      if (!resultIds.has(event.id) && !hasLaterSettlingEvent) {
        runningIds.add(event.id);
      }
      hasLaterSettlingEvent = true;
      continue;
    }

    if (settlesResultlessToolUse(event)) {
      hasLaterSettlingEvent = true;
    }
  }

  return runningIds;
}

function settlesResultlessToolUse(event: AgentEvent): boolean {
  return (
    event.type === 'text_delta' ||
    event.type === 'thinking_delta' ||
    event.type === 'thinking_start' ||
    event.type === 'turn_end' ||
    event.type === 'generated_file' ||
    event.type === 'usage' ||
    event.type === 'end' ||
    event.type === 'error' ||
    isErrorEvent(event)
  );
}
