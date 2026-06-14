export type QuestionFormType = 'select' | 'radio' | 'checkbox' | 'text' | 'textarea';

export interface QuestionFormOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionFormQuestion {
  id: string;
  title: string;
  type: QuestionFormType;
  options?: QuestionFormOption[];
  placeholder?: string;
  required?: boolean;
}

export interface QuestionFormDefinition {
  id: string;
  title: string;
  questions: QuestionFormQuestion[];
  submitLabel?: string;
}

export type QuestionFormAnswerValue = string | string[];
export type QuestionFormAnswers = Record<string, QuestionFormAnswerValue>;

export type QuestionFormSegment =
  | { kind: 'text'; text: string }
  | { kind: 'form'; form: QuestionFormDefinition; raw: string };

const OPEN_RE = /<question-form\b([^>]*)>/i;

export function splitOnQuestionForms(input: string): QuestionFormSegment[] {
  const segments: QuestionFormSegment[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const slice = input.slice(cursor);
    const open = OPEN_RE.exec(slice);
    if (!open) {
      if (slice.length > 0) segments.push({ kind: 'text', text: slice });
      break;
    }

    const openStart = cursor + open.index;
    const openEnd = openStart + open[0].length;
    const closeStart = findCloseTag(input, openEnd);
    if (closeStart === -1) {
      if (slice.length > 0) segments.push({ kind: 'text', text: slice });
      break;
    }

    if (openStart > cursor) segments.push({ kind: 'text', text: input.slice(cursor, openStart) });

    const closeEnd = closeStart + '</question-form>'.length;
    const attrs = parseAttrs(open[1] ?? '');
    const body = input.slice(openEnd, closeStart);
    const form = parseQuestionFormBody(body, attrs);

    if (form) {
      segments.push({ kind: 'form', form, raw: input.slice(openStart, closeEnd) });
    } else {
      segments.push({ kind: 'text', text: input.slice(openStart, closeEnd) });
    }

    cursor = closeEnd;
  }

  return segments;
}

export function formatQuestionFormAnswers(
  form: QuestionFormDefinition,
  answers: QuestionFormAnswers,
): string {
  const lines = [`[form answers — ${form.id}]`];

  for (const question of form.questions) {
    const value = answers[question.id];
    let display = '(skipped)';

    if (Array.isArray(value)) {
      display =
        value.length > 0
          ? value.map((entry) => formatOptionAnswer(question, entry)).join(', ')
          : '(skipped)';
    } else if (typeof value === 'string' && value.trim().length > 0) {
      display = formatOptionAnswer(question, value.trim());
    }

    lines.push(`- ${question.title}: ${display}`);
  }

  return lines.join('\n');
}

export function parseSubmittedQuestionFormAnswers(
  form: QuestionFormDefinition,
  content: string | undefined,
): QuestionFormAnswers | null {
  if (!content) return null;
  const lines = content.split('\n').map((line) => line.trim());
  const header = lines[0] ?? '';
  if (!new RegExp(`^\\[form answers\\s+(?:—|-)\\s*${escapeRegExp(form.id)}\\]`, 'i').test(header)) {
    return null;
  }

  const answers: QuestionFormAnswers = {};
  const titleToQuestion = new Map(form.questions.map((question) => [question.title.toLowerCase(), question]));

  for (const line of lines.slice(1)) {
    const match = /^[-*]\s*([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const question = titleToQuestion.get((match[1] ?? '').trim().toLowerCase());
    if (!question) continue;
    const rawValue = (match[2] ?? '').trim();
    if (rawValue.toLowerCase() === '(skipped)') {
      answers[question.id] = question.type === 'checkbox' ? [] : '';
      continue;
    }

    if (question.type === 'checkbox') {
      answers[question.id] = rawValue
        .split(',')
        .map((part) => optionValueFromSubmittedLabel(question, part.trim()))
        .filter((part) => part.length > 0);
    } else {
      answers[question.id] = optionValueFromSubmittedLabel(question, rawValue);
    }
  }

  return Object.keys(answers).length > 0 ? answers : null;
}

export function initialQuestionFormAnswers(
  form: QuestionFormDefinition,
  submittedAnswers?: QuestionFormAnswers,
): QuestionFormAnswers {
  const answers: QuestionFormAnswers = {};
  for (const question of form.questions) {
    if (submittedAnswers && submittedAnswers[question.id] !== undefined) {
      answers[question.id] = submittedAnswers[question.id]!;
    } else {
      answers[question.id] = question.type === 'checkbox' ? [] : '';
    }
  }
  return answers;
}

function parseQuestionFormBody(
  body: string,
  attrs: Record<string, string>,
): QuestionFormDefinition | null {
  const jsonForm = parseJsonQuestionForm(body, attrs);
  if (jsonForm) return jsonForm;

  const questions: QuestionFormQuestion[] = [];
  const questionRe = /<question\b([^>]*)\/>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = questionRe.exec(body)) !== null) {
    const question = parseDslQuestion(match[1] ?? '', index);
    if (question) {
      questions.push(question);
      index += 1;
    }
  }

  if (questions.length === 0) return null;
  return {
    id: normalizeId(attrs.id, 'discovery'),
    title: attrs.title?.trim() || 'Quick brief',
    questions,
    ...(attrs.submitLabel ? { submitLabel: attrs.submitLabel } : {}),
  };
}

function parseJsonQuestionForm(
  body: string,
  attrs: Record<string, string>,
): QuestionFormDefinition | null {
  const trimmed = body
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!trimmed.startsWith('{')) return null;

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.questions)) return null;

  const questions = record.questions.flatMap((rawQuestion, index): QuestionFormQuestion[] => {
    if (!rawQuestion || typeof rawQuestion !== 'object') return [];
    const question = rawQuestion as Record<string, unknown>;
    const title = readString(question.title) ?? readString(question.label);
    if (!title) return [];
    const options = parseOptions(question.options);
    const placeholder = readString(question.placeholder);
    return [
      {
        id: normalizeId(readString(question.id), `q${index + 1}`),
        title,
        type: normalizeQuestionType(readString(question.type)),
        ...(options ? { options } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(question.required === true ? { required: true } : {}),
      },
    ];
  });

  if (questions.length === 0) return null;
  const submitLabel = readString(record.submitLabel);
  return {
    id: normalizeId(attrs.id ?? readString(record.id), 'discovery'),
    title: attrs.title?.trim() || readString(record.title) || 'Quick brief',
    questions,
    ...(submitLabel ? { submitLabel } : {}),
  };
}

function parseDslQuestion(rawAttrs: string, index: number): QuestionFormQuestion | null {
  const attrs = parseAttrs(rawAttrs);
  const title = attrs.title?.trim();
  if (!title) return null;
  const options = parseOptionsString(attrs.options);
  return {
    id: normalizeId(attrs.id, `q${index + 1}`),
    title,
    type: normalizeQuestionType(attrs.type),
    ...(options ? { options } : {}),
    ...(attrs.placeholder ? { placeholder: attrs.placeholder } : {}),
    ...(attrs.required === 'true' ? { required: true } : {}),
  };
}

function parseOptions(raw: unknown): QuestionFormOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw.flatMap((entry): QuestionFormOption[] => {
    if (typeof entry === 'string') {
      const label = entry.trim();
      return label ? [{ label, value: label }] : [];
    }
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const label = readString(record.label);
    if (!label) return [];
    const description = readString(record.description);
    return [
      {
        label,
        value: readString(record.value) ?? label,
        ...(description ? { description } : {}),
      },
    ];
  });
  return options.length > 0 ? options : undefined;
}

function parseOptionsString(raw: string | undefined): QuestionFormOption[] | undefined {
  if (!raw) return undefined;
  const options = raw
    .split('|')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return null;
      const separator = trimmed.indexOf(':');
      if (separator === -1) return { value: trimmed, label: trimmed };
      const value = trimmed.slice(0, separator).trim();
      const label = trimmed.slice(separator + 1).trim();
      if (!value || !label) return null;
      return { value, label };
    })
    .filter((option): option is QuestionFormOption => option !== null);
  return options.length > 0 ? options : undefined;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    attrs[match[1] ?? ''] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

function findCloseTag(input: string, from: number): number {
  const lower = input.toLowerCase();
  return lower.indexOf('</question-form>', from);
}

function normalizeQuestionType(raw: string | null | undefined): QuestionFormType {
  const type = raw?.trim().toLowerCase();
  if (type === 'radio' || type === 'checkbox' || type === 'text' || type === 'textarea') return type;
  return 'select';
}

function normalizeId(raw: string | null | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^\w.-]/g, '_') || fallback;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function formatOptionAnswer(question: QuestionFormQuestion, value: string): string {
  const option = question.options?.find((candidate) => candidate.value === value || candidate.label === value);
  if (!option) return value;
  if (option.value === option.label) return option.label;
  return `${option.label} [value: ${option.value}]`;
}

function optionValueFromSubmittedLabel(question: QuestionFormQuestion, raw: string): string {
  const valueMatch = /\s+\[value:\s*([^\]]+)\]\s*$/i.exec(raw);
  if (valueMatch?.[1]) return valueMatch[1].trim();
  const option = question.options?.find((candidate) => candidate.value === raw || candidate.label === raw);
  return option?.value ?? raw;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
