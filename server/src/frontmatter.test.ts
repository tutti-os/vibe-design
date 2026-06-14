import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('returns an empty frontmatter object and the original body when no frontmatter exists', () => {
    expect(parseFrontmatter('# body')).toEqual({
      frontmatter: {},
      body: '# body',
    });
  });

  it('parses scalar values from YAML frontmatter', () => {
    const parsed = parseFrontmatter(`---
name: landing-page
featured: 1
published: true
optional: null
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      name: 'landing-page',
      featured: 1,
      published: true,
      optional: null,
    });
  });

  it('parses block arrays and inline arrays', () => {
    const parsed = parseFrontmatter(`---
triggers:
  - landing page
  - hero section
default_for: [web, prototype]
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      triggers: ['landing page', 'hero section'],
      default_for: ['web', 'prototype'],
    });
  });

  it('parses nested objects including od.craft.requires arrays', () => {
    const parsed = parseFrontmatter(`---
od:
  mode: prototype
  craft:
    requires:
      - typography-scale
      - spacing-system
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      od: {
        mode: 'prototype',
        craft: {
          requires: ['typography-scale', 'spacing-system'],
        },
      },
    });
  });

  it('preserves literal block string newlines', () => {
    const parsed = parseFrontmatter(`---
example_prompt: |
  Build a dashboard.
  Include charts.
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      example_prompt: 'Build a dashboard.\nInclude charts.\n',
    });
  });

  it('strips the final newline from literal strip block strings', () => {
    const parsed = parseFrontmatter(`---
example_prompt: |-
  Build a dashboard.
  Include charts.
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      example_prompt: 'Build a dashboard.\nInclude charts.',
    });
  });

  it('folds folded block strings into spaces', () => {
    const parsed = parseFrontmatter(`---
description: >
  Build a dashboard.
  Include charts.
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      description: 'Build a dashboard. Include charts.\n',
    });
  });

  it('strips the final newline from folded strip block strings', () => {
    const parsed = parseFrontmatter(`---
description: >-
  Build a dashboard.
  Include charts.
---
# Workflow`);

    expect(parsed.frontmatter).toEqual({
      description: 'Build a dashboard. Include charts.',
    });
  });

  it('extracts the body after the closing frontmatter marker', () => {
    const parsed = parseFrontmatter(`---
name: landing-page
---
# Workflow

Use the active skill.`);

    expect(parsed.body).toBe('# Workflow\n\nUse the active skill.');
  });

  it('handles a leading BOM and CRLF line endings', () => {
    const parsed = parseFrontmatter(
      '\uFEFF---\r\nname: landing-page\r\ntriggers:\r\n  - landing page\r\n---\r\n# Workflow\r\n',
    );

    expect(parsed).toEqual({
      frontmatter: {
        name: 'landing-page',
        triggers: ['landing page'],
      },
      body: '# Workflow\r\n',
    });
  });
});
