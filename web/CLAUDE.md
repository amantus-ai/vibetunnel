# Claude Development Notes

## Updating spec.md
As code changes, the spec.md might get outdated. If you detect outdated information, ask the user if they want to regenerate the spec.md file.

### How to regenerate spec.md:
1. Create a todo list to track the analysis tasks
2. Use multiple parallel Task tool calls to analyze:
   - Server architecture (src/server/, authentication, session management)
   - Client architecture (src/client/, components, services)
   - fwd.ts application functionality
   - API endpoints and protocols
   - Binary buffer format and WebSocket implementation
   - HQ mode and distributed architecture
   - Activity tracking
   - Anything else not covered above
3. Focus on capturing:
   - File locations with key line numbers for important functions
   - Component responsibilities and data flow
   - Protocol specifications and message formats
   - Configuration options and CLI arguments
4. Write a concise spec.md that serves as a navigation map, keeping descriptions brief to minimize token usage
5. Include a "Key Files Quick Reference" section for fast lookup

## Build Process
- **Never run build commands** - the user has `pnpm run dev` running which handles automatic rebuilds
- Changes to TypeScript files are automatically compiled and watched
- Do not run `pnpm run build` or similar build commands

## Development Workflow
- Make changes to source files in `src/`
- Check code quality after making changes:
    - `pnpm run check` - Run all checks (format, lint, typecheck) in parallel
    - `pnpm run check:fix` - Auto-fix formatting and linting issues
    - Or run individually:
      - `pnpm run format` / `pnpm run format:check`
      - `pnpm run lint` / `pnpm run lint:fix`
      - `pnpm run typecheck`
- Always fix all linting and type checking errors, including in unrelated code
- Never run the tests, unless explicitely asked to. `pnpm run test`

## Code References
**THIS IS OF UTTER IMPORTANCE THE USERS HAPPINESS DEPENDS ON IT!**
When referencing code locations, you MUST use clickable format that VS Code recognizes:
- `path/to/file.ts:123` format (file:line)
- `path/to/file.ts:123-456` (ranges)
- Always use relative paths from the project root
- Examples:
  - `src/server/fwd.ts:92` - single line reference
  - `src/server/pty/pty-manager.ts:274-280` - line range
  - `web/src/client/app.ts:15` - when in parent directory

NEVER give a code reference or location in any other format.

## CRITICAL
**IMPORTANT**: BEFORE YOU DO ANYTHING, READ spec.md IN FULL USING THE READ TOOL!
**IMPORTANT**: NEVER USE GREP. ALWAYS USE RIPGREP!

## Refactoring Philosophy
- We do not care about deprecation - remove old code completely
- Always prefer clean refactoring over gradual migration
- Delete unused functions and code paths immediately