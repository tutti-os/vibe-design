import type { Response } from 'express';
import type { SseResponse } from './http/sse.js';
import type { ChatRunService } from './types/run.js';

export interface HttpDeps {
  createSseResponse: (res: Response) => SseResponse;
  createSseErrorPayload: (code: string, message: string, init?: Record<string, unknown>) => unknown;
  sendApiError: (
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) => void;
}

export interface PathDeps {
  runtimeDir: string;
  projectsDir: string;
  runsLogDir: string;
  userSkillsRoot: string;
  builtInSkillsRoot: string;
  userDesignSystemsRoot: string;
  builtInDesignSystemsRoot: string;
}

export interface SubmitToolResultResult {
  ok: boolean;
  reason?: 'not_found' | 'run_terminal' | 'stdin_closed' | 'stdin_text_mode' | 'bad_tool_use_id' | 'write_failed';
  error?: string;
}

export interface ServerContext {
  design: {
    runs: ChatRunService;
  };
  http: HttpDeps;
  paths: PathDeps;
  chat: {
    submitToolResultToRun: (
      runId: string,
      toolUseId: string,
      content: string,
      isError?: boolean,
    ) => SubmitToolResultResult;
  };
  telemetry?: {
    reportFeedback?: (input: {
      runId: string;
      rating: 'positive' | 'negative';
      reasonCodes: string[];
      hasCustomReason: boolean;
      customReason: string;
      scoreMetadata?: Record<string, unknown>;
    }) => Promise<{ status: 'accepted' | 'skipped_consent' | 'skipped_no_sink' }>;
  };
}

export type RouteDeps<K extends keyof ServerContext> = Pick<ServerContext, K>;
