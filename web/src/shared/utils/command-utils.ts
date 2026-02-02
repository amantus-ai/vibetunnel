/**
 * Parse a command string into an array of arguments
 * Handles quoted strings properly (both single and double quotes)
 *
 * @param commandStr The command string to parse
 * @returns Array of parsed arguments
 *
 * @example
 * parseCommand('echo "hello world"') // ['echo', 'hello world']
 * parseCommand("ls -la '/my path'") // ['ls', '-la', '/my path']
 */
export function parseCommand(commandStr: string): string[] {
  // Simple command parsing - split by spaces but respect quotes
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < commandStr.length; i++) {
    const char = commandStr[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Format a command array back into a string
 * Adds quotes around arguments that contain spaces
 *
 * @param command Array of command arguments
 * @returns Formatted command string
 *
 * @example
 * formatCommand(['echo', 'hello world']) // 'echo "hello world"'
 * formatCommand(['ls', '-la', '/my path']) // 'ls -la "/my path"'
 */
export function formatCommand(command: string[]): string {
  return command
    .map((arg) => {
      // Add quotes if the argument contains spaces
      if (arg.includes(' ')) {
        // Use double quotes and escape any existing double quotes
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    })
    .join(' ');
}
