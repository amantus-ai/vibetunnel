#!/bin/bash
# migrate-aggressive-clean-v2.sh - Aggressive cleanup script for VibeTunnel repository (preserves assets)
set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
OLD_REPO="git@github.com:amantus-ai/vibetunnel.git"
NEW_REPO="git@github.com:vibetunnel/vibetunnel.git"
SIZE_THRESHOLD="5M"  # More aggressive - remove files larger than 5MB
BFG_VERSION="1.14.0"

echo -e "${BLUE}🚀 VibeTunnel Repository AGGRESSIVE Cleanup (Assets Preserved)${NC}"
echo -e "${BLUE}=========================================================${NC}"
echo "Old repo: $OLD_REPO"
echo "New repo: $NEW_REPO"
echo "Size threshold: $SIZE_THRESHOLD"
echo ""

# Clone the repository (all branches and tags)
echo -e "${YELLOW}📥 Cloning repository with all history...${NC}"
git clone --mirror "$OLD_REPO" vibetunnel-mirror
cd vibetunnel-mirror

# Create a backup first
echo -e "${YELLOW}💾 Creating backup...${NC}"
cd ..
cp -r vibetunnel-mirror vibetunnel-backup
cd vibetunnel-mirror

# Get initial size
ORIGINAL_SIZE=$(du -sh . | cut -f1)
echo -e "${YELLOW}📏 Original size: ${RED}$ORIGINAL_SIZE${NC}"

# Download BFG Repo-Cleaner if not available
if ! command -v bfg &> /dev/null && [ ! -f ../bfg.jar ]; then
  echo -e "${YELLOW}📦 Downloading BFG Repo-Cleaner...${NC}"
  curl -L -o ../bfg.jar "https://repo1.maven.org/maven2/com/madgag/bfg/${BFG_VERSION}/bfg-${BFG_VERSION}.jar"
fi

# Determine BFG command
if command -v bfg &> /dev/null; then
  BFG_CMD="bfg"
else
  BFG_CMD="java -jar ../bfg.jar"
fi

echo -e "${YELLOW}🧹 Starting aggressive cleanup...${NC}"

# Remove large files EXCEPT those in assets/
echo -e "${YELLOW}🗑️  Removing all files larger than $SIZE_THRESHOLD (except assets/)...${NC}"
# First, get a list of large files NOT in assets/
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  awk '/^blob/ {print substr($0,6)}' | \
  awk '$2 >= 5242880 && $3 !~ /^assets\// {print $1}' > ../large-files-to-remove.txt

if [ -s ../large-files-to-remove.txt ]; then
  echo "Found $(wc -l < ../large-files-to-remove.txt) large files to remove (excluding assets/)"
  # Use BFG to remove specific blobs
  while read -r blob_id; do
    $BFG_CMD --strip-blobs-with-ids <(echo "$blob_id") --no-blob-protection .
  done < ../large-files-to-remove.txt
fi

# Remove specific large directories and files
echo -e "${YELLOW}🗑️  Removing specific large files and directories...${NC}"

# Remove BunPrebuilts
$BFG_CMD --delete-folders 'BunPrebuilts' --no-blob-protection .

# Remove all node_modules everywhere
$BFG_CMD --delete-folders 'node_modules' --no-blob-protection .

# Remove all target directories (Rust builds)
$BFG_CMD --delete-folders 'target' --no-blob-protection .

# Remove electron binaries
$BFG_CMD --delete-folders 'electron' --no-blob-protection .

# Remove build artifacts
$BFG_CMD --delete-folders '{dist,build,out,.next,coverage,.nyc_output}' --no-blob-protection .

# Remove specific file patterns
echo -e "${YELLOW}🗑️  Removing unwanted file patterns...${NC}"
$BFG_CMD --delete-files '*.{log,tmp,cache,swp,swo,zip,tar,gz,dmg,pkg,exe,msi,deb,rpm,AppImage}' --no-blob-protection .
$BFG_CMD --delete-files '.DS_Store' --no-blob-protection .
$BFG_CMD --delete-files 'Thumbs.db' --no-blob-protection .

# Remove binaries
$BFG_CMD --delete-files '*.{dylib,so,dll,node}' --no-blob-protection .  # Remove native binaries
$BFG_CMD --delete-files '*.rlib' --no-blob-protection .  # Remove Rust libraries

# Remove data directory
$BFG_CMD --delete-folders 'data' --no-blob-protection .

# Remove linux binaries
$BFG_CMD --delete-files 'vibetunnel' --no-blob-protection .
$BFG_CMD --delete-files 'vibetunnel-tls' --no-blob-protection .

# Clean up temporary files
rm -f ../large-files-to-remove.txt

# Clean up the repository
echo -e "${YELLOW}♻️  Optimizing repository...${NC}"
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Show size comparison
echo -e "${BLUE}📏 Size comparison:${NC}"
cd ..
ORIGINAL_BYTES=$(du -sb vibetunnel-backup | cut -f1)
CLEANED_SIZE=$(du -sh vibetunnel-mirror | cut -f1)
CLEANED_BYTES=$(du -sb vibetunnel-mirror | cut -f1)
REDUCTION=$((100 - (CLEANED_BYTES * 100 / ORIGINAL_BYTES)))

echo -e "  Original: ${RED}$ORIGINAL_SIZE${NC}"
echo -e "  Cleaned:  ${GREEN}$CLEANED_SIZE${NC}"
echo -e "  Reduction: ${GREEN}${REDUCTION}%${NC}"

# Prepare for push
cd vibetunnel-mirror

# Update remote URL
echo -e "${YELLOW}🔄 Updating remote URL...${NC}"
git remote set-url origin "$NEW_REPO"

# Create a migration report
cat > ../MIGRATION_REPORT.md << EOF
# Repository Migration Report - AGGRESSIVE CLEANUP

**Migration Date:** $(date +"%Y-%m-%d %H:%M:%S")
**Original Repository:** https://github.com/amantus-ai/vibetunnel
**New Repository:** https://github.com/vibetunnel/vibetunnel

## Size Reduction Summary
- **Original Size:** $ORIGINAL_SIZE
- **Cleaned Size:** $CLEANED_SIZE
- **Reduction:** ${REDUCTION}% 🎉

## Aggressive Cleanup Performed
- ✅ All files larger than 5MB removed (except assets/)
- ✅ All node_modules directories removed
- ✅ All Rust target directories removed
- ✅ All BunPrebuilts removed (57MB + 53MB)
- ✅ All electron binaries removed
- ✅ All build artifacts removed (dist, build, out, .next)
- ✅ All archives removed (zip, tar, gz)
- ✅ All binary files removed (dylib, so, dll, node, rlib)
- ✅ All package files removed (dmg, pkg, exe, msi, deb, rpm, AppImage)
- ✅ All data directories removed
- ✅ Linux binaries removed

## What's Preserved
- ✅ All source code (TypeScript, Swift, JavaScript)
- ✅ All documentation
- ✅ All configuration files
- ✅ All tracked assets in assets/ directory (logos, icons, banners)
- ✅ Complete commit history
- ✅ All branches and tags
- ✅ Author information

## Important Notes
- **All commit SHAs have changed** due to history rewriting
- Contributors must re-clone the repository
- The old repository should be archived for reference
- Some CI/CD processes may need adjustment to rebuild removed artifacts

## Next Steps
1. Push to new repository:
   \`\`\`bash
   cd vibetunnel-mirror
   git push --mirror git@github.com:vibetunnel/vibetunnel.git
   \`\`\`

2. Update all local clones:
   \`\`\`bash
   git remote set-url origin git@github.com:vibetunnel/vibetunnel.git
   \`\`\`

3. Archive the old repository on GitHub

4. Update all references in:
   - CI/CD configurations
   - package.json files
   - Documentation
   - Any external services

## Backup Location
The original repository backup is saved at:
\`/Users/steipete/Projects/vibetunnel/web/vibetunnel-backup/\`
EOF

echo -e "${GREEN}✅ Aggressive cleanup complete!${NC}"
echo ""
echo -e "${YELLOW}Repository is ready to push.${NC}"
echo -e "Cleaned size: ${GREEN}$CLEANED_SIZE${NC} (${GREEN}${REDUCTION}% reduction${NC})"
echo ""
echo "To push to the new repository, run:"
echo -e "${BLUE}cd $(pwd)${NC}"
echo -e "${BLUE}git push --mirror $NEW_REPO${NC}"
echo ""
echo "Backup saved in: $(dirname $(pwd))/vibetunnel-backup"
echo "Migration report: $(dirname $(pwd))/MIGRATION_REPORT.md"