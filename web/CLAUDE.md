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
- **ALWAYS run code quality checks before committing:**
    - `pnpm run check` - Run all checks (format, lint, typecheck) in parallel
    - This is the ONLY command you need to run for checking
    - It runs everything concurrently for maximum speed
- **If there are issues to fix:**
    - `pnpm run check:fix` - Auto-fix formatting and linting issues (runs sequentially to avoid conflicts)
- **Individual commands (rarely needed):**
    - `pnpm run format` / `pnpm run format:check`
    - `pnpm run lint` / `pnpm run lint:fix`
    - `pnpm run typecheck`
- Always fix all linting and type checking errors, including in unrelated code
- Never run the tests, unless explicitly asked to. `pnpm run test`

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

## Git Commands
When asked to "commit and push", "commit + push", "/cp", or "c+p", use a single command:
```bash
git add -A && git commit -m "commit message" && git push
```
Do NOT use three separate commands (add, commit, push) as this is slow.

## Refactoring Philosophy
- We do not care about deprecation - remove old code completely
- Always prefer clean refactoring over gradual migration
- Delete unused functions and code paths immediately

## Best Practices
- ALWAYS use `Z_INDEX` constants in `src/client/utils/constants.ts` instead of setting z-index properties using primitives / magic numbers

## CRITICAL: Package Installation Policy
**NEVER install packages without explicit user approval!**
- Do NOT run `pnpm add`, `npm install`, or any package installation commands
- Do NOT modify `package.json` or `pnpm-lock.yaml` unless explicitly requested
- Always ask for permission before suggesting new dependencies
- Understand and work with the existing codebase architecture first
- This project has custom implementations - don't assume we need standard packages