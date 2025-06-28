# Development Guide

## Code Quality Tools

VibeTunnel uses several tools to maintain code quality:

### Running All Checks

To run all code quality checks simultaneously:

```bash
pnpm run check
```

This runs format checking, linting, and type checking in parallel and reports any issues.

### Individual Tools

**Formatting** (Biome):
```bash
pnpm run format        # Fix formatting issues
pnpm run format:check  # Check formatting without fixing
```

**Linting** (Biome + TypeScript):
```bash
pnpm run lint      # Check for lint errors
pnpm run lint:fix  # Fix auto-fixable lint errors
```

**Type Checking** (TypeScript):
```bash
pnpm run typecheck  # Run type checking on all configs
```

### Auto-fix All Issues

To automatically fix all formatting and linting issues:

```bash
pnpm run check:fix
```

This runs both `format` and `lint:fix` in parallel.

## Why Multiple Tools?

1. **Biome**: Fast, modern formatter and linter for JavaScript/TypeScript
2. **TypeScript**: Type checking across server, client, and service worker contexts
3. **Parallel execution**: Saves time by running independent checks simultaneously

## Tips for Faster Development

1. **Use `pnpm run check` before committing** - Catches all issues at once
2. **Enable format-on-save in your editor** - Prevents formatting issues
3. **Run `pnpm run check:fix` to quickly fix issues** - Handles most problems automatically

## Continuous Development

When developing, you typically want:

```bash
# Terminal 1: Run the dev server
pnpm run dev

# Terminal 2: Run tests in watch mode (when needed)
pnpm test

# Before committing: Run all checks
pnpm run check
```