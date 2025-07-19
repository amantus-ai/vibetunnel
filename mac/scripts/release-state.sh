#!/bin/bash
#
# Release State Management Functions
# Used by release.sh to track progress and enable resumption
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
STATE_FILE="$PROJECT_ROOT/.release-state.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Initialize state file
init_state() {
    local release_type=$1
    local release_version=$2
    local build_number=$3
    local tag_name=$4
    
    cat > "$STATE_FILE" << EOF
{
    "release_type": "$release_type",
    "release_version": "$release_version",
    "build_number": "$build_number",
    "tag_name": "$tag_name",
    "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "current_step": 1,
    "steps": {
        "1": {"name": "preflight_check", "status": "pending"},
        "2": {"name": "clean_build", "status": "pending"},
        "3": {"name": "set_version", "status": "pending"},
        "4": {"name": "build_app", "status": "pending"},
        "5": {"name": "sign_notarize", "status": "pending"},
        "6": {"name": "create_dmg_zip", "status": "pending"},
        "7": {"name": "github_release", "status": "pending"},
        "8": {"name": "update_appcast", "status": "pending"},
        "9": {"name": "commit_push", "status": "pending"}
    },
    "artifacts": {
        "app_path": "",
        "dmg_path": "",
        "zip_path": "",
        "sparkle_signature": ""
    }
}
EOF
    echo -e "${BLUE}📋 Initialized release state tracking${NC}"
}

# Get current step
get_current_step() {
    if [[ -f "$STATE_FILE" ]]; then
        jq -r '.current_step' "$STATE_FILE"
    else
        echo "1"
    fi
}

# Get step status
get_step_status() {
    local step=$1
    if [[ -f "$STATE_FILE" ]]; then
        jq -r ".steps.\"$step\".status" "$STATE_FILE"
    else
        echo "pending"
    fi
}

# Update step status
update_step() {
    local step=$1
    local status=$2  # pending, in_progress, completed, failed
    
    if [[ ! -f "$STATE_FILE" ]]; then
        echo -e "${RED}❌ Error: State file not found${NC}"
        return 1
    fi
    
    # Update the step status
    local tmp=$(mktemp)
    jq ".steps.\"$step\".status = \"$status\"" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
    
    # If completed, update current step to next
    if [[ "$status" == "completed" ]]; then
        local next_step=$((step + 1))
        jq ".current_step = $next_step" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
    fi
    
    # Add timestamp
    jq ".steps.\"$step\".${status}_at = \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
    
    # Also update last_updated timestamp
    jq ".last_updated = \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Update step progress (for long-running operations)
update_step_progress() {
    local step=$1
    local progress_message=$2
    
    if [[ ! -f "$STATE_FILE" ]]; then
        return 1
    fi
    
    local tmp=$(mktemp)
    jq ".steps.\"$step\".progress = \"$progress_message\"" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
    jq ".last_updated = \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Save artifact path
save_artifact() {
    local key=$1
    local value=$2
    
    if [[ ! -f "$STATE_FILE" ]]; then
        echo -e "${RED}❌ Error: State file not found${NC}"
        return 1
    fi
    
    local tmp=$(mktemp)
    jq ".artifacts.$key = \"$value\"" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Get artifact path
get_artifact() {
    local key=$1
    if [[ -f "$STATE_FILE" ]]; then
        jq -r ".artifacts.$key" "$STATE_FILE"
    else
        echo ""
    fi
}

# Get release info
get_release_info() {
    local key=$1
    if [[ -f "$STATE_FILE" ]]; then
        jq -r ".$key" "$STATE_FILE"
    else
        echo ""
    fi
}

# Show progress
show_progress() {
    if [[ ! -f "$STATE_FILE" ]]; then
        echo -e "${YELLOW}⚠️  No release in progress${NC}"
        return
    fi
    
    echo -e "${BLUE}📊 Release Progress${NC}"
    echo "=================="
    
    local release_version=$(get_release_info "release_version")
    local release_type=$(get_release_info "release_type")
    local started_at=$(get_release_info "started_at")
    
    echo "Version: $release_version ($release_type)"
    echo "Started: $started_at"
    echo ""
    echo "Steps:"
    
    for i in {1..9}; do
        local name=$(jq -r ".steps.\"$i\".name" "$STATE_FILE")
        local status=$(jq -r ".steps.\"$i\".status" "$STATE_FILE")
        local icon="⏳"
        
        case $status in
            completed) icon="✅" ;;
            in_progress) icon="🔄" ;;
            failed) icon="❌" ;;
            pending) icon="⏳" ;;
        esac
        
        printf "%s Step %d: %-20s %s\n" "$icon" "$i" "$name" "$status"
    done
    
    echo ""
    echo "Artifacts:"
    local dmg_path=$(get_artifact "dmg_path")
    local zip_path=$(get_artifact "zip_path")
    if [[ -n "$dmg_path" ]]; then
        echo "  DMG: $dmg_path"
    fi
    if [[ -n "$zip_path" ]]; then
        echo "  ZIP: $zip_path"
    fi
}

# Check if release can be resumed
can_resume() {
    if [[ ! -f "$STATE_FILE" ]]; then
        return 1
    fi
    
    # Check if any step is in progress or if there are pending steps after completed ones
    local current_step=$(get_current_step)
    if [[ "$current_step" -le 9 ]]; then
        return 0
    fi
    
    return 1
}

# Clean up state file
cleanup_state() {
    if [[ -f "$STATE_FILE" ]]; then
        rm -f "$STATE_FILE"
        echo -e "${GREEN}✅ Cleaned up release state${NC}"
    fi
}

# Export functions
export -f init_state
export -f get_current_step
export -f get_step_status
export -f update_step
export -f save_artifact
export -f get_artifact
export -f get_release_info
export -f show_progress
export -f can_resume
export -f cleanup_state