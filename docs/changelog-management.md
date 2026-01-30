# Changelog Management Guide

This guide explains how to maintain the CHANGELOG.md and GitHub releases for VibeTunnel.

## Overview

We maintain a comprehensive changelog that:
- Documents all user-facing changes
- Credits contributors properly with GitHub links
- Tracks first-time contributors for each release
- Provides clear, user-friendly descriptions

## Using the `/changelog` Command

The `/changelog` command in Claude Code analyzes git history to generate comprehensive changelogs:

```bash
# In Claude Code, simply type:
/changelog
```

This command:
- Analyzes commit history beyond just titles
- Examines actual file changes to understand user impact
- Groups changes by category (Features, Bug Fixes, Performance, etc.)
- Writes user-focused descriptions (not developer jargon)

## Changelog Format

### Version Header
```markdown
## [1.0.0-beta.13] - 2024-12-20
```

### Categories
- **Features** - New functionality
- **Improvements** - Enhancements to existing features
- **Bug Fixes** - Fixed issues
- **Performance** - Speed/efficiency improvements
- **Developer Experience** - Build, test, or development improvements

### Attribution Format

Every change should credit its contributor:
```markdown
- Added systemd service management for Linux deployments (via [@hewigovens](https://github.com/hewigovens)) (#419)
```

Format: `- Description (via [@username](https://github.com/username)) (#PR)`

### First-time Contributors Section

For releases with new contributors:
```markdown
### First-time Contributors
- [@hewigovens](https://github.com/hewigovens) - Added systemd service management for Linux (#419)
```

## Identifying Contributors

### Finding First-time Contributors

```bash
# Get all contributors up to a specific release
git log --format="%an|%ae" v1.0.0-beta.12 | sort -u

# Get contributors for a specific release
git log --format="%an|%ae" v1.0.0-beta.12..v1.0.0-beta.13 | sort -u

# Compare to find first-timers
```

### Mapping Changes to Contributors

```bash
# Find who made specific changes
git log --oneline --author="username" v1.0.0-beta.12..v1.0.0-beta.13

# Get detailed commit info with files
git log --stat --author="username" v1.0.0-beta.12..v1.0.0-beta.13
```

## Special Cases

### Bot Contributors
Do not highlight bot contributors as first-time contributors or include them in the contributors list:
- `devin-ai-integration[bot]`
- `blacksmith-sh[bot]`
- Other `*[bot]` accounts

**Important**: Bot contributions should be completely excluded from:
- First-time contributors sections
- The main contributors list at the end of CHANGELOG.md
- GitHub release notes contributors sections

Bot changes can be mentioned in regular changelog entries (e.g., "Added SwiftLint hooks") but without attribution.

### Core Team
Core team members (repository owners) don't need "(via @username)" attribution unless specifically requested.

### Multiple Contributors
If multiple people worked on a feature:
```markdown
- Feature description (via [@user1](https://github.com/user1), [@user2](https://github.com/user2)) (#123)
```

## GitHub Releases

### Creating a Release

1. **Generate changelog** using `/changelog` command
2. **Review and edit** the generated content
3. **Update CHANGELOG.md** with the new version section
4. **Create GitHub release**:
   ```bash
   gh release create v1.0.0-beta.14 \
     --title "v1.0.0-beta.14" \
     --notes-file release-notes.md \
     --prerelease
   ```

### Release Notes Format

The GitHub release should include:

1. **Highlights** - 2-3 major changes
2. **Full changelog** - Copy from CHANGELOG.md
3. **First-time contributors** - If applicable
4. **Installation instructions** - Brief reminder

Example:
```markdown
## Highlights
- 🐧 Linux systemd service support for production deployments
- 🔧 Improved authentication reliability
- 🚀 Better performance for large terminal outputs

## What's Changed
[Copy from CHANGELOG.md]

## First-time Contributors
- @hewigovens made their first contribution in #419

## Installation
See [installation instructions](https://github.com/vibetunnel/vibetunnel#installation)
```

### Updating Existing Releases

To add first-time contributors to existing releases:

```bash
# Edit a release
gh release edit v1.0.0-beta.13 --notes-file updated-notes.md

# Or use the GitHub web UI
```

## Workflow Summary

1. **Before release**: Run `/changelog` to analyze changes
2. **Review output**: Ensure proper attribution and user-friendly descriptions
3. **Update CHANGELOG.md**: Add new version section with proper formatting
4. **Create release notes**: Include highlights and first-time contributors
5. **Create GitHub release**: Use `gh release create` or web UI
6. **Verify**: Check that all contributors are properly credited

## Tips

- Always verify contributor GitHub usernames for correct links
- Use clear, non-technical language in descriptions
- Include PR numbers for traceability
- Group related changes together
- Highlight breaking changes prominently
- Credit everyone who contributed, no matter how small

## Example Workflow

```bash
# 1. Generate changelog
/changelog

# 2. Create release notes file
cat > release-notes.md << 'EOF'
## Highlights
- 🎯 Major feature one
- 🐛 Critical bug fix
- ⚡ Performance improvement

## What's Changed
[Paste from CHANGELOG.md]

## First-time Contributors
- @newcontributor made their first contribution in #123

## Installation
See [installation instructions](https://github.com/vibetunnel/vibetunnel#installation)
EOF

# 3. Create release
gh release create v1.0.0-beta.14 \
  --title "v1.0.0-beta.14" \
  --notes-file release-notes.md \
  --prerelease

# 4. Clean up
rm release-notes.md
```