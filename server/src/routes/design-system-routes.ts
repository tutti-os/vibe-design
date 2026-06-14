import type { Express, Request, Response } from 'express';
import {
  createUserDesignSystem,
  deleteUserDesignSystem,
  isSafeDesignSystemId,
  listAvailableDesignSystems,
  readAvailableDesignSystemDetail,
  resolveDesignSystemAssets,
  renderDesignSystemPreview,
  updateUserDesignSystem,
} from '../design-systems.js';
import type { RouteDeps } from '../server-context.js';

type DesignSystemRouteDeps = RouteDeps<'http' | 'paths'>;

export function registerDesignSystemRoutes(app: Express, ctx: DesignSystemRouteDeps): void {
  const { sendApiError } = ctx.http;

  app.get('/api/design-systems', async (req: Request, res: Response): Promise<void> => {
    try {
      const systems = await listAvailableDesignSystems({
        builtInRoot: ctx.paths.builtInDesignSystemsRoot,
        userRoot: ctx.paths.userDesignSystemsRoot,
        locale: readDesignSystemLocale(req),
      });
      res.json({
        designSystems: systems.map(({ body: _body, ...summary }) => summary),
      });
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL', error instanceof Error ? error.message : 'design systems list failed');
    }
  });

  app.post('/api/design-systems', async (req: Request<unknown, unknown, unknown>, res: Response): Promise<void> => {
    try {
      const input = readDesignSystemWriteInput(req.body);
      if (!input) {
        sendApiError(res, 400, 'BAD_REQUEST', 'design system title is required');
        return;
      }
      const created = await createUserDesignSystem(ctx.paths.userDesignSystemsRoot, input);
      res.status(201).json({ ...created, designSystem: created });
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : 'design system create failed');
    }
  });

  app.get('/api/design-systems/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeDesignSystemId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'design system id is invalid');
      return;
    }

    try {
      const detail = await readAvailableDesignSystemDetail({
        builtInRoot: ctx.paths.builtInDesignSystemsRoot,
        userRoot: ctx.paths.userDesignSystemsRoot,
        id,
        locale: readDesignSystemLocale(req),
      });
      if (!detail) {
        sendApiError(res, 404, 'DESIGN_SYSTEM_NOT_FOUND', 'design system not found');
        return;
      }
      res.json({ ...detail, designSystem: detail });
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL', error instanceof Error ? error.message : 'design system read failed');
    }
  });

  app.patch('/api/design-systems/:id', async (
    req: Request<{ id: string }, unknown, unknown>,
    res: Response,
  ): Promise<void> => {
    const id = req.params.id;
    if (!isSafeDesignSystemId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'design system id is invalid');
      return;
    }

    try {
      const updated = await updateUserDesignSystem(
        ctx.paths.userDesignSystemsRoot,
        id,
        readDesignSystemWriteInput(req.body, { allowPartial: true }) ?? {},
      );
      if (!updated) {
        sendApiError(res, 404, 'DESIGN_SYSTEM_NOT_FOUND', 'editable design system not found');
        return;
      }
      res.json({ ...updated, designSystem: updated });
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : 'design system update failed');
    }
  });

  app.delete('/api/design-systems/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeDesignSystemId(id)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'design system id is invalid');
      return;
    }

    try {
      const deleted = await deleteUserDesignSystem(ctx.paths.userDesignSystemsRoot, id);
      if (!deleted) {
        sendApiError(res, 404, 'DESIGN_SYSTEM_NOT_FOUND', 'editable design system not found');
        return;
      }
      res.status(204).end();
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL', error instanceof Error ? error.message : 'design system delete failed');
    }
  });

  app.get('/api/design-systems/:id/preview', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = req.params.id;
    if (!isSafeDesignSystemId(id)) {
      res.status(400).type('text/plain').send('Design system id is invalid.');
      return;
    }

    try {
      const detail = await readAvailableDesignSystemDetail({
        builtInRoot: ctx.paths.builtInDesignSystemsRoot,
        userRoot: ctx.paths.userDesignSystemsRoot,
        id,
        locale: readDesignSystemLocale(req),
      });
      if (!detail) {
        res.status(404).type('text/plain').send('Design system not found.');
        return;
      }
      const assets = await resolveDesignSystemAssets({
        builtInRoot: ctx.paths.builtInDesignSystemsRoot,
        userRoot: ctx.paths.userDesignSystemsRoot,
        id,
        locale: readDesignSystemLocale(req),
      });
      const previewBody = assets.tokensCss ? `${detail.body}\n\n${assets.tokensCss}` : detail.body;
      res.type('html').send(renderDesignSystemPreview(detail.id, previewBody));
    } catch (error) {
      res.status(500).type('text/plain').send(error instanceof Error ? error.message : 'Design system preview failed.');
    }
  });
}

function readDesignSystemWriteInput(
  value: unknown,
  options: { allowPartial?: boolean } = {},
): {
  title?: string;
  category?: string;
  summary?: string;
  body?: string;
  status?: 'draft' | 'published';
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return options.allowPartial ? {} : null;
  }

  const input = value as Record<string, unknown>;
  const title = readString(input.title);
  if (!options.allowPartial && !title) {
    return null;
  }

  const status = readString(input.status);
  return {
    ...(title ? { title } : {}),
    ...(readString(input.category) ? { category: readString(input.category) as string } : {}),
    ...(readString(input.summary) ? { summary: readString(input.summary) as string } : {}),
    ...(readString(input.body) ? { body: readString(input.body) as string } : {}),
    ...(status === 'draft' || status === 'published' ? { status } : {}),
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readDesignSystemLocale(req: Request): string | undefined {
  return readString(req.query.locale) ?? readAcceptLanguage(req.get('accept-language')) ?? undefined;
}

function readAcceptLanguage(value: unknown): string | null {
  const header = readString(value);
  if (!header) return null;

  for (const item of header.split(',')) {
    const locale = item.split(';')[0]?.trim();
    if (locale) return locale;
  }

  return null;
}
