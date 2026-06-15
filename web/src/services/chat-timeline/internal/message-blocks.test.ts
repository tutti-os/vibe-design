import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../types';
import { buildMessageBlocks } from './message-blocks';

describe('buildMessageBlocks', () => {
  it('groups text, thinking, tool calls, questions, and todos', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'thinking_delta', delta: 'Checking ' },
      { type: 'thinking_delta', delta: 'state' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'src/App.tsx' } },
      { type: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false },
      {
        type: 'tool_use',
        id: 'tool-2',
        name: 'AskUserQuestion',
        input: { question: 'Pick one', options: ['A', 'B'] },
      },
      {
        type: 'tool_use',
        id: 'tool-3',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Done', status: 'completed' }] },
      },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.map((block) => block.kind)).toEqual([
      'text',
      'thinking',
      'tool-group',
      'ask-user-question',
      'todo-write',
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'text', content: 'Hello world' });
    expect(blocks[1]).toEqual({ kind: 'thinking', content: 'Checking state' });
    expect(blocks[2]).toMatchObject({
      kind: 'tool-group',
      calls: [{ id: 'tool-1', name: 'Read', input: { file_path: 'src/App.tsx' } }],
      results: [{ toolUseId: 'tool-1', content: 'ok', isError: false }],
    });
    expect(blocks[3]).toEqual({
      kind: 'ask-user-question',
      toolUseId: 'tool-2',
      input: { question: 'Pick one', options: ['A', 'B'] },
      answered: false,
    });
    expect(blocks[4]).toEqual({
      kind: 'todo-write',
      toolUseId: 'tool-3',
      input: { todos: [{ content: 'Done', status: 'completed' }] },
    });
    expect(blocks.find((block) => block.kind === 'file-ops')).toBeUndefined();
  });

  it('renders Codex request_user_input tool calls as answerable question blocks', () => {
    const input = {
      questions: [
        {
          header: 'Scope',
          id: 'output_type',
          question: 'What should we create?',
          options: [
            { label: 'Landing page', description: 'A focused marketing page.' },
            { label: 'Dashboard', description: 'A product surface.' },
          ],
        },
      ],
    };

    const blocks = buildMessageBlocks([
      {
        type: 'tool_use',
        id: 'question-1',
        name: 'request_user_input',
        input,
      },
      { type: 'end', code: 0, signal: null, status: 'succeeded' },
    ]);

    expect(blocks).toContainEqual({
      kind: 'ask-user-question',
      toolUseId: 'question-1',
      input,
      answered: false,
    });
    expect(blocks.find((block) => block.kind === 'tool-group')).toBeUndefined();
  });

  it('marks an AskUserQuestion block as answered once its tool result arrives', () => {
    const input = { question: 'Pick one', options: ['A', 'B'] };
    const blocks = buildMessageBlocks([
      { type: 'tool_use', id: 'q-1', name: 'AskUserQuestion', input },
      { type: 'tool_result', toolUseId: 'q-1', content: 'A', isError: false },
    ]);

    expect(blocks).toContainEqual({
      kind: 'ask-user-question',
      toolUseId: 'q-1',
      input,
      answered: true,
    });
  });

  it('converts reasoning tags inside text deltas into thinking blocks', () => {
    const events: AgentEvent[] = [
      {
        type: 'text_delta',
        delta:
          '<reasoning>Check policy.</reasoning><reasoning>Pick the safest path.</reasoning>\n\nHere is the visible answer.',
      },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      { kind: 'thinking', content: 'Check policy.Pick the safest path.' },
      { kind: 'text', content: '\n\nHere is the visible answer.', markdown: true },
    ]);
    expect(JSON.stringify(blocks)).not.toContain('<reasoning>');
    expect(JSON.stringify(blocks)).not.toContain('</reasoning>');
  });

  it('merges thinking blocks separated only by empty assistant text', () => {
    const blocks = buildMessageBlocks([
      { type: 'thinking_delta', delta: 'First thought.' },
      { type: 'text_delta', delta: '\n\n' },
      { type: 'thinking_delta', delta: 'Second thought.' },
    ]);

    expect(blocks).toEqual([{ kind: 'thinking', content: 'First thought.Second thought.' }]);
  });

  it('groups adjacent ordinary tool calls by family and attaches results by toolUseId', () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'src/A.ts' } },
      { type: 'tool_use', id: 'read-2', name: 'read_file', input: { file_path: 'src/B.ts' } },
      { type: 'tool_result', toolUseId: 'read-2', content: 'B', isError: false },
      { type: 'tool_result', toolUseId: 'read-1', content: 'A', isError: false },
      { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'pnpm test' } },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.map((block) => block.kind)).toEqual(['tool-group', 'tool-group']);
    expect(blocks[0]).toMatchObject({
      kind: 'tool-group',
      calls: [
        { id: 'read-1', name: 'Read' },
        { id: 'read-2', name: 'read_file' },
      ],
      results: [
        { toolUseId: 'read-1', content: 'A' },
        { toolUseId: 'read-2', content: 'B' },
      ],
    });
    expect(blocks[1]).toMatchObject({
      kind: 'tool-group',
      calls: [{ id: 'bash-1', name: 'Bash' }],
      results: [],
      running: true,
    });
  });

  it('settles result-less tool calls once later assistant events arrive', () => {
    const blocks = buildMessageBlocks([
      { type: 'tool_use', id: 'search-1', name: 'ToolSearch', input: { query: 'select:TodoWrite' } },
      { type: 'thinking_delta', delta: 'Continuing after the host-visible tool call.' },
      { type: 'tool_use', id: 'search-2', name: 'ToolSearch', input: { query: 'latest' } },
    ]);

    expect(blocks[0]).toMatchObject({
      kind: 'tool-group',
      calls: [{ id: 'search-1', name: 'ToolSearch' }],
      results: [],
      running: false,
    });
    expect(blocks[2]).toMatchObject({
      kind: 'tool-group',
      calls: [{ id: 'search-2', name: 'ToolSearch' }],
      results: [],
      running: true,
    });
  });

  it('keeps a single todo block in place and updates it to the latest TodoWrite input', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: 'Planning\n' },
      {
        type: 'tool_use',
        id: 'todo-1',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Design layout', status: 'in_progress' },
            { content: 'Build list', status: 'pending' },
          ],
        },
      },
      { type: 'text_delta', delta: 'Working\n' },
      {
        type: 'tool_use',
        id: 'todo-2',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Design layout', status: 'completed' },
            { content: 'Build list', status: 'in_progress' },
          ],
        },
      },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.map((block) => block.kind)).toEqual(['text', 'todo-write', 'text']);
    expect(blocks[1]).toEqual({
      kind: 'todo-write',
      toolUseId: 'todo-2',
      input: {
        todos: [
          { content: 'Design layout', status: 'completed' },
          { content: 'Build list', status: 'in_progress' },
        ],
      },
    });
  });

  it('shows malformed TodoWrite calls as ordinary tool calls instead of empty todo cards', () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', id: 'todo-empty', name: 'TodoWrite', input: {} },
      { type: 'tool_use', id: 'todo-malformed', name: 'TodoWrite', input: { todos: [{ title: 'Missing content' }] } },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'tool-group',
      calls: [
        { id: 'todo-empty', name: 'TodoWrite', input: {} },
        { id: 'todo-malformed', name: 'TodoWrite', input: { todos: [{ title: 'Missing content' }] } },
      ],
    });
  });

  it('does not let a later malformed TodoWrite overwrite the last valid todo list', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_use',
        id: 'todo-valid',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Build target', status: 'in_progress' }] },
      },
      { type: 'tool_use', id: 'todo-empty', name: 'TodoWrite', input: { todos: [] } },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.map((block) => block.kind)).toEqual(['todo-write', 'tool-group']);
    expect(blocks[0]).toEqual({
      kind: 'todo-write',
      toolUseId: 'todo-valid',
      input: { todos: [{ content: 'Build target', status: 'in_progress' }] },
    });
    expect(blocks[1]).toMatchObject({
      kind: 'tool-group',
      calls: [{ id: 'todo-empty', name: 'TodoWrite', input: { todos: [] } }],
    });
  });

  it('projects agent error events into visible message blocks', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: 'Started\n' },
      { type: 'error', code: 'claude_error', message: 'Claude run failed' },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      { kind: 'text', content: 'Started\n', markdown: true },
      { kind: 'error', code: 'claude_error', message: 'Claude run failed' },
    ]);
  });

  it('projects persisted run error payloads into visible message blocks', () => {
    const events: AgentEvent[] = [
      {
        type: 'error',
        error: { code: 'RUN_START_FAILED', message: 'agent executable not found' },
      } as AgentEvent,
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      { kind: 'error', code: 'RUN_START_FAILED', message: 'agent executable not found' },
    ]);
  });

  it('suppresses fallback question text emitted after AskUserQuestion', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'AskUserQuestion',
        input: { question: 'Pick a layout', options: [{ label: 'Compact' }, { label: 'Comfortable' }] },
      },
      { type: 'text_delta', delta: 'Pick a layout\n- Compact\n- Comfortable' },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      {
        kind: 'ask-user-question',
        toolUseId: 'tool-1',
        input: { question: 'Pick a layout', options: [{ label: 'Compact' }, { label: 'Comfortable' }] },
        answered: false,
      },
    ]);
  });

  it('splits inline question-form DSL from assistant text into a form block', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: '先确认几个信息。\n\n<question-form id="discovery" title="快速确认">' },
      {
        type: 'text_delta',
        delta:
          '<question type="select" id="output_type" title="任务类型是什么？" options="web_game:可玩的网页游戏|prototype:交互原型" />',
      },
      {
        type: 'text_delta',
        delta:
          '<question type="text" id="brand_context" title="是否有品牌背景？" placeholder="例如：无品牌限制" /></question-form>',
      },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      { kind: 'text', content: '先确认几个信息。\n\n', markdown: true },
      {
        kind: 'question-form',
        form: {
          id: 'discovery',
          title: '快速确认',
          questions: [
            {
              id: 'output_type',
              title: '任务类型是什么？',
              type: 'select',
              options: [
                { value: 'web_game', label: '可玩的网页游戏' },
                { value: 'prototype', label: '交互原型' },
              ],
            },
            {
              id: 'brand_context',
              title: '是否有品牌背景？',
              type: 'text',
              placeholder: '例如：无品牌限制',
            },
          ],
        },
      },
    ]);
  });

  it('suppresses repeated prose immediately before an inline question form', () => {
    const repeatedProse = '这条输入只有 `213123`，我需要确认它要作为内容、编号，还是你想让我执行某个任务。';
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: repeatedProse },
      { type: 'tool_use', id: 'question-tool', name: 'request_user_input', input: { questions: [] } },
      {
        type: 'text_delta',
        delta: `${repeatedProse}\n<question-form id="clarify" title="确认意图"><question type="select" id="intent" title="你希望我如何处理？" options="content:作为内容使用|lookup:作为编号查询" /></question-form>`,
      },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.filter((block) => block.kind === 'text')).toEqual([
      { kind: 'text', content: repeatedProse, markdown: true },
    ]);
    expect(blocks.at(-1)?.kind).toBe('question-form');
  });

  it('keeps HTML artifact markup and content out of assistant text blocks', () => {
    const events: AgentEvent[] = [
      {
        type: 'text_delta',
        delta: 'Here is the page.\n<artifact identifier="pixel-duel-arena" type="text/html" title="Pixel Duel Arena">',
      },
      {
        type: 'text_delta',
        delta: '<!doctype html><html lang="zh-CN"><head><title>Pixel Duel Arena</title></head>',
      },
      {
        type: 'text_delta',
        delta: '<body><main>Game</main></body></html></artifact>\nDone.',
      },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      { kind: 'text', content: 'Here is the page.\n\nDone.', markdown: true },
      {
        kind: 'generated-files',
        files: [{ name: 'pixel-duel-arena.html', artifactType: 'text/html', title: 'Pixel Duel Arena' }],
      },
    ]);
  });

  it('shows files newly written by agent tools as generated files in the assistant message', () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', id: 'write-1', name: 'Write', input: { path: 'DesignFiles/report.md' } },
      { type: 'tool_result', toolUseId: 'write-1', content: 'ok', isError: false },
      { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'pages/landing.html' } },
      { type: 'tool_result', toolUseId: 'edit-1', content: 'ok', isError: false },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.find((block) => block.kind === 'generated-files')).toEqual({
      kind: 'generated-files',
      files: [{ name: 'DesignFiles/report.md' }],
    });
    expect(blocks.find((block) => block.kind === 'file-ops')).toBeUndefined();
  });

  it('keeps generated artifact metadata when a tool write reports the same file path', () => {
    const events: AgentEvent[] = [
      {
        type: 'text_delta',
        delta:
          '<artifact identifier="night-market-poster" type="text/html" title="Night Market Event Poster">',
      },
      {
        type: 'text_delta',
        delta: '<!doctype html><html><body>Poster</body></html></artifact>',
      },
      {
        type: 'tool_use',
        id: 'write-1',
        name: 'Write',
        input: {
          path: '/Users/chovy/Desktop/workspace/vibe-design/server/.vibe/projects/project-1/night-market-poster.html',
        },
      },
      { type: 'tool_result', toolUseId: 'write-1', content: 'ok', isError: false },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks.find((block) => block.kind === 'generated-files')).toEqual({
      kind: 'generated-files',
      files: [
        {
          name: 'night-market-poster.html',
          artifactType: 'text/html',
          title: 'Night Market Event Poster',
        },
      ],
    });
  });

  it('does not expose file operation summaries as assistant message blocks', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', delta: 'I will inspect the uploaded image.' },
      { type: 'tool_use', id: 'read-image', name: 'Read', input: { file_path: 'assets/cat-avatar.png' } },
      { type: 'end', status: 'succeeded', code: null, signal: null },
    ];

    const blocks = buildMessageBlocks(events);

    expect(blocks).toEqual([
      { kind: 'text', content: 'I will inspect the uploaded image.', markdown: true },
      {
        kind: 'tool-group',
        calls: [{ id: 'read-image', name: 'Read', input: { file_path: 'assets/cat-avatar.png' } }],
        results: [],
        running: false,
      },
    ]);
    expect(JSON.stringify(blocks)).not.toContain('file-ops');
  });
});
