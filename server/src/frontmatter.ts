export type FrontmatterScalar = string | number | boolean | null;
export type FrontmatterValue = FrontmatterScalar | FrontmatterValue[] | FrontmatterObject;
export interface FrontmatterObject {
  [key: string]: FrontmatterValue;
}

interface StackEntry {
  indent: number;
  container: FrontmatterObject | FrontmatterValue[];
  key?: string;
}

export function parseFrontmatter(raw: string): { frontmatter: FrontmatterObject; body: string } {
  const text = raw.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(text);

  if (!match) {
    return { frontmatter: {}, body: text };
  }

  return {
    frontmatter: parseYamlSubset(match[1] ?? ''),
    body: match[2] ?? '',
  };
}

function parseYamlSubset(source: string): FrontmatterObject {
  const root: FrontmatterObject = {};
  const stack: StackEntry[] = [{ indent: -1, container: root }];
  const lines = source.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? '';

    if (/^\s*(?:#.*)?$/.test(rawLine)) {
      index += 1;
      continue;
    }

    const indent = countIndent(rawLine);
    const line = rawLine.slice(indent);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (line.startsWith('- ')) {
      const array = ensureArrayContainer(stack);
      array.push(parseScalar(line.slice(2).trim()));
      index += 1;
      continue;
    }

    const keyValue = /^([^:]+):\s*(.*)$/.exec(line);
    if (!keyValue || Array.isArray(parent.container)) {
      index += 1;
      continue;
    }

    const key = keyValue[1].trim();
    const value = keyValue[2] ?? '';

    const blockStyle = parseBlockStyle(value);
    if (blockStyle) {
      const block = collectBlock(lines, index + 1, indent + 2, blockStyle);
      parent.container[key] = block.value;
      index = block.nextIndex;
      continue;
    }

    if (value === '') {
      const child: FrontmatterObject = {};
      parent.container[key] = child;
      stack.push({ indent, container: child, key });
      index += 1;
      continue;
    }

    parent.container[key] = parseScalar(value);
    index += 1;
  }

  return root;
}

function ensureArrayContainer(stack: StackEntry[]): FrontmatterValue[] {
  const current = stack[stack.length - 1];

  if (Array.isArray(current.container)) {
    return current.container;
  }

  const parent = stack[stack.length - 2];

  if (!parent || !current.key || Array.isArray(parent.container)) {
    return [];
  }

  const array: FrontmatterValue[] = [];
  parent.container[current.key] = array;
  current.container = array;

  return array;
}

function collectBlock(
  lines: string[],
  startIndex: number,
  blockIndent: number,
  style: BlockStyle,
): { value: string; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }

    const indent = countIndent(line);
    if (indent < blockIndent) {
      break;
    }

    collected.push(line.slice(blockIndent));
    index += 1;
  }

  const body =
    style.kind === 'folded' ? foldBlockLines(collected) : collected.join('\n');

  return {
    value: style.stripFinalNewline ? body : `${body}\n`,
    nextIndex: index,
  };
}

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim();

  if (value.startsWith('[') && value.endsWith(']')) {
    const content = value.slice(1, -1).trim();
    if (!content) {
      return [];
    }

    return content.split(',').map((item) => parseScalar(item));
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (value === 'null' || value === '~') {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

interface BlockStyle {
  kind: 'literal' | 'folded';
  stripFinalNewline: boolean;
}

function parseBlockStyle(value: string): BlockStyle | null {
  if (value === '|' || value === '|-') {
    return { kind: 'literal', stripFinalNewline: value.endsWith('-') };
  }

  if (value === '>' || value === '>-') {
    return { kind: 'folded', stripFinalNewline: value.endsWith('-') };
  }

  return null;
}

function foldBlockLines(lines: string[]): string {
  let folded = '';

  for (const line of lines) {
    if (line === '') {
      folded = folded.replace(/ $/, '');
      folded += '\n';
      continue;
    }

    if (folded === '' || folded.endsWith('\n')) {
      folded += line;
      continue;
    }

    folded += ` ${line}`;
  }

  return folded;
}

function countIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
