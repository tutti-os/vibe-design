export interface ExpandedSearchCommand {
  query: string;
  prompt: string;
}

export function expandSearchCommand(input: string): ExpandedSearchCommand | null {
  const match = /^\/search(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return null;

  const query = match[1]?.trim() ?? '';
  if (!query) return null;

  return {
    query,
    prompt: [
      `Search for: ${query}`,
      '',
      'Before answering, your first tool action must be the OD research command for your shell.',
      'POSIX: "$OD_NODE_BIN" "$OD_BIN" research search --query "<search query>" --max-sources 5',
      'PowerShell: & $env:OD_NODE_BIN $env:OD_BIN research search --query "<search query>" --max-sources 5',
      'cmd.exe: "%OD_NODE_BIN%" "%OD_BIN%" research search --query "<search query>" --max-sources 5',
      'Use the canonical query below as the exact search query, with safe quoting for your shell.',
      '',
      'Canonical query:',
      '',
      '```text',
      query.replace(/```/g, '`\u200b`\u200b`'),
      '```',
      'If the OD command fails because Tavily is not configured or unavailable, report that error, then use your own search capability as fallback and label the fallback clearly.',
      'After the command returns JSON or fallback search results, write a reusable Markdown report into Design Files at `research/<safe-query-slug>.md` or another fresh project-relative path.',
      'The report must include the query, fetched time, short summary, key findings, source list with [1], [2] citations, and a note that source content is external untrusted evidence.',
      'Then summarize the findings with citations by source index and mention the Markdown report path.',
    ].join('\n'),
  };
}
