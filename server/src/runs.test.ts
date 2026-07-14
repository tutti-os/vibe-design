import { describe, expect, it } from 'vitest';

import { createChatRunService } from './runs.js';
import type { SseResponse } from './http/sse.js';

function createNoopSseResponse(): SseResponse {
  return {
    send: () => true,
    writeKeepAlive: () => true,
    cleanup: () => undefined,
    end: () => undefined,
  };
}

function createRuns() {
  return createChatRunService({
    createSseResponse: createNoopSseResponse,
    createSseErrorPayload: (code, message, init) => ({ code, message, ...init }),
    runsLogDir: null,
  });
}

describe('createChatRunService.create', () => {
  it('rejects mixed exact-target and deprecated agent metadata', () => {
    expect(() => createRuns().create({
      agentTargetId: 'team:writer',
      provider: 'codex',
      agentId: 'codex',
    })).toThrow('Provide exact agentTargetId metadata or deprecated agentId metadata, not both.');
  });

  it('does not fabricate an exact target when an explicit provider accompanies legacy metadata', () => {
    expect(createRuns().create({ provider: 'codex', agentId: 'codex' })).toMatchObject({
      agentTargetId: null,
      provider: 'codex',
      agentId: 'codex',
    });
  });
});
