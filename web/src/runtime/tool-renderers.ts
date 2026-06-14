export function summarizeToolInput(input: Record<string, unknown>): string {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath === 'string' && filePath.length > 0) return filePath;

  const command = input.command;
  if (typeof command === 'string' && command.length > 0) return command;

  return JSON.stringify(input);
}
