import type { AgentEvent } from '../types';

export type FileOpKind = 'read' | 'write' | 'edit' | 'delete';
export type FileOpStatus = 'running' | 'done' | 'error';

export interface FileOpEntry {
  path: string;
  fullPath: string;
  ops: FileOpKind[];
  opCounts: Record<FileOpKind, number>;
  total: number;
  status: FileOpStatus;
}

export type FileOpCounts = Record<FileOpKind, number>;

const READ_TOOL_NAMES = new Set(['Read', 'read_file']);
const WRITE_TOOL_NAMES = new Set(['Write', 'create_file']);
const EDIT_TOOL_NAMES = new Set(['Edit', 'str_replace_edit', 'MultiEdit', 'multi_edit']);
const DELETE_TOOL_NAMES = new Set(['Delete', 'delete_file', 'remove_file']);

export function deriveFileOps(events: AgentEvent[] | undefined): FileOpEntry[] {
  if (!events || events.length === 0) return [];

  const resultByToolId = new Map<string, Extract<AgentEvent, { type: 'tool_result' }>>();
  const terminalStatus = terminalStatusForEvents(events);
  for (const event of events) {
    if (event.type === 'tool_result') resultByToolId.set(event.toolUseId, event);
  }

  const entriesByPath = new Map<string, FileOpEntry>();
  for (const event of events) {
    if (event.type !== 'tool_use') continue;

    const kind = classifyToolUse(event.name, event.input);
    if (!kind) continue;

    const fullPath = kind === 'delete' ? extractDeletePath(event.input) ?? extractToolPath(event.input) : extractToolPath(event.input);
    if (!fullPath || fullPath === '(unnamed)') continue;

    const result = resultByToolId.get(event.id);
    const status = fileOpStatusForResult(result, terminalStatus);
    const existing = entriesByPath.get(fullPath);

    if (existing) {
      if (!existing.ops.includes(kind)) existing.ops.push(kind);
      existing.opCounts[kind] += 1;
      existing.total += 1;
      existing.status = mergeStatus(existing.status, status);
      continue;
    }

    const opCounts: FileOpCounts = { read: 0, write: 0, edit: 0, delete: 0 };
    opCounts[kind] = 1;
    entriesByPath.set(fullPath, {
      path: basename(fullPath),
      fullPath,
      ops: [kind],
      opCounts,
      total: 1,
      status,
    });
  }

  return Array.from(entriesByPath.values());
}

function fileOpStatusForResult(
  result: Extract<AgentEvent, { type: 'tool_result' }> | undefined,
  terminalStatus: Extract<AgentEvent, { type: 'end' }>['status'] | null,
): FileOpStatus {
  if (result) return result.isError ? 'error' : 'done';
  if (terminalStatus === 'failed') return 'error';
  if (terminalStatus === 'succeeded' || terminalStatus === 'canceled') return 'done';
  return 'running';
}

function terminalStatusForEvents(events: AgentEvent[]): Extract<AgentEvent, { type: 'end' }>['status'] | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'end') return event.status;
  }
  return null;
}

export function countFileOps(entries: FileOpEntry[]): FileOpCounts {
  const counts: FileOpCounts = { read: 0, write: 0, edit: 0, delete: 0 };

  for (const entry of entries) {
    counts.read += entry.opCounts.read;
    counts.write += entry.opCounts.write;
    counts.edit += entry.opCounts.edit;
    counts.delete += entry.opCounts.delete;
  }

  return counts;
}

function classifyToolUse(name: string, input: Record<string, unknown>): FileOpKind | null {
  if (READ_TOOL_NAMES.has(name)) return 'read';
  if (WRITE_TOOL_NAMES.has(name)) return 'write';
  if (EDIT_TOOL_NAMES.has(name)) return 'edit';
  if (DELETE_TOOL_NAMES.has(name)) return 'delete';
  if (name === 'Bash' && typeof input.command === 'string' && isDeleteCommand(input.command)) return 'delete';
  return null;
}

function extractToolPath(input: Record<string, unknown>): string | null {
  const filePath = input.file_path;
  if (typeof filePath === 'string' && filePath.length > 0) return filePath;

  const path = input.path;
  if (typeof path === 'string' && path.length > 0) return path;

  return null;
}

function extractDeletePath(input: Record<string, unknown>): string | null {
  if (typeof input.command !== 'string') return null;

  const match = /^\s*rm\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(input.command);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function isDeleteCommand(command: string): boolean {
  return /^\s*rm\s+/.test(command);
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

function mergeStatus(current: FileOpStatus, next: FileOpStatus): FileOpStatus {
  if (current === 'error' || next === 'error') return 'error';
  if (current === 'running' || next === 'running') return 'running';
  return 'done';
}
