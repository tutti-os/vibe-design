// Shared "@" mention token parsing for composer inputs (project chat + dashboard).
// Both composers use the same active-mention grammar so typing "@" behaves
// identically across the app.

const ACTIVE_MENTION_QUERY_PATTERN = /[@＠]([^\s@＠]*)$/;
const ACTIVE_MENTION_TOKEN_PATTERN = /[@＠][^\s@＠]*$/;

// Returns the in-progress mention query (text after a trailing "@"), or null
// when the caret is not inside an active mention token.
export function extractMentionQuery(value: string): string | null {
  const match = ACTIVE_MENTION_QUERY_PATTERN.exec(value);
  return match ? match[1] : null;
}

// Strips the active trailing "@query" token once a mention has been selected.
export function removeActiveMentionToken(value: string): string {
  return value.replace(ACTIVE_MENTION_TOKEN_PATTERN, '').trimEnd();
}

export function replaceActiveMentionToken(value: string, replacement: string): string {
  return value.replace(ACTIVE_MENTION_TOKEN_PATTERN, replacement).trimEnd();
}
