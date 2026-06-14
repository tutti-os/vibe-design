import { describe, expect, it } from 'vitest';
import { composeSystemPrompt } from './system';

function indexOfRequired(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index, `Expected prompt to contain ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('composeSystemPrompt', () => {
  it('is a synchronous function and places the locale override before discovery and identity', () => {
    const result = composeSystemPrompt({ locale: 'zh-CN' });

    expect(typeof result).toBe('string');
    expect(result).not.toHaveProperty('then');

    const localeIndex = indexOfRequired(result, '# UI locale override');
    const discoveryIndex = indexOfRequired(result, '# Vibe Design discovery directives');
    const identityIndex = indexOfRequired(result, '# Identity and workflow charter');

    expect(localeIndex).toBeLessThan(discoveryIndex);
    expect(discoveryIndex).toBeLessThan(identityIndex);
  });

  it('tells agents to answer from multi-turn conversation language independent of UI locale', () => {
    const result = composeSystemPrompt({ locale: 'en' });

    const languageIndex = indexOfRequired(result, '# Response language');
    const discoveryIndex = indexOfRequired(result, '# Vibe Design discovery directives');

    expect(result).toContain('Decide the response language from the multi-turn conversation context');
    expect(result).toContain('Do not switch languages only because the most recent user message uses a different language');
    expect(result).not.toContain('Match the language of the latest user message');
    expect(result).toContain('Keep machine-readable ids, file paths, code identifiers');
    expect(languageIndex).toBeLessThan(discoveryIndex);
  });

  it('requires agents to stop after asking the user a question', () => {
    const result = composeSystemPrompt({ agentId: 'claude', skillMode: 'prototype' });

    const questionStopIndex = indexOfRequired(result, '# Question stop rule');
    const discoveryIndex = indexOfRequired(result, '# Vibe Design discovery directives');

    expect(result).toContain('After asking the user a question through `AskUserQuestion`, stop the turn immediately');
    expect(result).toContain('Do not write files, generate artifacts, call additional tools');
    expect(result).toContain('AskUserQuestion');
    expect(result).toContain('If a non-question host tool call does not return a tool result');
    expect(result).not.toContain('If a runtime does not return a tool result, continue with visible text and artifact output instead of waiting silently.');
    expect(questionStopIndex).toBeLessThan(discoveryIndex);
  });

  it('requires AskUserQuestion to batch unresolved single-select questions', () => {
    const result = composeSystemPrompt({ agentId: 'claude', skillMode: 'prototype' });

    const formatIndex = indexOfRequired(result, '# Question output format');
    const discoveryIndex = indexOfRequired(result, '# Vibe Design discovery directives');

    expect(result).toContain('Ask all material unresolved decisions in one batch');
    expect(result).toContain('AskUserQuestion');
    expect(result).toContain('one `questions` entry');
    expect(result).toContain('per decision');
    expect(result).toContain('2-4 mutually exclusive options');
    expect(result).toContain('Do not use free-text, textarea, checkbox, or multi-select inputs');
    expect(result).toContain('Do not ask one question per turn when several required decisions are already known');
    expect(result).toContain('Use inline `<question-form>` only when a structured AskUserQuestion tool call is unavailable');
    expect(result).toContain('This is a strict rendering contract');
    expect(result).not.toContain('ask only the highest-priority question now');
    expect(formatIndex).toBeLessThan(discoveryIndex);
  });

  it('routes missing tool support through the inline question-form fallback', () => {
    const result = composeSystemPrompt({ agentId: 'codex', skillMode: 'prototype' });

    expect(result).toContain('AskUserQuestion is an application interaction contract');
    expect(result).toContain('Do not print an `AskUserQuestion` JSON object');
    expect(result).toContain('Do not render the choices as a markdown numbered list');
    expect(result).toContain('If the provider cannot emit a structured AskUserQuestion tool call');
    expect(result).toContain('emit exactly one inline `<question-form>` block');
    expect(result).not.toContain('requires an AskUserQuestion-capable host surface');
  });

  it('keeps turn-one discovery options out of visible prose', () => {
    const result = composeSystemPrompt({ agentId: 'codex', skillMode: 'prototype' });

    expect(result).toContain('The prose line must not list, summarize, or preview the options');
    expect(result).toContain('Put every choice only inside `questions[].options`');
  });

  it('injects skill body verbatim without requiring a SkillInfo object', () => {
    const skillBody = `# Custom workflow

Keep this exact line: <do-not-normalize />`;

    const result = composeSystemPrompt({
      skillName: 'Custom Workflow',
      skillMode: 'prototype',
      skillBody,
    });

    expect(result).toContain('## Active skill — Custom Workflow');
    expect(result).toContain(skillBody);
  });

  it('limits skill usage to skills explicitly injected by Vibe Design', () => {
    const withSkill = composeSystemPrompt({
      skillName: 'Custom Workflow',
      skillBody: '# Custom workflow',
    });
    const withoutSkill = composeSystemPrompt({});

    expect(withSkill).toContain('## Skill boundary');
    expect(withSkill).toContain('Only use skills explicitly provided by Vibe Design in this system prompt.');
    expect(withSkill).toContain('Do not search for, load, invoke, or claim to follow any other skill');
    expect(indexOfRequired(withSkill, '## Skill boundary')).toBeLessThan(
      indexOfRequired(withSkill, '## Active skill — Custom Workflow'),
    );

    expect(withoutSkill).toContain('## Skill boundary');
    expect(withoutSkill).toContain('No active skill was provided for this run.');
    expect(withoutSkill).toContain('Do not search for, load, invoke, or claim to follow any skill');
  });

  it('keeps catalogue skill bodies from triggering host skill installation or invocation', () => {
    const skillBody = [
      '# Catalogue skill',
      '',
      'To run the full upstream workflow, install the upstream bundle into your active agent skills directory.',
      'Then ask the agent to invoke this skill by name (`catalogue-skill`).',
    ].join('\n');

    const result = composeSystemPrompt({
      skillName: 'Catalogue Skill',
      skillBody,
    });

    const bodyIndex = indexOfRequired(result, '# Catalogue skill');
    const boundaryIndex = indexOfRequired(result, 'The active skill above has already been injected into this prompt.');

    expect(boundaryIndex).toBeGreaterThan(bodyIndex);
    expect(result).not.toContain('install the upstream bundle');
    expect(result).not.toContain('active agent skills directory');
    expect(result).not.toContain('invoke this skill by name');
    expect(result.slice(boundaryIndex)).toContain('Do not call, invoke, load, or install any host Skill tool');
  });

  it('injects design system layers in the required order', () => {
    const result = composeSystemPrompt({
      designSystemTitle: 'Vibe Brand',
      designSystemUsageMd: 'Use the Vibe Brand exactly.',
      designSystemBody: '# DESIGN\nUse restrained contrast.',
      designSystemImportMode: 'hybrid',
      designSystemTokensCss: ':root { --color-accent: #0067ff; }',
      designSystemComponentsManifest: 'Button: .button-primary',
      designSystemPullIndex: 'references/source-button.html',
    });

    const usageIndex = indexOfRequired(result, '## How to use this design system — Vibe Brand');
    const bodyIndex = indexOfRequired(result, '## Active design system — Vibe Brand');
    const importIndex = indexOfRequired(result, '## Design system import mode — Vibe Brand');
    const tokensIndex = indexOfRequired(result, '## Active design system tokens — Vibe Brand');
    const manifestIndex = indexOfRequired(result, '## Reference component manifest — Vibe Brand');
    const pullIndex = indexOfRequired(result, '## Pull-layer files available on demand — Vibe Brand');

    expect(usageIndex).toBeLessThan(bodyIndex);
    expect(bodyIndex).toBeLessThan(importIndex);
    expect(importIndex).toBeLessThan(tokensIndex);
    expect(tokensIndex).toBeLessThan(manifestIndex);
    expect(manifestIndex).toBeLessThan(pullIndex);
  });

  it('adds the deck framework for deck mode without a skill seed', () => {
    const result = composeSystemPrompt({ skillMode: 'deck' });

    expect(result).toContain('## Slide deck framework');
    expect(result).toContain('1920x1080');
  });

  it('uses explicit skill seed metadata to inject preflight and skip the generic deck framework', () => {
    const result = composeSystemPrompt({
      skillMode: 'deck',
      hasSkillSeed: true,
      skillDir: '/tmp/vibe-skill/deck-seed',
      skillBody: '# Seeded deck skill\nUse the packaged template.',
    });

    expect(result).toContain('Before writing code, read and follow the seed template');
    expect(result).toContain('/tmp/vibe-skill/deck-seed/assets/template.html');
    expect(result).not.toContain('## Slide deck framework');
  });

  it('skips discovery and adds the media contract for media modes', () => {
    const result = composeSystemPrompt({
      skillMode: 'image',
      metadata: { kind: 'image', imageAspect: '16:9' },
    });

    expect(result).not.toContain('# Vibe Design discovery directives');
    expect(result).toContain('## Media generation contract');
    expect(result).toContain('image');
  });

  it('adds the Codex image generation override for Codex image runs by default', () => {
    const result = composeSystemPrompt({
      agentId: 'codex',
      skillMode: 'image',
    });

    expect(result).toContain('## Codex image generation override');
    expect(result).toContain('Use Codex image generation');
  });

  it('allows callers to disable the Codex image generation override', () => {
    const result = composeSystemPrompt({
      agentId: 'codex',
      skillMode: 'image',
      includeCodexImagegenOverride: false,
    });

    expect(result).not.toContain('## Codex image generation override');
  });

  it('keeps the final role-boundary prohibition as the last layer', () => {
    const result = composeSystemPrompt({
      streamFormat: 'plain',
      locale: 'zh-CN',
      skillMode: 'prototype',
      craftBody: 'Use a clear spacing rhythm.',
      skillBody: 'Build a focused prototype.',
    });

    expect(result).toContain('## CRITICAL: Never fabricate conversation turns');
    expect(result.trimEnd()).toMatch(
      /stop and ask the user a real question instead\.$/,
    );
  });

  it('keeps discovery wording free of plugin-specific input contracts', () => {
    const result = composeSystemPrompt({});

    expect(result).toContain('metadata or runtime inputs already answer');
    expect(result).not.toContain('plugin inputs already answer');
  });

  it('tells agents not to repeat executed shell transcripts in final prose', () => {
    const result = composeSystemPrompt({});

    expect(result).toContain('## Tool transcript reporting');
    expect(result).toContain('The host renders those real tool calls separately');
    expect(result).toContain('Do not paste standalone shell transcripts');
    expect(result).toContain('`pnpm test` passed');
  });

  it('places the API mode override at the very start for plain stream format', () => {
    const result = composeSystemPrompt({ streamFormat: 'plain' });

    expect(result.startsWith('# API mode — no tools available')).toBe(true);
  });

  it('keeps plain stream follow-up asks aligned with AskUserQuestion only', () => {
    const result = composeSystemPrompt({ agentId: 'codex', streamFormat: 'plain' });

    expect(result).toContain('## Plain stream follow-up asks');
    expect(result).toContain('Plain stream mode has no structured AskUserQuestion tool-call channel');
    expect(result).toContain('emit exactly one inline `<question-form>` block');
    expect(result).toContain('Do not present required follow-up inputs as a prose checklist');
  });

  it('injects memory, user instructions, and project instructions in order', () => {
    const result = composeSystemPrompt({
      memoryBody: 'Remember prior brand preference.',
      userInstructions: 'Use concise copy.',
      projectInstructions: 'Prefer dashboard density.',
    });

    const memoryIndex = indexOfRequired(result, '## Personal memory');
    const userIndex = indexOfRequired(result, '## Custom instructions (user-level)');
    const projectIndex = indexOfRequired(result, '## Custom instructions (project-level)');

    expect(memoryIndex).toBeLessThan(userIndex);
    expect(userIndex).toBeLessThan(projectIndex);
  });

  it('places craft body before skill body', () => {
    const result = composeSystemPrompt({
      craftBody: 'Craft rule: keep rhythm tight.',
      skillBody: 'Skill rule: build the prototype.',
    });

    expect(indexOfRequired(result, 'Craft rule: keep rhythm tight.')).toBeLessThan(
      indexOfRequired(result, 'Skill rule: build the prototype.'),
    );
  });

  it('adds the lightweight media dispatch hint for non-media modes', () => {
    const result = composeSystemPrompt({ skillMode: 'prototype' });

    expect(result).toContain('## Media generation if asked');
    expect(result).not.toContain('## Media generation contract');
  });

  it('preserves leading and trailing whitespace in skill body verbatim', () => {
    const skillBody = `\n\n  # Whitespace-sensitive workflow\n\nKeep surrounding whitespace.\n  \n`;
    const result = composeSystemPrompt({ skillBody });

    const bodyIndex = indexOfRequired(result, skillBody);
    expect(result.slice(bodyIndex, bodyIndex + skillBody.length)).toBe(skillBody);
  });

  it('treats skillModes media entries as media mode', () => {
    const result = composeSystemPrompt({ skillModes: ['image'] });

    expect(result).not.toContain('# Vibe Design discovery directives');
    expect(result).toContain('## Media generation contract');
  });

  it('does not inject prompt layers outside the current ComposeInput contract', () => {
    const result = composeSystemPrompt({
      pluginBlock: '## Active plugin\nDo not inject me.',
      activeStageBlocks: ['## Active stage: draft\nDo not inject me.'],
      connectedExternalMcp: [{ id: 'external-images', label: 'External Images' }],
    } as Parameters<typeof composeSystemPrompt>[0] & {
      pluginBlock: string;
      activeStageBlocks: string[];
      connectedExternalMcp: Array<{ id: string; label: string }>;
    });

    expect(result).not.toContain('## Active plugin');
    expect(result).not.toContain('## Active stage: draft');
    expect(result).not.toContain('## External MCP servers already authenticated');
  });

  it('does not inject exclusive surface layers when skillModes conflict', () => {
    const result = composeSystemPrompt({ skillModes: ['deck', 'image'] });

    expect(result).toContain('## Surface selection warning');
    expect(result).toContain('deck');
    expect(result).toContain('image');
    expect(result).not.toContain('## Slide deck framework');
    expect(result).not.toContain('## Media generation contract');
  });

  it('uses metadata kind before skillModes when resolving the effective surface', () => {
    const result = composeSystemPrompt({
      metadata: { kind: 'deck' },
      skillModes: ['image'],
    });

    expect(result).toContain('## Slide deck framework');
    expect(result).not.toContain('## Media generation contract');
  });

  it('uses skillMode before conflicting skillModes when resolving the effective surface', () => {
    const result = composeSystemPrompt({
      skillMode: 'video',
      skillModes: ['deck', 'image'],
    });

    expect(result).not.toContain('# Vibe Design discovery directives');
    expect(result).toContain('## Media generation contract');
    expect(result).toContain('- **surface**: video');
    expect(result).not.toContain('## Slide deck framework');
  });

  it('passes image metadata into the media contract', () => {
    const result = composeSystemPrompt({
      skillMode: 'image',
      metadata: {
        imageModel: 'gpt-image-2',
        imageAspect: '16:9',
        imageStyle: 'editorial product photography',
      },
      mediaExecution: {
        mode: 'disabled',
        allowedSurfaces: ['image'],
        allowedModels: ['gpt-image-2'],
      },
    });

    expect(result).toContain('- **surface**: image');
    expect(result).toContain('- **imageModel**: gpt-image-2');
    expect(result).toContain('- **imageAspect**: 16:9');
    expect(result).toContain('- **imageStyle**: editorial product photography');
    expect(result).toContain('Media execution is disabled for this run');
    expect(result).toContain('Allowed surfaces: `image`.');
    expect(result).toContain('Allowed models: `gpt-image-2`.');
  });

  it('passes video and audio metadata into the media contract', () => {
    const video = composeSystemPrompt({
      skillMode: 'video',
      metadata: {
        videoLength: 8,
        videoAspect: '9:16',
      },
    });
    const audio = composeSystemPrompt({
      skillMode: 'audio',
      metadata: {
        audioKind: 'speech',
        audioDuration: 30,
        voice: 'alloy',
      },
    });

    expect(video).toContain('- **surface**: video');
    expect(video).toContain('- **videoLength**: 8');
    expect(video).toContain('- **videoAspect**: 9:16');
    expect(audio).toContain('- **surface**: audio');
    expect(audio).toContain('- **audioKind**: speech');
    expect(audio).toContain('- **audioDuration**: 30');
    expect(audio).toContain('- **voice**: alloy');
  });

  it('keeps the discovery prompt specific enough for the migration contract', () => {
    const result = composeSystemPrompt({ skillMode: 'prototype' });

    expect(result).toContain('AskUserQuestion');
    expect(result).toContain('questions');
    expect(result).toContain('options');
    expect(result).not.toContain('```json');
    expect(result).toContain('<question-form');
    expect(result).toContain('direction-picker');
    expect(result).toContain('5-dimensional critique');
    expect(result).toContain('Host tool calls are allowed');
    expect(result).toContain('The host displays tool calls in the conversation');
    expect(result).toContain('Task tracking');
    expect(result).toContain('Do not skip the discovery AskUserQuestion');
    expect(result).toContain('Self-check before shipping');
  });

  it('closes an unbalanced skill fenced code block before later prompt layers', () => {
    const skillBody = '```html\n<div>unfinished seed';
    const result = composeSystemPrompt({ skillBody });

    const skillIndex = indexOfRequired(result, skillBody);
    const repairIndex = result.indexOf('```', skillIndex + skillBody.length);
    const finalGuardIndex = indexOfRequired(result, '## CRITICAL: Never fabricate conversation turns');

    expect(repairIndex).toBeGreaterThan(skillIndex);
    expect(finalGuardIndex).toBeGreaterThan(repairIndex);
    expect(result).toContain(`${skillBody}\n\n\`\`\``);
  });

  it('does not render unknown object metadata as [object Object]', () => {
    const result = composeSystemPrompt({
      metadata: {
        kind: 'prototype',
        promptTemplate: { title: 'Launch poster' },
      },
    });

    expect(result).not.toContain('[object Object]');
    expect(result).toContain('"title":"Launch poster"');
  });
});
