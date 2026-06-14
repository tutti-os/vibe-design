import type { ServerResponse } from 'node:http';

export interface SseResponseOptions {
  keepAliveMs?: number;
}

export interface SseResponse {
  send(event: string, data: unknown, id?: string | number | null): boolean;
  writeKeepAlive(): boolean;
  cleanup(): void;
  end(): void;
}

export function createSseResponse(res: ServerResponse, options: SseResponseOptions = {}): SseResponse {
  let keepAliveInterval: NodeJS.Timeout | null = null;
  let cleanedUp = false;

  const isWritable = () => !res.destroyed && !res.writableEnded && !res.writableFinished;

  const write = (chunk: string): boolean => {
    if (!isWritable()) {
      return false;
    }

    try {
      res.write(chunk);
      return true;
    } catch {
      return false;
    }
  };

  const sse: SseResponse = {
    send(event, data, id) {
      const idLine = id === undefined || id === null ? '' : `id: ${id}\n`;
      return write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    writeKeepAlive() {
      return write(': keepalive\n\n');
    },
    cleanup() {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      if (keepAliveInterval !== null) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      res.off('close', sse.cleanup);
      res.off('finish', sse.cleanup);
    },
    end() {
      sse.cleanup();
      if (!isWritable()) {
        return;
      }

      res.end();
    },
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.on('close', sse.cleanup);
  res.on('finish', sse.cleanup);

  const keepAliveMs = options.keepAliveMs ?? 0;
  if (keepAliveMs > 0) {
    keepAliveInterval = setInterval(() => {
      if (!sse.writeKeepAlive()) {
        sse.cleanup();
      }
    }, keepAliveMs);
  }

  return sse;
}

export function createSseErrorPayload(
  code: string,
  message: string,
  init?: Record<string, unknown>,
): { code: string; message: string } & Record<string, unknown> {
  return { code, message, ...init };
}
