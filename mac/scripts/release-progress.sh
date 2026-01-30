#!/bin/bash
#
# Visual release progress display
#
# Shows the current state of a release with visual indicators
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
STATE_FILE="$PROJECT_ROOT/.release-state.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

# Status icons
ICON_PENDING="⏳"
ICON_PROGRESS="🔄"
ICON_COMPLETE="✅"
ICON_FAILED="❌"

# Check if state file exists
if [[ ! -f "$STATE_FILE" ]]; then
    echo -e "${RED}No active release found${NC}"
    exit 1
fi

# Parse state
RELEASE_VERSION=$(jq -r '.release_version' "$STATE_FILE")
RELEASE_TYPE=$(jq -r '.release_type' "$STATE_FILE")
STARTED_AT=$(jq -r '.started_at' "$STATE_FILE")
LAST_UPDATED=$(jq -r '.last_updated // empty' "$STATE_FILE")
CURRENT_STEP=$(jq -r '.current_step' "$STATE_FILE")

# Calculate duration
START_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED_AT" +%s 2>/dev/null || date -d "$STARTED_AT" +%s)
CURRENT_TIMESTAMP=$(date +%s)
DURATION=$((CURRENT_TIMESTAMP - START_TIMESTAMP))
DURATION_MIN=$((DURATION / 60))
DURATION_SEC=$((DURATION % 60))

# Calculate time since last update
if [[ -n "$LAST_UPDATED" ]]; then
    LAST_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_UPDATED" +%s 2>/dev/null || date -d "$LAST_UPDATED" +%s)
    IDLE_TIME=$((CURRENT_TIMESTAMP - LAST_TIMESTAMP))
    IDLE_MIN=$((IDLE_TIME / 60))
fi

# Clear screen for clean display
clear

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     VibeTunnel Release Progress Monitor    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Version:${NC} $RELEASE_VERSION ($RELEASE_TYPE)"
echo -e "${CYAN}Started:${NC} $STARTED_AT"
echo -e "${CYAN}Duration:${NC} ${DURATION_MIN}m ${DURATION_SEC}s"

if [[ -n "$LAST_UPDATED" ]] && [[ $IDLE_MIN -gt 5 ]]; then
    echo -e "${YELLOW}⚠️  No activity for ${IDLE_MIN} minutes${NC}"
fi

echo ""
echo -e "${BLUE}Progress:${NC}"
echo ""

# Display each step
for i in {1..9}; do
    STEP_NAME=$(jq -r ".steps.\"$i\".name" "$STATE_FILE")
    STEP_STATUS=$(jq -r ".steps.\"$i\".status" "$STATE_FILE")
    STEP_STARTED=$(jq -r ".steps.\"$i\".in_progress_at // empty" "$STATE_FILE")
    STEP_COMPLETED=$(jq -r ".steps.\"$i\".completed_at // empty" "$STATE_FILE")
    
    # Choose icon and color
    case "$STEP_STATUS" in
        pending)
            ICON=$ICON_PENDING
            COLOR=$GRAY
            ;;
        in_progress)
            ICON=$ICON_PROGRESS
            COLOR=$YELLOW
            ;;
        completed)
            ICON=$ICON_COMPLETE
            COLOR=$GREEN
            ;;
        failed)
            ICON=$ICON_FAILED
            COLOR=$RED
            ;;
    esac
    
    # Format step name
    STEP_DISPLAY=$(echo "$STEP_NAME" | tr '_' ' ' | sed 's/\b\(.\)/\u\1/g')
    
    # Calculate step duration if completed
    STEP_DURATION=""
    if [[ -n "$STEP_STARTED" ]] && [[ -n "$STEP_COMPLETED" ]]; then
        START_TS=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STEP_STARTED" +%s 2>/dev/null || date -d "$STEP_STARTED" +%s)
        END_TS=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STEP_COMPLETED" +%s 2>/dev/null || date -d "$STEP_COMPLETED" +%s)
        DURATION=$((END_TS - START_TS))
        STEP_DURATION=" (${DURATION}s)"
    elif [[ "$STEP_STATUS" == "in_progress" ]] && [[ -n "$STEP_STARTED" ]]; then
        START_TS=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STEP_STARTED" +%s 2>/dev/null || date -d "$STEP_STARTED" +%s)
        DURATION=$((CURRENT_TIMESTAMP - START_TS))
        STEP_DURATION=" (${DURATION}s...)"
    fi
    
    # Current step indicator
    if [[ $i -eq $CURRENT_STEP ]]; then
        echo -e "${COLOR}→ $ICON Step $i: $STEP_DISPLAY$STEP_DURATION${NC}"
    else
        echo -e "${COLOR}  $ICON Step $i: $STEP_DISPLAY$STEP_DURATION${NC}"
    fi
done

echo ""

# Show artifacts if any
DMG_PATH=$(jq -r '.artifacts.dmg_path // empty' "$STATE_FILE")
ZIP_PATH=$(jq -r '.artifacts.zip_path // empty' "$STATE_FILE")
SPARKLE_SIG=$(jq -r '.artifacts.sparkle_signature // empty' "$STATE_FILE")

if [[ -n "$DMG_PATH" ]] || [[ -n "$ZIP_PATH" ]]; then
    echo -e "${BLUE}Artifacts:${NC}"
    [[ -n "$DMG_PATH" ]] && [[ -f "$DMG_PATH" ]] && echo -e "  ${GREEN}✓${NC} DMG: $(basename "$DMG_PATH")"
    [[ -n "$ZIP_PATH" ]] && [[ -f "$ZIP_PATH" ]] && echo -e "  ${GREEN}✓${NC} ZIP: $(basename "$ZIP_PATH")"
    [[ -n "$SPARKLE_SIG" ]] && echo -e "  ${GREEN}✓${NC} Sparkle signature generated"
    echo ""
fi

# Show estimated time for current step
if [[ "$STEP_STATUS" == "in_progress" ]]; then
    case "$STEP_NAME" in
        build_app)
            echo -e "${CYAN}ℹ️  Build typically takes 2-5 minutes${NC}"
            ;;
        sign_notarize)
            echo -e "${CYAN}ℹ️  Notarization typically takes 5-15 minutes${NC}"
            ;;
        create_dmg_zip)
            echo -e "${CYAN}ℹ️  DMG creation typically takes 1-2 minutes${NC}"
            ;;
    esac
fi

# Show next steps or completion
if [[ $CURRENT_STEP -gt 9 ]]; then
    echo -e "${GREEN}🎉 Release completed successfully!${NC}"
else
    echo -e "${BLUE}Next:${NC} Step $CURRENT_STEP will continue automatically"
    echo -e "${GRAY}To check status again: ./scripts/release-progress.sh${NC}"
    echo -e "${GRAY}To resume if interrupted: ./scripts/release.sh --resume${NC}"
fi