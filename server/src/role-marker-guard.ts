const ROLE_NAMES = ['user', 'assistant', 'assist', 'system'] as const;
const ROLE_NAME_PATTERN = ROLE_NAMES.join('|');
const HORIZONTAL_WHITESPACE_PATTERN = '[\\t ]';
const MAX_MARKER_INDENT_LENGTH = 16;
const MAX_MARKER_SEPARATOR_LENGTH = 16;

export const FABRICATED_ROLE_MARKER_RE = new RegExp(
  `(?:^|\\n)${HORIZONTAL_WHITESPACE_PATTERN}{0,${MAX_MARKER_INDENT_LENGTH}}##` +
    `${HORIZONTAL_WHITESPACE_PATTERN}{1,${MAX_MARKER_SEPARATOR_LENGTH}}` +
    `(${ROLE_NAME_PATTERN})(?=[^a-z])`,
);

export interface RoleMarkerWarningEvent {
  type: 'fabricated_role_marker';
  marker: string;
  messageId: string;
}

export interface RoleMarkerGuard {
  feedText(text: string): string;
  readonly contaminated: boolean;
  warningEvent(): RoleMarkerWarningEvent | null;
}

const ROLE_MARKER_DETECTION_RE = new RegExp(
  `(^|\\n)${HORIZONTAL_WHITESPACE_PATTERN}{0,${MAX_MARKER_INDENT_LENGTH}}##` +
    `${HORIZONTAL_WHITESPACE_PATTERN}{1,${MAX_MARKER_SEPARATOR_LENGTH}}` +
    `(${ROLE_NAME_PATTERN})(?=[^a-z])`,
  'g',
);
const MAX_ROLE_NAME_LENGTH = Math.max(...ROLE_NAMES.map((role) => role.length));
const MAX_PENDING_MARKER_LENGTH =
  1 + MAX_MARKER_INDENT_LENGTH + 2 + MAX_MARKER_SEPARATOR_LENGTH + MAX_ROLE_NAME_LENGTH;

interface RoleMarkerMatch {
  index: number;
  marker: string;
}

interface PendingSplit {
  output: string;
  pending: string;
  pendingStartsAtLineStart: boolean;
}

function findRoleMarker(text: string, startsAtLineStart: boolean): RoleMarkerMatch | undefined {
  ROLE_MARKER_DETECTION_RE.lastIndex = 0;

  for (const match of text.matchAll(ROLE_MARKER_DETECTION_RE)) {
    const startsWithLineBreak = match[1] === '\n';
    if (!startsWithLineBreak && match.index === 0 && !startsAtLineStart) {
      continue;
    }

    return {
      index: match.index,
      marker: `## ${match[2]}`,
    };
  }

  return undefined;
}

function isHorizontalWhitespace(value: string): boolean {
  return value === ' ' || value === '\t';
}

function isPotentialMarkerPrefix(value: string): boolean {
  let index = 0;
  while (isHorizontalWhitespace(value[index] ?? '')) {
    index += 1;
  }

  if (index > MAX_MARKER_INDENT_LENGTH) {
    return false;
  }

  if (index === value.length) {
    return true;
  }

  if (value[index] !== '#') {
    return false;
  }

  index += 1;
  if (index === value.length) {
    return true;
  }

  if (value[index] !== '#') {
    return false;
  }

  index += 1;
  if (index === value.length) {
    return true;
  }

  if (!isHorizontalWhitespace(value[index] ?? '')) {
    return false;
  }

  let separatorLength = 0;
  while (isHorizontalWhitespace(value[index] ?? '')) {
    index += 1;
    separatorLength += 1;
  }

  if (separatorLength > MAX_MARKER_SEPARATOR_LENGTH) {
    return false;
  }

  const rolePrefix = value.slice(index);
  if (rolePrefix.length === 0) {
    return true;
  }

  return ROLE_NAMES.some((role) => role.startsWith(rolePrefix));
}

function isOnlyHorizontalWhitespace(value: string): boolean {
  return value.length > 0 && [...value].every(isHorizontalWhitespace);
}

function splitPendingMarkerSuffix(text: string, startsAtLineStart: boolean): PendingSplit {
  for (let contentStart = 0; contentStart < text.length; contentStart += 1) {
    const beginsAtLineStart =
      (contentStart === 0 && startsAtLineStart) || text[contentStart - 1] === '\n';

    if (!beginsAtLineStart) {
      continue;
    }

    const markerCandidate = text.slice(contentStart);
    if (!isPotentialMarkerPrefix(markerCandidate)) {
      continue;
    }

    const pendingStart = contentStart > 0 ? contentStart - 1 : contentStart;
    if (isOnlyHorizontalWhitespace(markerCandidate)) {
      if (markerCandidate.length > MAX_MARKER_INDENT_LENGTH) {
        return {
          output: text,
          pending: '',
          pendingStartsAtLineStart: false,
        };
      }

      return {
        output: text.slice(0, contentStart),
        pending: markerCandidate,
        pendingStartsAtLineStart: true,
      };
    }

    if (text.length - pendingStart > MAX_PENDING_MARKER_LENGTH) {
      const boundedPendingStart = text.length - MAX_PENDING_MARKER_LENGTH;

      return {
        output: text.slice(0, boundedPendingStart),
        pending: text.slice(boundedPendingStart),
        pendingStartsAtLineStart: true,
      };
    }

    return {
      output: text.slice(0, pendingStart),
      pending: text.slice(pendingStart),
      pendingStartsAtLineStart: contentStart === 0 && startsAtLineStart,
    };
  }

  return {
    output: text,
    pending: '',
    pendingStartsAtLineStart: false,
  };
}

class StreamingRoleMarkerGuard implements RoleMarkerGuard {
  readonly #messageId: string;
  #pending = '';
  #pendingStartsAtLineStart = false;
  #nextChunkStartsAtLineStart = true;
  #contaminated = false;
  #warningEvent: RoleMarkerWarningEvent | null = null;

  constructor(messageId: string) {
    this.#messageId = messageId;
  }

  get contaminated(): boolean {
    return this.#contaminated;
  }

  feedText(text: string): string {
    if (this.#contaminated) {
      return '';
    }

    const startsAtLineStart = this.#pending
      ? this.#pendingStartsAtLineStart
      : this.#nextChunkStartsAtLineStart;
    const textToScan = this.#pending + text;
    this.#pending = '';
    this.#pendingStartsAtLineStart = false;

    const match = findRoleMarker(textToScan, startsAtLineStart);
    if (match) {
      this.#contaminated = true;
      this.#warningEvent = {
        type: 'fabricated_role_marker',
        marker: match.marker,
        messageId: this.#messageId,
      };
      return textToScan.slice(0, match.index);
    }

    const split = splitPendingMarkerSuffix(textToScan, startsAtLineStart);
    this.#pending = split.pending;
    this.#pendingStartsAtLineStart = split.pendingStartsAtLineStart;
    this.#nextChunkStartsAtLineStart = split.pending
      ? false
      : textToScan.length === 0
        ? startsAtLineStart
        : textToScan.endsWith('\n');

    return split.output;
  }

  warningEvent(): RoleMarkerWarningEvent | null {
    return this.#warningEvent;
  }
}

export function createRoleMarkerGuard(messageId: string): RoleMarkerGuard {
  return new StreamingRoleMarkerGuard(messageId);
}
