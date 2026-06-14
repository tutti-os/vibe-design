import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchRunApi } from './run-api';
import type { AgentEvent, CanvasCommentAttachment, RunStatus } from '../../types';

describe('FetchRunApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports an error when the stream reaches EOF before a terminal end event', async () => {
    const fetch = vi.fn(async () => new Response(createStream(['event: text_delta\ndata: {"delta":"Hi"}\n\n'])));
    vi.stubGlobal('fetch', fetch);
    const handlers = createHandlers();

    new FetchRunApi().streamRun('run-1', handlers);

    await waitFor(() => {
      expect(handlers.onError).toHaveBeenCalledTimes(1);
    });
    expect(handlers.onEnd).not.toHaveBeenCalled();
  });

  it('finalizes on terminal end and suppresses later stream errors', async () => {
    const fetch = vi.fn(async () => new Response(createFailingStreamAfterEnd()));
    vi.stubGlobal('fetch', fetch);
    const handlers = createHandlers();

    new FetchRunApi().streamRun('run-1', handlers);

    await waitFor(() => {
      expect(handlers.onEnd).toHaveBeenCalledWith('succeeded');
    });
    await delay(0);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('passes the resume cursor to the stream request query and Last-Event-ID header', async () => {
    const fetch = vi.fn(async () => new Response(createStream(['event: end\ndata: {"status":"succeeded","code":0,"signal":null}\n\n'])));
    vi.stubGlobal('fetch', fetch);
    const handlers = createHandlers();

    new FetchRunApi().streamRun('run-1', handlers, 17);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/runs/run-1/events?after=17', {
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: { 'Last-Event-ID': '17' },
      });
    });
  });

  it('serializes preview comment attachments when creating a run', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ runId: 'run-1' }));
    vi.stubGlobal('fetch', fetch);
    const commentAttachments = [commentAttachment()];

    await expect(
      new FetchRunApi().createRun({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        prompt: 'Apply comment',
        commentAttachments,
      }),
    ).resolves.toEqual({ runId: 'run-1' });

    const request = fetch.mock.calls[0]?.[1];
    if (!request) {
      throw new Error('expected createRun request options');
    }
    expect(JSON.parse(String(request.body))).toMatchObject({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      prompt: 'Apply comment',
      commentAttachments,
    });
  });

  it('throws the nested API error message when creating a run fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: {
            code: 'CONVERSATION_PROVIDER_LOCKED',
            message: 'conversation already uses provider codex',
          },
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      new FetchRunApi().createRun({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        prompt: 'Try switching',
        agentId: 'claude',
      }),
    ).rejects.toThrow('conversation already uses provider codex');
  });

  it('throws a clear error when the browser request API is unavailable', async () => {
    vi.stubGlobal('fetch', undefined);

    await expect(
      new FetchRunApi().createRun({
        projectId: 'project-1',
        prompt: 'Try sending',
        agentId: 'claude',
      }),
    ).rejects.toThrow('Browser request API is unavailable.');
  });
});

function commentAttachment(): CanvasCommentAttachment {
  return {
    id: 'comment-1',
    order: 1,
    filePath: 'index.html',
    targetId: 'hero-title',
    selector: '#hero-title',
    label: 'Hero title',
    comment: 'Tighten spacing',
    currentText: 'Heading',
    pagePosition: { x: 1, y: 2, width: 3, height: 4 },
    htmlHint: '<h1>Heading</h1>',
    selectionKind: 'element',
    source: 'board-batch',
  };
}

function createHandlers() {
  return {
    onEvent: vi.fn<(event: AgentEvent) => void>(),
    onEnd: vi.fn<(status: RunStatus) => void>(),
    onError: vi.fn<(error: Error) => void>(),
  };
}

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function createFailingStreamAfterEnd(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pullCount = 0;

  return new ReadableStream({
    pull(controller) {
      if (pullCount === 0) {
        pullCount += 1;
        controller.enqueue(encoder.encode('event: end\ndata: {"status":"succeeded","code":0,"signal":null}\n\n'));
        return;
      }
      controller.error(new Error('network failed after end'));
    },
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(10);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
