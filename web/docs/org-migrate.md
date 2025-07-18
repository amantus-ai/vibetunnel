# GitHub Organization Migration Plan with Repository Cleanup

This document outlines the migration process for moving VibeTunnel to `vibetunnel/vibetunnel` with a clean history.

## Overview

Since `https://github.com/vibetunnel/vibetunnel` already exists, we'll perform a clean migration that:
1. Removes large files from history
2. Cleans up accidental commits
3. Preserves important history
4. Maintains all issues, PRs, and project management features

## Migration Strategy

### Option 1: Clean History Migration (Recommended)

Use BFG Repo-Cleaner or git-filter-repo to create a cleaned version of the repository, then push to the new location.

### Option 2: Fresh Start with Preserved History

Create a new repository with cleaned history while maintaining a reference to the old repository for historical purposes.

## Migration Script

Save this as `migrate-clean.sh`:

```bash
#!/bin/bash
set -euo pipefail

# Configuration
OLD_REPO="git@github.com:amantus-ai/vibetunnel.git"
NEW_REPO="git@github.com:vibetunnel/vibetunnel.git"
TEMP_DIR="vibetunnel-migration-$(date +%Y%m%d-%H%M%S)"
SIZE_THRESHOLD="10M"  # Files larger than this will be removed

echo "🚀 Starting VibeTunnel repository migration with cleanup..."

# Create temporary directory
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# Clone the repository (all branches and tags)
echo "📥 Cloning repository with all history..."
git clone --mirror "$OLD_REPO" vibetunnel-mirror
cd vibetunnel-mirror

# Create a backup first
echo "💾 Creating backup..."
cp -r . ../vibetunnel-backup

# Analyze repository for large files
echo "🔍 Analyzing repository for large files..."
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  awk '/^blob/ {print substr($0,6)}' | \
  sort --numeric-sort --key=2 --reverse | \
  awk '$2 >= 10485760 {print $1, $2, $3}' > ../large-files.txt

echo "📊 Large files found:"
cat ../large-files.txt | while read hash size path; do
  echo "  - $path ($(numfmt --to=iec $size))"
done

# Download BFG Repo-Cleaner if not available
if ! command -v bfg &> /dev/null && [ ! -f ../bfg.jar ]; then
  echo "📦 Downloading BFG Repo-Cleaner..."
  curl -L -o ../bfg.jar https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
fi

# Clean large files using BFG
echo "🧹 Removing large files from history..."
java -jar ../bfg.jar --strip-blobs-bigger-than "$SIZE_THRESHOLD" --no-blob-protection

# Clean specific file patterns (customize as needed)
echo "🗑️  Removing unwanted file patterns..."
java -jar ../bfg.jar --delete-files '*.{log,tmp,cache}' --no-blob-protection
java -jar ../bfg.jar --delete-folders '{node_modules,dist,build}' --no-blob-protection

# Remove sensitive data patterns (customize as needed)
echo "🔒 Removing potentially sensitive patterns..."
# Example: Remove files with specific names
# java -jar ../bfg.jar --delete-files 'secrets.json' --no-blob-protection

# Clean up the repository
echo "♻️  Cleaning up repository..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Show size comparison
echo "📏 Size comparison:"
cd ..
ORIGINAL_SIZE=$(du -sh vibetunnel-backup | cut -f1)
CLEANED_SIZE=$(du -sh vibetunnel-mirror | cut -f1)
echo "  Original: $ORIGINAL_SIZE"
echo "  Cleaned:  $CLEANED_SIZE"

# Prepare for push
cd vibetunnel-mirror

# Update remote URL
echo "🔄 Updating remote URL..."
git remote set-url origin "$NEW_REPO"

# Create a migration notes file
cat > MIGRATION_NOTES.md << EOF
# Repository Migration Notes

This repository was migrated from amantus-ai/vibetunnel on $(date +%Y-%m-%d).

## Changes during migration:
- Removed files larger than $SIZE_THRESHOLD from history
- Cleaned up temporary and build files
- Preserved all code, issues, and pull requests

## Original repository:
- https://github.com/amantus-ai/vibetunnel

## Large files removed:
$(cat ../large-files.txt | while read hash size path; do echo "- $path ($(numfmt --to=iec $size))"; done)
EOF

# Interactive confirmation
echo "⚠️  Ready to push to $NEW_REPO"
echo "This will:"
echo "  - Push all cleaned branches and tags"
echo "  - Permanently remove large files from history"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted"
  exit 1
fi

# Push to new repository
echo "📤 Pushing to new repository..."
git push --mirror "$NEW_REPO"

echo "✅ Migration complete!"
echo ""
echo "Next steps:"
echo "1. Check the new repository: https://github.com/vibetunnel/vibetunnel"
echo "2. Update all local clones to use the new URL"
echo "3. Update CI/CD configurations"
echo "4. Archive or delete the old repository"
echo ""
echo "Migration backup saved in: $(pwd)/../vibetunnel-backup"
```

## Alternative: Using git-filter-repo (More Powerful)

```bash
#!/bin/bash
# migrate-with-filter-repo.sh

# Install git-filter-repo first:
# brew install git-filter-repo

set -euo pipefail

OLD_REPO="git@github.com:amantus-ai/vibetunnel.git"
NEW_REPO="git@github.com:vibetunnel/vibetunnel.git"
TEMP_DIR="vibetunnel-clean-$(date +%Y%m%d-%H%M%S)"

# Clone repository
git clone "$OLD_REPO" "$TEMP_DIR"
cd "$TEMP_DIR"

# Analyze repository
git filter-repo --analyze
echo "Check .git/filter-repo/analysis for detailed reports"

# Remove large files (size in bytes, 10MB = 10485760)
git filter-repo --strip-blobs-bigger-than 10M

# Remove specific paths
git filter-repo --path node_modules/ --invert-paths
git filter-repo --path dist/ --invert-paths
git filter-repo --path build/ --invert-paths
git filter-repo --path "*.log" --invert-paths
git filter-repo --path "*.tmp" --invert-paths

# Remove specific commits by message pattern (optional)
# git filter-repo --message-callback '
#   if b"WIP" in message or b"temp" in message.lower():
#     message = b"[CLEANED] " + message
#   return message
# '

# Add new remote and push
git remote add new-origin "$NEW_REPO"
git push new-origin --all
git push new-origin --tags

echo "✅ Migration with cleanup complete!"
```

## Pre-Migration Checklist

- [ ] **Identify files to remove**
  ```bash
  # Find large files in history
  git rev-list --objects --all | \
    git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
    awk '/^blob/ && $3 > 10485760 {print $3, $4}' | \
    sort -rn | \
    numfmt --field=1 --to=iec
  ```

- [ ] **List accidental commits**
  - Large binary files
  - Generated files (dist/, build/)
  - Dependencies (node_modules/)
  - Log files
  - Temporary files
  - Any sensitive data

- [ ] **Backup current repository**
  ```bash
  git clone --mirror git@github.com:amantus-ai/vibetunnel.git vibetunnel-backup
  ```

## What Gets Preserved

✅ **Preserved:**
- All source code
- Commit messages and authors
- Branch structure
- Tags and releases
- Important history

❌ **Removed:**
- Large binary files
- Generated/built files
- Accidentally committed dependencies
- Log and temporary files
- Specified sensitive data

## Post-Migration Steps

1. **Update all references**
   - Package.json repository URLs
   - Documentation links
   - CI/CD configurations
   - Local git remotes

2. **Verify the migration**
   - Check file sizes
   - Verify important history
   - Test clone and build
   - Ensure CI/CD works

3. **Communicate changes**
   - Notify all contributors
   - Update README with new URL
   - Add note about the migration

## Important Notes

- This process rewrites history - all commit SHAs will change
- Contributors will need to re-clone or rebase their work
- The old repository should be archived, not deleted immediately
- Consider keeping the cleaned backup for a few weeks

## Size Reduction Examples

Common size reductions from cleaning:
- Removing accidentally committed node_modules: 50-200MB
- Removing build artifacts: 10-50MB
- Removing large media files: Variable
- Removing package-lock.json history: 5-20MB

## References

- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
- [git-filter-repo](https://github.com/newren/git-filter-repo)
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)