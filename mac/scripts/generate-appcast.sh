#!/bin/bash
#
# Generate appcast XML files with correct file sizes from GitHub releases
#
# This script fetches release information from GitHub and generates
# appcast.xml and appcast-prerelease.xml with accurate file sizes
# to prevent Sparkle download errors.

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Add Sparkle tools to PATH
export PATH="$HOME/.local/bin:$PATH"

# Load GitHub configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../.github-config"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

# Configuration
# Try to extract from git remote if not set
if [[ -z "${GITHUB_USERNAME:-}" ]] || [[ -z "${GITHUB_REPO:-}" ]]; then
    GIT_REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ "$GIT_REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/]+?)(\.git)?$ ]]; then
        GITHUB_USERNAME="${GITHUB_USERNAME:-${BASH_REMATCH[1]}}"
        GITHUB_REPO="${GITHUB_REPO:-${BASH_REMATCH[2]%.git}}"
    else
        GITHUB_USERNAME="${GITHUB_USERNAME:-amantus-ai}"
        GITHUB_REPO="${GITHUB_REPO:-vibetunnel}"
    fi
fi

# Set the Sparkle account if provided via environment
SPARKLE_ACCOUNT="${SPARKLE_ACCOUNT:-}"

GITHUB_REPO_FULL="${GITHUB_USERNAME}/${GITHUB_REPO}"
# Use the clean key file without comments for sign_update
SPARKLE_PRIVATE_KEY_PATH="${SPARKLE_PRIVATE_KEY_PATH:-private/sparkle_ed_private_key}"
# Try fallback locations if primary doesn't exist
if [[ ! -f "$SPARKLE_PRIVATE_KEY_PATH" ]]; then
    if [[ -f "private/sparkle_private_key" ]]; then
        # Extract just the key from the commented file
        KEY_LINE=$(grep -E '^[A-Za-z0-9+/]+=*$' "private/sparkle_private_key" | head -1)
        if [ -n "$KEY_LINE" ]; then
            echo "$KEY_LINE" > "private/sparkle_ed_private_key"
            SPARKLE_PRIVATE_KEY_PATH="private/sparkle_ed_private_key"
        else
            SPARKLE_PRIVATE_KEY_PATH="private/sparkle_private_key"
        fi
    elif [[ -f "sparkle-private-ed-key.pem" ]]; then
        SPARKLE_PRIVATE_KEY_PATH="sparkle-private-ed-key.pem"
    fi
fi

# Verify private key exists
if [ ! -f "$SPARKLE_PRIVATE_KEY_PATH" ]; then
    echo -e "${RED}❌ Error: Sparkle private key not found at $SPARKLE_PRIVATE_KEY_PATH${NC}"
    echo "This file is required to sign updates for Sparkle."
    echo "Please ensure the private key is available before running this script."
    exit 1
fi

# CRITICAL: Verify we're using the correct private key
print_warning "⚠️  IMPORTANT: This script uses the file-based private key at: $SPARKLE_PRIVATE_KEY_PATH"
print_warning "⚠️  DO NOT use sign_update without the -f flag!"
print_warning "⚠️  The keychain may contain a different key that produces incompatible signatures!"
echo -e "${YELLOW}[WARNING]${NC} Expected public key in Info.plist: AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=" >&2

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Function to get file size from URL
get_file_size() {
    local url=$1
    curl -sI "$url" | grep -i content-length | awk '{print $2}' | tr -d '\r'
}

# Function to check if we have a cached signature
get_cached_signature() {
    local filename=$1
    local cache_file="$temp_dir/signatures_cache.txt"
    
    # Check if cache file exists and has the signature
    if [ -f "$cache_file" ]; then
        grep "^$filename:" "$cache_file" | cut -d: -f2 || echo ""
    else
        echo ""
    fi
}

# Function to cache a signature
cache_signature() {
    local filename=$1
    local signature=$2
    local cache_file="$temp_dir/signatures_cache.txt"
    
    if [ -n "$signature" ] && [ "$signature" != "" ]; then
        echo "$filename:$signature" >> "$cache_file"
    fi
}

# Function to generate EdDSA signature
generate_signature() {
    local file_path=$1
    local filename=$(basename "$file_path")
    
    # Check if we have a cached signature first
    local cached_sig=$(get_cached_signature "$filename")
    if [ -n "$cached_sig" ]; then
        echo "$cached_sig"
        return 0
    fi
    
    # Find sign_update binary
    local sign_update_bin=""
    if command -v sign_update >/dev/null 2>&1; then
        sign_update_bin="sign_update"
    elif [ -f ".build/artifacts/sparkle/Sparkle/bin/sign_update" ]; then
        sign_update_bin=".build/artifacts/sparkle/Sparkle/bin/sign_update"
    elif [ -f "build/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update" ]; then
        sign_update_bin="build/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update"
    else
        echo -e "${RED}❌ Error: Could not find sign_update binary${NC}" >&2
        echo "Please ensure Sparkle is built or sign_update is in PATH" >&2
        exit 1
    fi
    
    # CRITICAL: Always use the -f flag with the private key file
    # DO NOT remove the -f flag or this will use the wrong key from keychain!
    local sign_cmd="$sign_update_bin \"$file_path\" -f \"$SPARKLE_PRIVATE_KEY_PATH\" -p"
    if [ -n "$SPARKLE_ACCOUNT" ]; then
        sign_cmd="$sign_cmd --account \"$SPARKLE_ACCOUNT\""
        echo "Using Sparkle account: $SPARKLE_ACCOUNT" >&2
    fi
    
    print_info "Signing with command: sign_update [file] -f $SPARKLE_PRIVATE_KEY_PATH -p"
    
    local signature=$(eval $sign_cmd 2>/dev/null)
    if [ -n "$signature" ] && [ "$signature" != "-----END PRIVATE KEY-----" ]; then
        echo "$signature"
        return 0
    fi
    
    echo -e "${RED}❌ Error: Failed to generate signature for $filename${NC}" >&2
    echo "Please ensure the private key at $SPARKLE_PRIVATE_KEY_PATH is valid" >&2
    if [ -n "$SPARKLE_ACCOUNT" ]; then
        echo "Also check that the account '$SPARKLE_ACCOUNT' is correct" >&2
    else
        echo "You may need to specify SPARKLE_ACCOUNT environment variable" >&2
    fi
    exit 1
}

# Function to format date for appcast
format_date() {
    local date_str=$1
    # Convert GitHub date format to RFC 822 format for RSS
    date -j -f "%Y-%m-%dT%H:%M:%SZ" "$date_str" "+%a, %d %b %Y %H:%M:%S %z" 2>/dev/null || \
    date -d "$date_str" "+%a, %d %b %Y %H:%M:%S %z" 2>/dev/null || \
    echo "Wed, 04 Jun 2025 12:00:00 +0000"
}

# Function to extract version and build number from release tag
parse_version() {
    local tag=$1
    local version=""
    local build=""
    
    # Remove 'v' prefix if present
    tag=${tag#v}
    
    # For pre-releases like "0.1-beta.1", extract base version
    if [[ $tag =~ ^([0-9]+\.[0-9]+)(-.*)?$ ]]; then
        version=$tag
    else
        version=$tag
    fi
    
    echo "$version"
}

# Function to create appcast item
create_appcast_item() {
    local release_json=$1
    local dmg_url=$2
    local is_prerelease=$3
    
    # Extract fields with proper fallbacks
    local tag=$(echo "$release_json" | jq -r '.tag_name // "unknown"')
    local title=$(echo "$release_json" | jq -r '.name // .tag_name // "Release"')
    local published_at=$(echo "$release_json" | jq -r '.published_at // ""')
    
    # Validate critical fields
    if [ "$tag" = "unknown" ] || [ "$tag" = "null" ] || [ -z "$tag" ]; then
        print_warning "Invalid tag_name for release, skipping"
        return 1
    fi
    
    local version_string=$(parse_version "$tag")
    
    # Get DMG asset info using base64 encoding for robustness
    local dmg_asset_b64=$(echo "$release_json" | jq -r ".assets[] | select(.browser_download_url == \"$dmg_url\") | {size: .size, name: .name} | @base64" | head -1)
    local dmg_size=""
    
    if [ -n "$dmg_asset_b64" ] && [ "$dmg_asset_b64" != "null" ]; then
        dmg_size=$(echo "$dmg_asset_b64" | base64 --decode | jq -r '.size // null')
    fi
    
    # If size is not in JSON, fetch from HTTP headers
    if [ "$dmg_size" = "null" ] || [ -z "$dmg_size" ]; then
        print_info "Fetching file size for $dmg_url"
        dmg_size=$(get_file_size "$dmg_url")
    fi
    
    # Get signature - either from known signatures or by downloading
    local dmg_filename=$(basename "$dmg_url")
    local signature=""
    
    # Check if we have a cached signature first
    local cached_sig=$(get_cached_signature "$dmg_filename")
    if [ -n "$cached_sig" ]; then
        signature="$cached_sig"
        print_info "Using cached signature for $dmg_filename"
    else
        # We'll download DMG once later for both signature and build number
        signature=""
    fi
    
    # Extract build number from the DMG
    local build_number=""
    local temp_dmg="/tmp/$dmg_filename"
    
    # Download DMG if not already present (for both signature and build number)
    if [ ! -f "$temp_dmg" ]; then
        print_info "Downloading DMG for analysis..."
        curl -sL "$dmg_url" -o "$temp_dmg" 2>/dev/null
    fi
    
    # Generate signature if we haven't already
    if [ -z "$signature" ]; then
        signature=$(generate_signature "$temp_dmg")
        # Cache the signature for future runs
        if [ -n "$signature" ]; then
            cache_signature "$dmg_filename" "$signature"
        fi
    fi
    
    # Extract build number using helper script
    if [ -x "$SCRIPT_DIR/extract-build-number.sh" ]; then
        build_number=$("$SCRIPT_DIR/extract-build-number.sh" "$temp_dmg" 2>/dev/null || echo "")
    elif [ -x "$(dirname "$0")/extract-build-number.sh" ]; then
        build_number=$("$(dirname "$0")/extract-build-number.sh" "$temp_dmg" 2>/dev/null || echo "")
    else
        print_warning "extract-build-number.sh not found - build numbers may be incorrect"
    fi
    
    # Fallback to version-based guessing if extraction fails
    if [ -z "$build_number" ]; then
        print_warning "Could not extract build number from DMG, using fallback"
        case "$version_string" in
            *-beta.1) build_number="100" ;;
            *-beta.2) build_number="101" ;;
            *-beta.3) build_number="102" ;;
            *-beta.4) build_number="103" ;;
            *-rc.1) build_number="110" ;;
            *-rc.2) build_number="111" ;;
            0.1) build_number="100" ;;
            *) build_number="1" ;;
        esac
    fi
    
    # Clean up temp DMG
    rm -f "$temp_dmg"
    
    # Generate description using local changelog
    local description="<h2>$title</h2>"
    if [ "$is_prerelease" = "true" ]; then
        description+="<p><strong>Pre-release version</strong></p>"
    fi
    
    # Try to get changelog from root CHANGELOG.md using changelog-to-html.sh
    local changelog_html=""
    local changelog_script="$SCRIPT_DIR/changelog-to-html.sh"
    
    if [ -x "$changelog_script" ]; then
        # Extract version number from tag (remove 'v' prefix)
        local version_for_changelog="${version_string}"
        
        # Try multiple version formats
        # First try as-is (e.g., "1.0-beta.2")
        # The changelog-to-html.sh script will find CHANGELOG.md automatically
        changelog_html=$("$changelog_script" "$version_for_changelog" 2>/dev/null || echo "")
        
        # If that fails and it's a pre-release, try with .0 added (e.g., "1.0.0-beta.2")
        if [ -z "$changelog_html" ] || [[ "$changelog_html" == *"Latest version of VibeTunnel"* ]]; then
            if [[ "$version_for_changelog" =~ ^([0-9]+\.[0-9]+)(-.*)?$ ]]; then
                local expanded_version="${BASH_REMATCH[1]}.0${BASH_REMATCH[2]}"
                local temp_html=$("$changelog_script" "$expanded_version" 2>/dev/null || echo "")
                if [ -n "$temp_html" ] && [[ "$temp_html" != *"Latest version of VibeTunnel"* ]]; then
                    changelog_html="$temp_html"
                fi
            fi
        fi
        
        # If that fails, try with the base version for pre-releases
        if [ -z "$changelog_html" ] || [[ "$changelog_html" == *"Latest version of VibeTunnel"* ]]; then
            if [[ "$version_for_changelog" =~ ^([0-9]+\.[0-9]+\.[0-9]+) ]]; then
                local base_version="${BASH_REMATCH[1]}"
                changelog_html=$("$changelog_script" "$base_version" 2>/dev/null || echo "")
            fi
        fi
    fi
    
    # Always use local changelog - it's the source of truth
    if [ -n "$changelog_html" ] && [[ "$changelog_html" != *"Latest version of VibeTunnel"* ]]; then
        description+="<div>$changelog_html</div>"
    else
        # Version not found in CHANGELOG.md
        print_warning "Version $version_for_changelog not found in CHANGELOG.md"
        description+="<div><p>⚠️ Release notes not found in CHANGELOG.md for version $version_for_changelog</p>"
        description+="<p>Please update CHANGELOG.md with release notes for this version.</p></div>"
    fi
    
    # Generate the item XML
    cat << EOF
        <item>
            <title>$title</title>
            <link>$dmg_url</link>
            <sparkle:version>$build_number</sparkle:version>
            <sparkle:shortVersionString>$version_string</sparkle:shortVersionString>
            <description><![CDATA[
                $description
            ]]></description>
            <pubDate>$(format_date "$published_at")</pubDate>
            <enclosure 
                url="$dmg_url"
                length="$dmg_size"
                type="application/octet-stream"
                sparkle:edSignature="$signature"
            />
            <sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>
        </item>
EOF
}

# Main function
main() {
    print_info "Generating appcast files for $GITHUB_REPO_FULL"
    
    # Check if we need to detect the Sparkle account
    if [ -z "$SPARKLE_ACCOUNT" ] && command -v security >/dev/null 2>&1; then
        print_info "Attempting to detect Sparkle account from Keychain..."
        # Try to find EdDSA keys in the Keychain
        DETECTED_ACCOUNT=$(security find-generic-password -s "https://sparkle-project.org" 2>/dev/null | grep "acct" | sed 's/.*acct"<blob>="\(.*\)"/\1/' || echo "")
        if [ -n "$DETECTED_ACCOUNT" ]; then
            SPARKLE_ACCOUNT="$DETECTED_ACCOUNT"
            print_info "Detected Sparkle account: $SPARKLE_ACCOUNT"
        else
            print_warning "Could not detect Sparkle account. Using default signing."
        fi
    fi
    
    # Create temporary directory
    local temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT
    
    # Fetch all releases from GitHub with error handling
    print_info "Fetching releases from GitHub repository: $GITHUB_REPO_FULL"
    local releases
    local gh_error
    if ! releases=$(gh api "repos/$GITHUB_REPO_FULL/releases" --paginate 2>&1); then
        gh_error=$?
        print_error "Failed to fetch releases from GitHub (exit code: $gh_error)"
        print_error "Repository: $GITHUB_REPO_FULL"
        print_error "Error output: $releases"
        print_info "Checking GitHub CLI status..."
        gh auth status 2>&1 | while IFS= read -r line; do
            print_info "  $line"
        done
        exit 1
    fi
    
    if [ -z "$releases" ] || [ "$releases" = "[]" ]; then
        print_warning "No releases found for repository $GITHUB_REPO_FULL"
        exit 0
    fi
    
    # Separate stable and pre-releases
    local stable_releases=$(echo "$releases" | jq -c '.[] | select(.prerelease == false)')
    local pre_releases=$(echo "$releases" | jq -c '.[] | select(.prerelease == true)')
    
    # Generate stable appcast
    print_info "Generating appcast.xml..."
    cat > appcast.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
        <title>VibeTunnel Updates</title>
        <link>https://github.com/amantus-ai/vibetunnel</link>
        <description>VibeTunnel automatic updates feed</description>
        <language>en</language>
EOF
    
    # Add stable releases to appcast
    while IFS= read -r release; do
        [ -z "$release" ] && continue
        
        local tag_name=$(echo "$release" | jq -r '.tag_name')
        
        # Find the DMG asset (there should be only one universal DMG)
        local dmg_assets_b64=$(echo "$release" | jq -r '.assets[] | select(.name | endswith(".dmg")) | {url: .browser_download_url, name: .name} | @base64')
        
        if [ -n "$dmg_assets_b64" ] && [ "$dmg_assets_b64" != "null" ]; then
            local first_dmg_b64=$(echo "$dmg_assets_b64" | head -1)
            local dmg_url=$(echo "$first_dmg_b64" | base64 --decode | jq -r '.url')
            local dmg_name=$(echo "$first_dmg_b64" | base64 --decode | jq -r '.name')
            
            print_info "Using DMG: $dmg_name for $tag_name"
            
            if [ -n "$dmg_url" ] && [ "$dmg_url" != "null" ]; then
                if create_appcast_item "$release" "$dmg_url" "false" >> appcast.xml; then
                    print_info "Added stable release: $tag_name"
                else
                    print_warning "Failed to create item for stable release: $tag_name"
                fi
            fi
        else
            print_warning "No DMG asset found for stable release: $tag_name"
        fi
    done <<< "$stable_releases"
    
    echo "    </channel>" >> appcast.xml
    echo "</rss>" >> appcast.xml
    
    # Generate pre-release appcast
    print_info "Generating appcast-prerelease.xml..."
    cat > appcast-prerelease.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
        <title>VibeTunnel Pre-release Updates</title>
        <link>https://github.com/amantus-ai/vibetunnel</link>
        <description>VibeTunnel pre-release and beta updates feed</description>
        <language>en</language>
EOF
    
    # Add pre-releases to appcast
    while IFS= read -r release; do
        [ -z "$release" ] && continue
        
        local tag_name=$(echo "$release" | jq -r '.tag_name')
        
        # Find the DMG asset (there should be only one universal DMG)
        local dmg_assets_b64=$(echo "$release" | jq -r '.assets[] | select(.name | endswith(".dmg")) | {url: .browser_download_url, name: .name} | @base64')
        
        if [ -n "$dmg_assets_b64" ] && [ "$dmg_assets_b64" != "null" ]; then
            local first_dmg_b64=$(echo "$dmg_assets_b64" | head -1)
            local dmg_url=$(echo "$first_dmg_b64" | base64 --decode | jq -r '.url')
            local dmg_name=$(echo "$first_dmg_b64" | base64 --decode | jq -r '.name')
            
            print_info "Using DMG: $dmg_name for $tag_name (pre-release)"
            
            if [ -n "$dmg_url" ] && [ "$dmg_url" != "null" ]; then
                if create_appcast_item "$release" "$dmg_url" "true" >> appcast-prerelease.xml; then
                    print_info "Added pre-release: $tag_name"
                else
                    print_warning "Failed to create item for pre-release: $tag_name"
                fi
            fi
        else
            print_warning "No DMG asset found for pre-release: $tag_name"
        fi
    done <<< "$pre_releases"
    
    # Also add stable releases to pre-release feed
    while IFS= read -r release; do
        [ -z "$release" ] && continue
        
        local tag_name=$(echo "$release" | jq -r '.tag_name')
        
        # Find the DMG asset (there should be only one universal DMG)
        local dmg_assets_b64=$(echo "$release" | jq -r '.assets[] | select(.name | endswith(".dmg")) | {url: .browser_download_url, name: .name} | @base64')
        
        if [ -n "$dmg_assets_b64" ] && [ "$dmg_assets_b64" != "null" ]; then
            local first_dmg_b64=$(echo "$dmg_assets_b64" | head -1)
            local dmg_url=$(echo "$first_dmg_b64" | base64 --decode | jq -r '.url')
            local dmg_name=$(echo "$first_dmg_b64" | base64 --decode | jq -r '.name')
            
            print_info "Using DMG: $dmg_name for $tag_name (stable in pre-release feed)"
            
            if [ -n "$dmg_url" ] && [ "$dmg_url" != "null" ]; then
                if create_appcast_item "$release" "$dmg_url" "false" >> appcast-prerelease.xml; then
                    print_info "Added stable release to pre-release feed: $tag_name"
                else
                    print_warning "Failed to create item for stable release in pre-release feed: $tag_name"
                fi
            fi
        else
            print_warning "No DMG asset found for stable release in pre-release feed: $tag_name"
        fi
    done <<< "$stable_releases"
    
    echo "    </channel>" >> appcast-prerelease.xml
    echo "</rss>" >> appcast-prerelease.xml
    
    print_info "✅ Appcast files generated successfully!"
    print_info "  - appcast.xml (stable releases only)"
    print_info "  - appcast-prerelease.xml (all releases)"
    
    # Validate the generated files
    if command -v xmllint >/dev/null 2>&1; then
        print_info "Validating XML..."
        xmllint --noout appcast.xml && print_info "  ✓ appcast.xml is valid"
        xmllint --noout appcast-prerelease.xml && print_info "  ✓ appcast-prerelease.xml is valid"
    fi
}

# Run main function
main "$@"