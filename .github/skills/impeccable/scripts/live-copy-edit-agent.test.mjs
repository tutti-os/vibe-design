import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  chooseCopyEditAgent,
  runCopyEditBatchAgent,
  selectCopyEditAgentTarget,
} from './live-copy-edit-agent.mjs';
import { readOptionalAgentTargetIdArg } from './live-commit-manual-edits.mjs';

const CATALOG = {
  schemaVersion: 1,
  defaultAgentTargetId: 'team:reviewer',
  agents: [
    {
      id: 'team:writer',
      name: 'Writer',
      provider: 'example-provider',
      availability: { status: 'available', reasonCode: '', detail: '' },
    },
    {
      id: 'team:reviewer',
      name: 'Reviewer',
      provider: 'example-provider',
      availability: { status: 'available', reasonCode: '', detail: '' },
    },
  ],
};

test('selects the exact catalog default without collapsing same-provider targets', () => {
  assert.deepEqual(selectCopyEditAgentTarget(CATALOG), {
    agentTargetId: 'team:reviewer',
    name: 'Reviewer',
    availability: { status: 'available', reasonCode: '', detail: '' },
  });
  assert.equal(selectCopyEditAgentTarget(CATALOG, 'team:writer').agentTargetId, 'team:writer');
});

test('fails closed when the requested or default target is unavailable', () => {
  const unavailable = {
    ...CATALOG,
    agents: CATALOG.agents.map((agent) => agent.id === 'team:reviewer'
      ? { ...agent, availability: { status: 'unavailable', detail: 'runtime missing' } }
      : agent),
  };
  assert.throws(
    () => selectCopyEditAgentTarget(unavailable),
    /team:reviewer is unavailable: runtime missing/,
  );
  assert.throws(
    () => selectCopyEditAgentTarget(CATALOG, 'team:missing'),
    /team:missing is not in the current catalog/,
  );
});

test('does not reinterpret retired provider runner modes as Agent Target ids', () => {
  assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT_MODE: 'agent' } }), 'agent');
  assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'auto' } }), null);
  assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'codex' } }), null);
  assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'claude' } }), null);
});

test('rejects blank exact Agent Target CLI arguments instead of using the default', () => {
  assert.equal(readOptionalAgentTargetIdArg([]), undefined);
  assert.equal(readOptionalAgentTargetIdArg(['--agent-id=team:writer']), 'team:writer');
  assert.throws(() => readOptionalAgentTargetIdArg(['--agent-id']), /requires a non-empty/);
  assert.throws(() => readOptionalAgentTargetIdArg(['--agent-id=   ']), /requires a non-empty/);
});

test('discovers, starts, and verifies one exact Agent Target', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-agent-target-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const calls = [];
  const runTuttiCliJson = async (args, context) => {
    calls.push({ args, context });
    const command = args.slice(1, 3).join(' ');
    if (command === 'agent list') return { value: CATALOG };
    if (command === 'agent start') {
      return {
        value: {
          launchRequested: false,
          session: { agentSessionId: 'session-1', agentTargetId: 'team:writer' },
        },
      };
    }
    if (command === 'agent wait') return { value: { timedOut: false, messages: [] } };
    if (command === 'agent session-summary') {
      return {
        value: {
          messages: [{
            role: 'assistant',
            text: JSON.stringify({
              status: 'done',
              appliedEntryIds: ['entry-1'],
              files: ['src/page.tsx'],
              notes: [],
            }),
          }],
        },
      };
    }
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };

  const result = await runCopyEditBatchAgent({ entries: [{ id: 'entry-1', ops: [] }] }, {
    cwd,
    outDir: path.join(cwd, 'out'),
    agentTargetId: 'team:writer',
    runTuttiCliJson,
  });

  assert.equal(result.status, 'done');
  assert.deepEqual(result.appliedEntryIds, ['entry-1']);
  assert.deepEqual(calls.map((call) => call.args.slice(1, 3).join(' ')), [
    'agent list',
    'agent start',
    'agent wait',
    'agent session-summary',
  ]);
  const start = calls[1].args;
  assert.deepEqual(start.slice(start.indexOf('--agent-id'), start.indexOf('--agent-id') + 2), [
    '--agent-id',
    'team:writer',
  ]);
  assert.equal(start.includes('--provider'), false);
  assert.ok(calls.every((call) => call.context.cwd === cwd));
});

test('rejects a session that reports a different Agent Target identity', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-agent-target-mismatch-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const runTuttiCliJson = async (args) => {
    const command = args.slice(1, 3).join(' ');
    if (command === 'agent list') return CATALOG;
    if (command === 'agent start') {
      return {
        launchRequested: false,
        session: { agentSessionId: 'session-1', agentTargetId: 'team:reviewer' },
      };
    }
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };

  await assert.rejects(
    runCopyEditBatchAgent({ entries: [] }, {
      cwd,
      outDir: path.join(cwd, 'out'),
      agentTargetId: 'team:writer',
      runTuttiCliJson,
    }),
    /without the selected exact Agent Target identity/,
  );
});
