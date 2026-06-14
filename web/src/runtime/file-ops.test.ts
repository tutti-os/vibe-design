import { describe, expect, it } from 'vitest';
import { countFileOps, deriveFileOps } from './file-ops';
import type { AgentEvent } from '../types';

describe('deriveFileOps', () => {
  it('groups read/write/edit tool calls by path and result status', () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/src/App.tsx' } },
      { type: 'tool_result', toolUseId: 'read-1', content: 'ok', isError: false },
      { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: '/tmp/src/App.tsx' } },
      { type: 'tool_result', toolUseId: 'edit-1', content: 'bad', isError: true },
      { type: 'tool_use', id: 'write-1', name: 'Write', input: { path: 'README.md' } },
      { type: 'tool_use', id: 'delete-1', name: 'Bash', input: { command: 'rm old.css' } },
      { type: 'tool_result', toolUseId: 'delete-1', content: 'ok', isError: false },
    ];

    const rows = deriveFileOps(events);

    expect(rows).toEqual([
      {
        path: 'App.tsx',
        fullPath: '/tmp/src/App.tsx',
        ops: ['read', 'edit'],
        opCounts: { read: 1, write: 0, edit: 1, delete: 0 },
        total: 2,
        status: 'error',
      },
      {
        path: 'README.md',
        fullPath: 'README.md',
        ops: ['write'],
        opCounts: { read: 0, write: 1, edit: 0, delete: 0 },
        total: 1,
        status: 'running',
      },
      {
        path: 'old.css',
        fullPath: 'old.css',
        ops: ['delete'],
        opCounts: { read: 0, write: 0, edit: 0, delete: 1 },
        total: 1,
        status: 'done',
      },
    ]);
    expect(countFileOps(rows)).toEqual({ read: 1, write: 1, edit: 1, delete: 1 });
  });

  it('pairs results by tool-use id when stream event id is separate', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_use',
        eventId: 11,
        id: 'edit-1',
        name: 'Edit',
        input: { file_path: '/tmp/src/App.tsx' },
      },
      {
        type: 'tool_result',
        eventId: 12,
        toolUseId: 'edit-1',
        content: 'ok',
        isError: false,
      },
    ];

    expect(deriveFileOps(events)).toEqual([
      {
        path: 'App.tsx',
        fullPath: '/tmp/src/App.tsx',
        ops: ['edit'],
        opCounts: { read: 0, write: 0, edit: 1, delete: 0 },
        total: 1,
        status: 'done',
      },
    ]);
  });

  it('marks unresolved file operations as done after a successful terminal event', () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', id: 'write-1', name: 'Write', input: { path: 'README.md' } },
      { type: 'end', code: 0, signal: null, status: 'succeeded' },
    ];

    expect(deriveFileOps(events)).toEqual([
      {
        path: 'README.md',
        fullPath: 'README.md',
        ops: ['write'],
        opCounts: { read: 0, write: 1, edit: 0, delete: 0 },
        total: 1,
        status: 'done',
      },
    ]);
  });
});
