import { describe, expect, it } from 'vitest';
import {
  formatQuestionFormAnswers,
  parseSubmittedQuestionFormAnswers,
  splitOnQuestionForms,
} from './question-form';

describe('question-form runtime', () => {
  it('splits prose and question-form DSL child nodes', () => {
    const segments = splitOnQuestionForms(`先确认几个信息。

<question-form id="discovery" title="快速确认 — 30 秒">
  <question type="select" id="output_type" title="任务类型是什么？" options="web_game:可玩的网页游戏|prototype:交互原型" />
  <question type="text" id="brand_context" title="是否有品牌背景？" placeholder="例如：无品牌限制" />
</question-form>`);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ kind: 'text', text: '先确认几个信息。\n\n' });
    expect(segments[1]).toMatchObject({
      kind: 'form',
      form: {
        id: 'discovery',
        title: '快速确认 — 30 秒',
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
    });
  });

  it('formats and parses submitted answers with stable option values', () => {
    const form = {
      id: 'discovery',
      title: '快速确认',
      questions: [
        {
          id: 'output_type',
          title: '任务类型是什么？',
          type: 'select' as const,
          options: [{ value: 'web_game', label: '可玩的网页游戏' }],
        },
        { id: 'brand_context', title: '是否有品牌背景？', type: 'text' as const },
      ],
    };

    const text = formatQuestionFormAnswers(form, {
      output_type: 'web_game',
      brand_context: '无品牌限制',
    });

    expect(text).toBe(
      [
        '[form answers — discovery]',
        '- 任务类型是什么？: 可玩的网页游戏 [value: web_game]',
        '- 是否有品牌背景？: 无品牌限制',
      ].join('\n'),
    );
    expect(parseSubmittedQuestionFormAnswers(form, text)).toEqual({
      output_type: 'web_game',
      brand_context: '无品牌限制',
    });
  });
});
