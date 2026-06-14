import type { Express, Request, Response } from 'express';
import type { RouteDeps, SubmitToolResultResult } from '../server-context.js';

const FEEDBACK_REASON_ALLOWLIST = new Set([
  'matched_request',
  'strong_visual',
  'useful_structure',
  'easy_to_continue',
  'followed_design_system',
  'missed_request',
  'weak_visual',
  'incomplete_output',
  'hard_to_use',
  'missed_design_system',
  'other',
]);

type ChatRouteDeps = RouteDeps<'design' | 'http' | 'chat' | 'telemetry'>;
type RunParams = { id: string };
type FeedbackRating = 'positive' | 'negative';

function readBody(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const reasonCodes: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !FEEDBACK_REASON_ALLOWLIST.has(item) || seen.has(item)) {
      continue;
    }

    seen.add(item);
    reasonCodes.push(item);
  }

  return reasonCodes;
}

function sendToolResultError(
  res: Response,
  sendApiError: ChatRouteDeps['http']['sendApiError'],
  result: SubmitToolResultResult,
): void {
  const reason = result.reason ?? 'write_failed';

  if (reason === 'not_found') {
    sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    return;
  }

  if (reason === 'run_terminal' || reason === 'stdin_closed') {
    sendApiError(res, 410, 'GONE', `run is no longer accepting tool results (${reason})`);
    return;
  }

  if (reason === 'stdin_text_mode') {
    sendApiError(res, 400, 'BAD_REQUEST', 'run does not support interactive tool results');
    return;
  }

  if (reason === 'bad_tool_use_id') {
    sendApiError(res, 400, 'BAD_REQUEST', 'toolUseId is invalid');
    return;
  }

  sendApiError(res, 500, 'INTERNAL', `tool result write failed: ${reason}`);
}

export function registerChatRoutes(app: Express, ctx: ChatRouteDeps): void {
  const { runs } = ctx.design;
  const { sendApiError } = ctx.http;

  app.get('/api/runs', (req: Request, res: Response) => {
    res.json({
      runs: runs
        .list({
          projectId: req.query.projectId,
          conversationId: req.query.conversationId,
          status: req.query.status,
        })
        .map((run) => runs.statusBody(run)),
    });
  });

  app.get('/api/runs/:id', (req: Request<RunParams>, res: Response) => {
    const run = runs.get(req.params.id);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'run not found');
      return;
    }

    res.json(runs.statusBody(run));
  });

  app.get('/api/runs/:id/events', (req: Request<RunParams>, res: Response) => {
    const run = runs.get(req.params.id);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'run not found');
      return;
    }

    runs.stream(run, req, res);
  });

  app.post('/api/runs/:id/cancel', (req: Request<RunParams>, res: Response) => {
    const run = runs.get(req.params.id);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'run not found');
      return;
    }

    runs.cancel(run);
    res.json({ ok: true });
  });

  app.post('/api/runs/:id/tool-result', (req: Request<RunParams, unknown, unknown>, res: Response) => {
    const body = readBody(req.body);
    const toolUseId = readString(body.toolUseId);
    if (!toolUseId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'toolUseId is required');
      return;
    }

    const content = readString(body.content) ?? '';
    const isError = typeof body.isError === 'boolean' ? body.isError : undefined;
    const result = ctx.chat.submitToolResultToRun(req.params.id, toolUseId, content, isError);
    if (!result.ok) {
      sendToolResultError(res, sendApiError, result);
      return;
    }

    res.json({ ok: true });
  });

  app.post('/api/runs/:id/feedback', async (req: Request<RunParams, unknown, unknown>, res: Response) => {
    const run = runs.get(req.params.id);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'run not found');
      return;
    }

    const body = readBody(req.body);
    const rating = readString(body.rating);
    if (rating !== 'positive' && rating !== 'negative') {
      sendApiError(res, 400, 'BAD_REQUEST', 'rating must be positive or negative');
      return;
    }

    const customReason = readString(body.customReason) ?? '';
    const reportFeedback = ctx.telemetry?.reportFeedback;
    if (!reportFeedback) {
      res.status(202).json({ status: 'skipped_no_sink' });
      return;
    }

    const outcome = await reportFeedback({
      runId: req.params.id,
      rating: rating as FeedbackRating,
      reasonCodes: readReasonCodes(body.reasonCodes),
      hasCustomReason: customReason.trim().length > 0,
      customReason,
      scoreMetadata: readBody(body.scoreMetadata),
    });

    res.status(202).json(outcome);
  });
}
