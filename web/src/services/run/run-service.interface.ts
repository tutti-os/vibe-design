import { createDecorator } from '@tutti-os/infra/di';
import type { CreateRunInput, CreateRunResult, IDisposable, RunStreamHandlers } from './run-types';

export interface IRunService {
  readonly _serviceBrand: undefined;
  createRun(input: CreateRunInput): Promise<CreateRunResult>;
  streamRun(runId: string, handlers: RunStreamHandlers, lastEventId?: number | string | null): IDisposable;
  stopRun(runId: string): Promise<void>;
  submitToolResult(runId: string, toolUseId: string, content: string): Promise<void>;
}

export const IRunService = createDecorator<IRunService>('run-service');
