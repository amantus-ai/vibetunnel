# GitHub Organization Migration Plan

This document outlines the migration process for moving VibeTunnel from `amantus-ai/vibetunnel` to `vibetunnel/vibetunnel`.

**Status: TODO** - This migration has not been completed yet.

## Migration Options

### Option 1: Simple Transfer (GitHub Built-in)

The simplest approach using GitHub's native transfer feature.

#### What Transfers Automatically

✅ **Code & History**
- All branches and commit history
- Git tags and annotated tags

✅ **Project Management**
- Issues and pull requests (with all comments)
- Projects (classic and new)
- Releases and release assets
- Milestones and labels

✅ **Community Features**
- Stars and watchers
- Wiki content
- Fork relationships

✅ **Security & Integration**
- Webhooks configurations
- Deploy keys
- Repository-level secrets
- GitHub Actions workflows
- Git LFS objects (copied in background)

#### What Needs Manual Updates

⚠️ **Organization-level Settings**
- Branch protection rules (inherits new org defaults - review carefully)
- Organization-level secrets (must recreate in new org)
- Environment-level secrets (if used outside repo scope)
- Team permissions (reassign in new org structure)

⚠️ **External Integrations**
- CI/CD systems with hardcoded URLs
- Documentation with repository links
- Package registries (npm, etc.)
- External webhooks
- Status badges in README

### Option 2: Migration with History Cleanup

Since `https://github.com/vibetunnel/vibetunnel` may already exist, we can perform a clean migration that:
1. Removes large files from history
2. Cleans up accidental commits
3. Preserves important history
4. Maintains all issues, PRs, and project management features

Use BFG Repo-Cleaner or git-filter-repo to create a cleaned version of the repository.

## Pre-Migration Checklist

### Preparation (1-2 days before)

- [ ] **Prepare Target Organization**
  - Create `vibetunnel` organization if not exists
  - Set up teams and permissions structure
  - Configure organization-level settings
  - Review default branch protection rules

- [ ] **Audit Current Setup**
  - Document all webhooks and integrations
  - List organization/environment secrets
  - Note branch protection rules
  - Identify external services using the repo

- [ ] **Analyze Repository for Cleanup (if using Option 2)**
  ```bash
  # Find large files in history
  git rev-list --objects --all | \
    git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
    awk '/^blob/ && $3 > 10485760 {print $3, $4}' | \
    sort -rn | \
    numfmt --field=1 --to=iec
  ```

- [ ] **Notify Stakeholders**
  - Team members about the migration
  - Users via issue/discussion if needed
  - Update any public documentation

## Migration Process

### Option 1: Simple Transfer Steps

1. Navigate to **Settings → General → Danger Zone → Transfer**
2. Enter the new owner: `vibetunnel`
3. Type the repository name to confirm
4. Accept the invite from the destination org
5. Done! ✅

### Option 2: Clean Migration Script

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

# Update remote URL and push
cd vibetunnel-mirror
git remote set-url origin "$NEW_REPO"

# Interactive confirmation
echo "⚠️  Ready to push to $NEW_REPO"
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
```

## Post-Migration Updates

### Update Git Remotes
```bash
# For all local clones
git remote set-url origin git@github.com:vibetunnel/vibetunnel.git

# Verify the change
git remote -v
```

### Update VibeTunnel Code

- [ ] Update `GITHUB_URL` in `mac/VibeTunnel/version.xcconfig`
- [ ] Update repository URLs in all `package.json` files:
  ```json
  {
    "repository": {
      "type": "git",
      "url": "git+https://github.com/vibetunnel/vibetunnel.git"
    },
    "bugs": {
      "url": "https://github.com/vibetunnel/vibetunnel/issues"
    },
    "homepage": "https://github.com/vibetunnel/vibetunnel#readme"
  }
  ```
- [ ] Update any hardcoded GitHub URLs in documentation
- [ ] Update CLAUDE.md references
- [ ] Update docs.json if it contains repository URLs

### Update External Services

- [ ] CI/CD configurations
- [ ] npm package registry URLs
- [ ] Monitoring services
- [ ] Documentation sites
- [ ] README badges and links
- [ ] Installation instructions
- [ ] Contributing guidelines

### Build & Release

- [ ] Update GitHub Actions secrets if needed
- [ ] Verify macOS notarization still works
- [ ] Test release workflow with new repo URL
- [ ] Update Sparkle appcast URLs if applicable
- [ ] Consider publishing a patch version with updated URLs

## Redirect Behavior

GitHub automatically sets up redirects:
- `https://github.com/amantus-ai/vibetunnel` → `https://github.com/vibetunnel/vibetunnel`
- Git operations: `git clone git@github.com:amantus-ai/vibetunnel.git` still works
- API calls to old URL redirect automatically

⚠️ **Redirect Limitations**:
- Redirects break if someone creates a new repo at `amantus-ai/vibetunnel`
- Some tools may not follow redirects properly
- Best practice: Update all references ASAP

## Timeline

**Day 1**: Preparation
- Set up new organization
- Audit current configuration
- Notify team

**Day 2**: Migration
- Morning: Final preparations
- Midday: Execute transfer
- Afternoon: Update configurations

**Day 3**: Verification
- Test all integrations
- Monitor for issues
- Complete documentation updates

## Important Notes

- GitHub's transfer process is well-tested and reliable
- The automatic redirects provide good backward compatibility
- If using history cleanup (Option 2):
  - This process rewrites history - all commit SHAs will change
  - Contributors will need to re-clone or rebase their work
  - Keep the cleaned backup for a few weeks
- Consider doing this during a low-activity period

## Rollback Plan

If issues arise:
1. GitHub Support can reverse transfers within a short window
2. Keep the migration backup (if using Option 2)
3. Document any issues for future reference

## References

- [GitHub Docs: Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) (for Option 2)
- [git-filter-repo](https://github.com/newren/git-filter-repo) (alternative to BFG)
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)