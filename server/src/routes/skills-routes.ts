import type { Express, Request, Response } from 'express';
import { deleteUserSkill, findSkillById, importUserSkill, listSkills } from '../skills.js';
import type { RouteDeps } from '../server-context.js';

type SkillsRouteDeps = RouteDeps<'paths'>;
type SkillParams = { id: string };

const MAX_SKILL_IMPORT_BYTES = 1024 * 1024;

export function registerSkillsRoutes(app: Express, ctx: SkillsRouteDeps): void {
  app.get('/api/skills', async (_req: Request, res: Response) => {
    const skills = await listSkills(getSkillRoots(ctx));
    res.json({ skills });
  });

  app.post('/api/skills', async (req: Request, res: Response) => {
    if (!isJsonRequest(req)) {
      res.status(400).json({ error: 'Expected application/json request body.' });
      return;
    }

    if (isOversizedRequest(req)) {
      res.status(413).json({ error: 'Request body is too large.' });
      return;
    }

    if (!isImportSkillBody(req.body)) {
      res.status(400).json({ error: 'Invalid skill import body.' });
      return;
    }

    try {
      const imported = await importUserSkill(ctx.paths.userSkillsRoot, req.body);
      res.status(201).json(imported);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid skill import body.',
      });
    }
  });

  app.get('/api/skills/:id', async (req: Request<SkillParams>, res: Response) => {
    const skill = findSkillById(await listSkills(getSkillRoots(ctx)), req.params.id);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found.' });
      return;
    }

    res.json(skill);
  });

  app.delete('/api/skills/:id', async (req: Request<SkillParams>, res: Response) => {
    const skills = await listSkills(getSkillRoots(ctx));
    const skill = findSkillById(skills, req.params.id);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found.' });
      return;
    }

    if (skill.source !== 'user') {
      res.status(403).json({ error: `Cannot delete built-in skill: ${skill.id}` });
      return;
    }

    await deleteUserSkill(skills, req.params.id);
    res.status(204).end();
  });
}

function getSkillRoots(ctx: SkillsRouteDeps): [string, string] {
  return [ctx.paths.userSkillsRoot, ctx.paths.builtInSkillsRoot];
}

function isJsonRequest(req: Request): boolean {
  return req.is('application/json') === 'application/json';
}

function isOversizedRequest(req: Request): boolean {
  const contentLength = Number(req.get('content-length'));
  return Number.isFinite(contentLength) && contentLength > MAX_SKILL_IMPORT_BYTES;
}

function isImportSkillBody(value: unknown): value is {
  name: string;
  description?: string;
  body: string;
  triggers?: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const input = value as Record<string, unknown>;
  return (
    typeof input.name === 'string' &&
    input.name.trim().length > 0 &&
    (input.description === undefined || typeof input.description === 'string') &&
    typeof input.body === 'string' &&
    input.body.trim().length > 0 &&
    (input.triggers === undefined ||
      (Array.isArray(input.triggers) && input.triggers.every((trigger) => typeof trigger === 'string')))
  );
}
