#!/bin/bash

# =============================================================================
# VibeTunnel Common Script Library
# =============================================================================
#
# This file provides common functions and utilities for all VibeTunnel scripts
# to ensure consistency in error handling, logging, and output formatting.
#
# USAGE:
#   Source this file at the beginning of your script:
#   source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
#
# FEATURES:
#   - Consistent color codes for output
#   - Error handling and logging functions
#   - Common validation functions
#   - Progress indicators
#   - Platform detection utilities
#
# =============================================================================

# Color codes for consistent output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export PURPLE='\033[0;35m'
export CYAN='\033[0;36m'
export NC='\033[0m' # No Color

# Logging levels
export LOG_LEVEL="${LOG_LEVEL:-INFO}"
export LOG_DEBUG=0
export LOG_INFO=1
export LOG_WARN=2
export LOG_ERROR=3

# Get current log level
get_log_level() {
    case "$LOG_LEVEL" in
        DEBUG) echo $LOG_DEBUG ;;
        INFO)  echo $LOG_INFO ;;
        WARN)  echo $LOG_WARN ;;
        ERROR) echo $LOG_ERROR ;;
        *)     echo $LOG_INFO ;;
    esac
}

# Logging functions
log_debug() {
    [[ $(get_log_level) -le $LOG_DEBUG ]] && echo -e "${CYAN}[DEBUG]${NC} $*" >&2
}

log_info() {
    [[ $(get_log_level) -le $LOG_INFO ]] && echo -e "${BLUE}[INFO]${NC} $*"
}

log_warn() {
    [[ $(get_log_level) -le $LOG_WARN ]] && echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

log_error() {
    [[ $(get_log_level) -le $LOG_ERROR ]] && echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Success/failure indicators
print_success() {
    echo -e "${GREEN}✅ $*${NC}"
}

print_error() {
    echo -e "${RED}❌ $*${NC}" >&2
}

print_warning() {
    echo -e "${YELLOW}⚠️  $*${NC}" >&2
}

print_info() {
    echo -e "${BLUE}ℹ️  $*${NC}"
}

# Error handling with cleanup
error_exit() {
    local message="${1:-Unknown error}"
    local exit_code="${2:-1}"
    print_error "Error: $message"
    # Call cleanup function if it exists
    if declare -f cleanup >/dev/null; then
        log_debug "Running cleanup function"
        cleanup
    fi
    exit "$exit_code"
}

# Trap handler for errors
setup_error_trap() {
    trap 'error_exit "Script failed at line $LINENO"' ERR
}

# Validate required commands
require_command() {
    local cmd="$1"
    local install_hint="${2:-}"
    
    if ! command -v "$cmd" >/dev/null 2>&1; then
        print_error "Required command not found: $cmd"
        [[ -n "$install_hint" ]] && echo "   Install with: $install_hint"
        exit 1
    fi
}

# Validate required environment variables
require_env_var() {
    local var_name="$1"
    local description="${2:-$var_name}"
    
    if [[ -z "${!var_name:-}" ]]; then
        print_error "Required environment variable not set: $description"
        echo "   Export $var_name=<value>"
        exit 1
    fi
}

# Validate file exists
require_file() {
    local file="$1"
    local description="${2:-$file}"
    
    if [[ ! -f "$file" ]]; then
        print_error "Required file not found: $description"
        echo "   Expected at: $file"
        exit 1
    fi
}

# Validate directory exists
require_dir() {
    local dir="$1"
    local description="${2:-$dir}"
    
    if [[ ! -d "$dir" ]]; then
        print_error "Required directory not found: $description"
        echo "   Expected at: $dir"
        exit 1
    fi
}

# Platform detection
is_macos() {
    [[ "$OSTYPE" == "darwin"* ]]
}

is_linux() {
    [[ "$OSTYPE" == "linux"* ]]
}

# Get platform name
get_platform() {
    if is_macos; then
        echo "macos"
    elif is_linux; then
        echo "linux"
    else
        echo "unknown"
    fi
}

# Progress indicator
show_progress() {
    local message="$1"
    echo -ne "${BLUE}⏳ $message...${NC}\r"
}

end_progress() {
    local message="$1"
    local status="${2:-success}"
    
    # Clear the line
    echo -ne "\033[2K\r"
    
    case "$status" in
        success) print_success "$message" ;;
        error)   print_error "$message" ;;
        warning) print_warning "$message" ;;
        *)       print_info "$message" ;;
    esac
}

# Confirmation prompt
confirm() {
    local prompt="${1:-Are you sure?}"
    local default="${2:-n}"
    
    local yn_prompt="[y/N]"
    [[ "$default" == "y" ]] && yn_prompt="[Y/n]"
    
    read -p "$prompt $yn_prompt " -n 1 -r
    echo
    
    if [[ "$default" == "y" ]]; then
        [[ ! $REPLY =~ ^[Nn]$ ]]
    else
        [[ $REPLY =~ ^[Yy]$ ]]
    fi
}

# Version comparison
version_compare() {
    # Returns 0 if $1 = $2, 1 if $1 > $2, 2 if $1 < $2
    if [[ "$1" == "$2" ]]; then
        return 0
    fi
    
    local IFS=.
    local i ver1=($1) ver2=($2)
    
    # Fill empty fields in ver1 with zeros
    for ((i=${#ver1[@]}; i<${#ver2[@]}; i++)); do
        ver1[i]=0
    done
    
    for ((i=0; i<${#ver1[@]}; i++)); do
        if [[ -z ${ver2[i]} ]]; then
            # Fill empty fields in ver2 with zeros
            ver2[i]=0
        fi
        if ((10#${ver1[i]} > 10#${ver2[i]})); then
            return 1
        fi
        if ((10#${ver1[i]} < 10#${ver2[i]})); then
            return 2
        fi
    done
    return 0
}

# Safe temporary file/directory creation
create_temp_file() {
    local prefix="${1:-vibetunnel}"
    mktemp -t "${prefix}.XXXXXX"
}

create_temp_dir() {
    local prefix="${1:-vibetunnel}"
    mktemp -d -t "${prefix}.XXXXXX"
}

# Cleanup registration
CLEANUP_ITEMS=()

register_cleanup() {
    CLEANUP_ITEMS+=("$1")
}

cleanup() {
    log_debug "Running cleanup for ${#CLEANUP_ITEMS[@]} items"
    for item in "${CLEANUP_ITEMS[@]}"; do
        if [[ -f "$item" ]]; then
            log_debug "Removing file: $item"
            rm -f "$item"
        elif [[ -d "$item" ]]; then
            log_debug "Removing directory: $item"
            rm -rf "$item"
        fi
    done
}

# Set up cleanup trap
trap cleanup EXIT

# Export functions for use in subshells
export -f log_debug log_info log_warn log_error
export -f print_success print_error print_warning print_info
export -f error_exit require_command require_env_var require_file require_dir
export -f is_macos is_linux get_platform
export -f show_progress end_progress confirm
export -f version_compare create_temp_file create_temp_dir
export -f register_cleanup cleanup

# Note: macOS ships with bash 3.2.57 and all scripts are written to be compatible with it