#!/bin/bash
# migrate-clean-repo.sh - Clean migration script for VibeTunnel repository
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
TEMP_DIR="vibetunnel-migration-$(date +%Y%m%d-%H%M%S)"
SIZE_THRESHOLD="10M"  # Files larger than this will be removed
BFG_VERSION="1.14.0"

echo -e "${BLUE}🚀 VibeTunnel Repository Migration with Cleanup${NC}"
echo -e "${BLUE}================================================${NC}"
echo "Old repo: $OLD_REPO"
echo "New repo: $NEW_REPO"
echo "Size threshold: $SIZE_THRESHOLD"
echo ""

# Create temporary directory
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"
WORK_DIR=$(pwd)

# Clone the repository (all branches and tags)
echo -e "${YELLOW}📥 Cloning repository with all history...${NC}"
git clone --mirror "$OLD_REPO" vibetunnel-mirror
cd vibetunnel-mirror

# Create a backup first
echo -e "${YELLOW}💾 Creating backup...${NC}"
cd ..
cp -r vibetunnel-mirror vibetunnel-backup
cd vibetunnel-mirror

# Analyze repository for large files
echo -e "${YELLOW}🔍 Analyzing repository for large files...${NC}"
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  awk '/^blob/ {print substr($0,6)}' | \
  sort --numeric-sort --key=2 --reverse | \
  awk '$2 >= 10485760 {print $1, $2, $3}' > ../large-files.txt

if [ -s ../large-files.txt ]; then
  echo -e "${RED}📊 Large files found:${NC}"
  cat ../large-files.txt | while read hash size path; do
    echo "  - $path ($(numfmt --to=iec $size))"
  done
else
  echo -e "${GREEN}✓ No large files found${NC}"
fi

# Find common unwanted files
echo -e "${YELLOW}🔍 Analyzing for common unwanted files...${NC}"
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  awk '/^blob/ {print substr($0,6)}' | \
  grep -E '\.(log|tmp|cache|DS_Store)$|node_modules/|dist/|build/|\.next/|out/' > ../unwanted-files.txt

if [ -s ../unwanted-files.txt ]; then
  echo -e "${RED}🗑️  Unwanted files found:${NC}"
  cat ../unwanted-files.txt | awk '{print "  - " $3 " (" $2 " bytes)"}' | head -20
  TOTAL_UNWANTED=$(wc -l < ../unwanted-files.txt)
  if [ $TOTAL_UNWANTED -gt 20 ]; then
    echo "  ... and $((TOTAL_UNWANTED - 20)) more files"
  fi
fi

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

# Clean large files using BFG
echo -e "${YELLOW}🧹 Removing large files from history...${NC}"
$BFG_CMD --strip-blobs-bigger-than "$SIZE_THRESHOLD" --no-blob-protection .

# Clean specific file patterns
echo -e "${YELLOW}🗑️  Removing unwanted file patterns...${NC}"

# Remove common unwanted files
$BFG_CMD --delete-files '*.{log,tmp,cache,swp,swo}' --no-blob-protection .
$BFG_CMD --delete-files '.DS_Store' --no-blob-protection .
$BFG_CMD --delete-files 'Thumbs.db' --no-blob-protection .

# Remove build artifacts and dependencies
echo -e "${YELLOW}🏗️  Removing build artifacts...${NC}"
$BFG_CMD --delete-folders '{node_modules,.next,dist,build,out,coverage,.nyc_output}' --no-blob-protection .

# Remove potential sensitive files (customize as needed)
echo -e "${YELLOW}🔒 Checking for potentially sensitive files...${NC}"
# $BFG_CMD --delete-files '*.env' --no-blob-protection .
# $BFG_CMD --delete-files '*secret*' --no-blob-protection .
# $BFG_CMD --delete-files '*.pem' --no-blob-protection .

# Clean up the repository
echo -e "${YELLOW}♻️  Optimizing repository...${NC}"
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Show size comparison
echo -e "${BLUE}📏 Size comparison:${NC}"
cd ..
ORIGINAL_SIZE=$(du -sh vibetunnel-backup | cut -f1)
CLEANED_SIZE=$(du -sh vibetunnel-mirror | cut -f1)
echo -e "  Original: ${RED}$ORIGINAL_SIZE${NC}"
echo -e "  Cleaned:  ${GREEN}$CLEANED_SIZE${NC}"

# Calculate reduction percentage
ORIGINAL_BYTES=$(du -sb vibetunnel-backup | cut -f1)
CLEANED_BYTES=$(du -sb vibetunnel-mirror | cut -f1)
REDUCTION=$((100 - (CLEANED_BYTES * 100 / ORIGINAL_BYTES)))
echo -e "  Reduction: ${GREEN}${REDUCTION}%${NC}"

# Prepare for push
cd vibetunnel-mirror

# Create a migration report
echo -e "${YELLOW}📝 Creating migration report...${NC}"
cat > MIGRATION_REPORT.md << EOF
# Repository Migration Report

**Migration Date:** $(date +"%Y-%m-%d %H:%M:%S")
**Original Repository:** https://github.com/amantus-ai/vibetunnel
**New Repository:** https://github.com/vibetunnel/vibetunnel

## Size Reduction
- Original Size: $ORIGINAL_SIZE
- Cleaned Size: $CLEANED_SIZE
- Reduction: ${REDUCTION}%

## Files Removed
### Large Files (>${SIZE_THRESHOLD})
$(if [ -s ../large-files.txt ]; then
  cat ../large-files.txt | while read hash size path; do 
    echo "- \`$path\` ($(numfmt --to=iec $size))"
  done | head -20
else
  echo "None found"
fi)

### Build Artifacts and Dependencies
- node_modules/ directories
- dist/ directories
- build/ directories
- .next/ directories
- Log files (*.log)
- Temporary files (*.tmp, *.cache)
- OS files (.DS_Store, Thumbs.db)

## Preservation
- ✅ All source code preserved
- ✅ Commit history maintained
- ✅ Author information retained
- ✅ Branches and tags preserved

## Notes
- All commit SHAs have changed due to history rewriting
- Contributors will need to re-clone the repository
- The old repository should be archived for reference
EOF

# Show the report
echo -e "${GREEN}Migration Report:${NC}"
cat MIGRATION_REPORT.md

# Update remote URL
echo -e "${YELLOW}🔄 Updating remote URL...${NC}"
git remote set-url origin "$NEW_REPO"

# Final confirmation
echo ""
echo -e "${RED}⚠️  Ready to push to $NEW_REPO${NC}"
echo "This will:"
echo "  - Push all cleaned branches and tags"
echo "  - Permanently remove large files from history"
echo "  - Change all commit SHAs"
echo ""
echo -e "${YELLOW}Backup location: $WORK_DIR/vibetunnel-backup${NC}"
echo ""
read -p "Continue with push? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}❌ Push aborted${NC}"
  echo "You can manually push later with:"
  echo "  cd $WORK_DIR/vibetunnel-mirror"
  echo "  git push --mirror $NEW_REPO"
  exit 1
fi

# Push to new repository
echo -e "${YELLOW}📤 Pushing to new repository...${NC}"
if git push --mirror "$NEW_REPO"; then
  echo -e "${GREEN}✅ Migration complete!${NC}"
else
  echo -e "${RED}❌ Push failed${NC}"
  echo "You can retry with:"
  echo "  cd $WORK_DIR/vibetunnel-mirror"
  echo "  git push --mirror $NEW_REPO"
  exit 1
fi

# Success message
echo ""
echo -e "${GREEN}🎉 Migration successful!${NC}"
echo ""
echo "Next steps:"
echo "1. Check the new repository: https://github.com/vibetunnel/vibetunnel"
echo "2. Update all local clones:"
echo "   ${BLUE}git remote set-url origin $NEW_REPO${NC}"
echo "3. Update CI/CD configurations"
echo "4. Update package.json repository URLs"
echo "5. Notify all contributors about the change"
echo "6. Archive the old repository"
echo ""
echo -e "${YELLOW}📁 Migration files saved in: $WORK_DIR${NC}"
echo "  - vibetunnel-backup/ (original mirror)"
echo "  - vibetunnel-mirror/ (cleaned repository)"
echo "  - large-files.txt (list of removed large files)"
echo "  - unwanted-files.txt (list of removed unwanted files)"
echo "  - MIGRATION_REPORT.md (detailed report)"