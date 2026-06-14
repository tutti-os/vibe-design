import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteUserSkill,
  findSkillById,
  importUserSkill,
  listSkills,
  resolveDerivedExamplePath,
  resolveSkillId,
  splitDerivedSkillId,
} from './skills';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibe-skills-'));
  tempDirs.push(root);
  return root;
}

async function writeSkill(
  root: string,
  folder: string,
  markdown: string,
): Promise<string> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), markdown, 'utf8');
  return dir;
}

describe('skills registry', () => {
  it('keeps bundled design brief clarification asks on the AskUserQuestion surface', async () => {
    const skills = await listSkills(join('..', 'skills'));
    const designBrief = findSkillById(skills, 'design-brief');

    expect(designBrief?.body).toContain('AskUserQuestion');
    expect(designBrief?.body).toContain('Do not render clarification questions as prose');
  });

  it('scans roots by priority, marks source, and normalizes metadata', async () => {
    const userRoot = await createTempRoot();
    const builtInRoot = await createTempRoot();

    await writeSkill(
      builtInRoot,
      'landing',
      `---
name: landing-page
description: Built-in landing description. It has a second sentence.
triggers:
  - landing page
od:
  mode: deck
  surface: image
  category: marketing
  featured: 4
  craft:
    requires:
      - typography-scale
  preview:
    type: screenshot
  design_system:
    required: false
  default_for: [prototype]
  upstream: https://example.test/upstream
  fidelity: wireframe
  speaker_notes: yes
  animations: no
  critique:
    policy: opt-in
  example_prompt: |-
    Use the built-in prompt.
---
# Built-in workflow`,
    );

    await writeSkill(
      userRoot,
      'landing',
      `---
name: landing-page
description: User landing description. It should win.
zh_description: 用户描述
triggers:
  - user landing
od:
  mode: prototype
  surface: web
  category: custom
  featured: true
  craft:
    requires:
      - spacing-system
  preview:
    type: html
  design_system:
    required: true
  default_for: custom-project
  upstream: user-import
  fidelity: high-fidelity
  speaker_notes: false
  animations: true
  critique:
    policy: required
  example_prompt_i18n:
    zh-CN: 自定义提示
---
# User workflow`,
    );

    const skills = await listSkills([userRoot, builtInRoot]);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'landing-page',
      name: 'landing-page',
      description: 'User landing description. It should win.',
      descriptionI18n: { 'zh-CN': '用户描述' },
      triggers: ['user landing'],
      mode: 'prototype',
      surface: 'web',
      source: 'user',
      craftRequires: ['spacing-system'],
      platform: null,
      scenario: '',
      category: 'custom',
      previewType: 'html',
      designSystemRequired: true,
      defaultFor: ['custom-project'],
      upstream: 'user-import',
      featured: 1,
      fidelity: 'high-fidelity',
      speakerNotes: false,
      animations: true,
      examplePrompt: 'User landing description.',
      examplePromptI18n: { 'zh-CN': '自定义提示' },
      aggregatesExamples: false,
      critiquePolicy: 'required',
      body: '# User workflow',
    });
  });

  it('finds skills through aliases', async () => {
    expect(resolveSkillId('editorial-collage')).toBe('vibe-design-landing');

    const builtInRoot = await createTempRoot();
    await writeSkill(
      builtInRoot,
      'vibe-design-landing',
      `---
name: vibe-design-landing
description: Canonical landing skill.
---
# Workflow`,
    );

    const skills = await listSkills(builtInRoot);

    expect(findSkillById(skills, 'editorial-collage')?.id).toBe(
      'vibe-design-landing',
    );
  });

  it('derives example skills from single-file HTML examples', async () => {
    const builtInRoot = await createTempRoot();
    const dir = await writeSkill(
      builtInRoot,
      'pricing',
      `---
name: pricing
description: Pricing page skill.
od:
  featured: 2
  mode: prototype
---
# Pricing workflow`,
    );
    await mkdir(join(dir, 'examples'), { recursive: true });
    await writeFile(join(dir, 'examples', 'pricing-grid.html'), '<html></html>');
    await writeFile(join(dir, 'examples', '.hidden.html'), '<html></html>');
    await writeFile(join(dir, 'examples', 'unsafe:key.html'), '<html></html>');

    const skills = await listSkills(builtInRoot);

    expect(skills.map((skill) => skill.id)).toEqual(['pricing', 'pricing:pricing-grid']);
    expect(skills[0]).toMatchObject({ aggregatesExamples: true, featured: 2 });
    expect(skills[1]).toMatchObject({
      id: 'pricing:pricing-grid',
      name: 'Pricing Grid',
      body: '# Pricing workflow',
      featured: null,
      aggregatesExamples: false,
      source: 'user',
      craftRequires: [],
      defaultFor: [],
    });
    expect(splitDerivedSkillId('pricing:pricing-grid')).toEqual({
      parentId: 'pricing',
      childKey: 'pricing-grid',
    });
    expect(splitDerivedSkillId('pricing:bad:key')).toBeNull();
    expect(resolveDerivedExamplePath(dir, 'pricing-grid')).toBe(
      join(dir, 'examples', 'pricing-grid.html'),
    );
    expect(resolveDerivedExamplePath(dir, '../escape')).toBeNull();
  });

  it('creates and deletes user skills while rejecting built-in and missing deletions', async () => {
    const userRoot = await createTempRoot();
    const builtInRoot = await createTempRoot();
    await writeSkill(
      builtInRoot,
      'built-in-only',
      `---
name: built-in-only
description: Built in only.
---
# Built-in`,
    );

    const created = await importUserSkill(userRoot, {
      name: 'My Custom Skill',
      description: 'Creates a custom workflow.',
      triggers: ['custom', 'workflow'],
      body: '# Custom workflow',
    });

    expect(created).toMatchObject({
      id: 'my-custom-skill',
      slug: 'my-custom-skill',
      dir: join(userRoot, 'my-custom-skill'),
    });

    let skills = await listSkills([userRoot, builtInRoot]);
    expect(findSkillById(skills, 'my-custom-skill')).toMatchObject({
      id: 'my-custom-skill',
      source: 'user',
      description: 'Creates a custom workflow.',
      triggers: ['custom', 'workflow'],
      body: '# Custom workflow',
    });

    await expect(deleteUserSkill(skills, 'built-in-only')).rejects.toThrow(
      /built-in/i,
    );
    await expect(deleteUserSkill(skills, 'missing-skill')).rejects.toThrow(
      /not found/i,
    );

    await deleteUserSkill(skills, 'my-custom-skill');
    skills = await listSkills([userRoot, builtInRoot]);
    expect(findSkillById(skills, 'my-custom-skill')).toBeUndefined();
  });

  it('rejects duplicate user skill imports without overwriting the existing SKILL.md', async () => {
    const userRoot = await createTempRoot();

    const created = await importUserSkill(userRoot, {
      name: 'My Custom Skill',
      description: 'Original description.',
      body: '# Original workflow',
    });
    const originalMarkdown = await readFile(join(created.dir, 'SKILL.md'), 'utf8');

    await expect(
      importUserSkill(userRoot, {
        name: 'My Custom Skill',
        description: 'Replacement description.',
        body: '# Replacement workflow',
      }),
    ).rejects.toThrow(/conflict|already exists/i);

    await expect(readFile(join(created.dir, 'SKILL.md'), 'utf8')).resolves.toBe(
      originalMarkdown,
    );

    const skills = await listSkills(userRoot);
    expect(findSkillById(skills, 'my-custom-skill')).toMatchObject({
      description: 'Original description.',
      body: '# Original workflow',
    });
  });

  it('quotes imported skill ids that look like YAML scalar values', async () => {
    const userRoot = await createTempRoot();
    const scalarLikeNames = ['true', 'false', 'null', '123'];

    for (const name of scalarLikeNames) {
      await importUserSkill(userRoot, {
        name,
        description: `Skill named ${name}.`,
        body: `# ${name}`,
      });
    }

    const skills = await listSkills(userRoot);

    expect(skills.map((skill) => skill.id).sort()).toEqual([
      '123',
      'false',
      'null',
      'true',
    ]);
    for (const name of scalarLikeNames) {
      expect(findSkillById(skills, name)).toMatchObject({
        id: name,
        name,
        body: `# ${name}`,
      });
    }
  });

  it('skips unreadable roots and invalid skill entries during discovery', async () => {
    const missingRoot = join(await createTempRoot(), 'does-not-exist');
    const validRoot = await createTempRoot();
    await writeSkill(
      validRoot,
      'valid',
      `---
name: valid
description: Valid skill.
---
# Valid`,
    );
    await writeSkill(
      validRoot,
      'bad',
      `---
name: bad
triggers:
  -
---
# Bad`,
    );
    await mkdir(join(validRoot, 'empty'), { recursive: true });

    const skills = await listSkills([missingRoot, validRoot]);

    expect(skills.map((skill) => skill.id)).toEqual(['valid']);
  });
});
