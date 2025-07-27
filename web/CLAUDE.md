# Claude Development Notes

## Build Process
- **Never run build commands**
- the user has `pnpm run dev` running which handles automatic rebuilds, either directly or via the mac app
- Never manually run the server. The user does that
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
- **We do not care about backwards compatibility** - Everything is shipped together
- No need to support "older UI versions" - the web UI and server are always deployed as a unit

## Best Practices
- ALWAYS use `Z_INDEX` constants in `src/client/utils/constants.ts` instead of setting z-index properties using primitives / magic numbers
- Add ids to web elements whenever needed to make testing simpler. This helps avoid complex selectors that search by text content or traverse the DOM
  - Use descriptive IDs like `session-kill-button`, `show-exited-button`, `file-picker-choose-button`
  - Prefer ID selectors (`#element-id`) over complex queries in tests
  - When adding interactive elements (buttons, inputs), always consider adding an ID for testability

## CRITICAL: Package Installation Policy
**NEVER install packages without explicit user approval!**
- Do NOT run `pnpm add`, `npm install`, or any package installation commands
- Do NOT modify `package.json` or `pnpm-lock.yaml` unless explicitly requested
- Always ask for permission before suggesting new dependencies
- Understand and work with the existing codebase architecture first
- This project has custom implementations - don't assume we need standard packages

## CRITICAL: vt Command in package.json
**IMPORTANT: DO NOT add "vt": "./bin/vt" to the bin section of package.json or package.npm.json!**
- The vt command must NOT be registered as a global binary in package.json
- This is because it conflicts with other tools that use 'vt' (there are many)
- Instead, vt is conditionally installed via postinstall script only if available
- The postinstall script checks if vt already exists before creating a symlink

## CRITICAL: Playwright Test UI Changes
**IMPORTANT: When tests fail looking for UI elements, investigate the actual UI structure!**

### Best Practices for Test Stability
1. **Always use semantic IDs and data-testid attributes** - These are more stable than CSS selectors
2. **Understand the UI structure** - Don't just increase timeouts, investigate why elements aren't found
3. **Check for collapsible/expandable sections** - Many elements are now hidden by default
4. **Wait for animations** - After expanding sections, wait briefly for animations to complete
5. **Use proper element states** - Wait for 'visible' not just 'attached' for interactive elements