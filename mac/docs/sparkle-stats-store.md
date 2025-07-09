# Sparkle Updates with Stats.store Integration

This document provides comprehensive documentation for VibeTunnel's automatic update system using Sparkle framework and Stats.store.

## Overview

VibeTunnel uses a sophisticated update system that combines:
- **Sparkle Framework** - Industry-standard macOS update framework for automatic updates
- **Stats.store** - Privacy-first analytics backend that proxies appcast requests
- **GitHub Releases** - Hosts the actual DMG files and appcast XML files

## System Architecture

### Update Check Flow

```
VibeTunnel App → Stats.store (Proxy) → GitHub (appcast.xml) → Stats.store → VibeTunnel App
                                                                    ↓
                                                             GitHub (DMG download)
```

1. **App initiates update check**: VibeTunnel queries Stats.store endpoint
2. **Stats.store logs analytics**: Records anonymous data (OS version, CPU type, daily unique users)
3. **Stats.store proxies request**: Fetches appcast.xml from GitHub
4. **Appcast returned**: Stats.store returns the appcast to the app
5. **Signature verification**: Sparkle verifies the EdDSA signature
6. **Direct download**: If valid, app downloads DMG directly from GitHub (not through Stats.store)

### Update Endpoints

- **Stable channel**: `https://stats.store/api/v1/appcast/appcast.xml`
- **Pre-release channel**: `https://stats.store/api/v1/appcast/appcast-prerelease.xml`

These endpoints proxy to the actual appcast files hosted on GitHub.

## Configuration Details

### App Configuration (Info.plist)

```xml
<!-- Sparkle Public Key for signature verification -->
<key>SUPublicEDKey</key>
<string>AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=</string>

<!-- Update feed URL (configured in UpdateChannel.swift) -->
<key>SUFeedURL</key>
<string>https://stats.store/api/v1/appcast/appcast-prerelease.xml</string>
```

### HTTP Requirements

Stats.store requires proper app identification via User-Agent header:

```
User-Agent: VibeTunnel/1.0.0-beta.8 Sparkle/2.7.1
```

Without this header, Stats.store returns:
```json
{"error":"Application not found"}
```

## Key Management and Signatures

### Public Key
- **Location**: Info.plist (`SUPublicEDKey`)
- **Value**: `AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=`
- **Purpose**: Verifies EdDSA signatures of updates

### Private Key
- **Location**: `private/sparkle_private_key`
- **Purpose**: Signs DMG files for appcast entries
- **Critical**: Must match the public key in Info.plist

### Signature Generation

To generate a signature for a DMG file:

```bash
# ALWAYS use the -f flag with the correct private key file
sign_update -f /path/to/private/sparkle_private_key /path/to/VibeTunnel-1.0.0-beta.8.dmg

# Output format:
# sparkle:edSignature="..." length="44748347"
```

**⚠️ Important**: Never use `sign_update` without the `-f` flag as it may use a different key from the keychain.

## Appcast XML Format

### Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
    <channel>
        <title>VibeTunnel</title>
        <item>
            <title>VibeTunnel 1.0.0-beta.8</title>
            <sparkle:version>172</sparkle:version>
            <sparkle:shortVersionString>1.0.0-beta.8</sparkle:shortVersionString>
            <description><![CDATA[
                <h2>Release Notes</h2>
                <!-- HTML formatted release notes -->
            ]]></description>
            <pubDate>Tue, 08 Jul 2025 10:18:00 +0100</pubDate>
            <enclosure url="https://github.com/amantus-ai/vibetunnel/releases/download/v1.0.0-beta.8/VibeTunnel-1.0.0-beta.8.dmg" 
                       sparkle:version="172" 
                       sparkle:shortVersionString="1.0.0-beta.8" 
                       length="44748347" 
                       type="application/x-apple-diskimage" 
                       sparkle:edSignature="/538z6L/qhhnHkfWU1hVoqeKvFdHubFRobfq6Vfmwz4UCpDVhJrqG+W28xW1wU4W9+xt41NMgei+DLJr1JV8Cg=="/>
        </item>
    </channel>
</rss>
```

### Critical Fields

- **sparkle:version**: Build number (must be incrementing)
- **sparkle:shortVersionString**: Human-readable version
- **length**: Exact file size in bytes
- **sparkle:edSignature**: EdDSA signature of the DMG file
- **url**: Direct download link to GitHub release

## Testing and Verification

### Manual Testing

```bash
# Test Stats.store endpoint (will fail without User-Agent)
curl https://stats.store/api/v1/appcast/appcast-prerelease.xml

# Test with proper User-Agent (should return XML)
curl -H "User-Agent: VibeTunnel/1.0.0-beta.8 Sparkle/2.7.1" \
     https://stats.store/api/v1/appcast/appcast-prerelease.xml

# Verify a specific signature
sign_update -f private/sparkle_private_key ~/Downloads/VibeTunnel-1.0.0-beta.8.dmg
```

### Stats.store Caching

⚠️ **Important**: Stats.store has a **1-minute cache** for appcast files. After updating the appcast on GitHub:
- Wait at least 1 minute before testing
- The old version may be served during this cache period
- Force-refresh won't bypass this server-side cache

## Current Release Signatures

Complete signature reference for all VibeTunnel beta releases:

| Version | Build | File Size | Signature |
|---------|-------|-----------|-----------|
| 1.0.0-beta.1 | 121 | 39,418,009 | `lm3eCKxuykGYj1oRG3uRm3QB+3azo7EGGeuP2SzZHsobnKGBxq48H21rN9WDi2mry8NbGM9YwjdjfzS56h7GDA==` |
| 1.0.0-beta.2 | 133 | 40,511,292 | `VcPuSbUbcqhwrqongx9+mLhVAuHWlCw+xzIvsvqYKEv6W8UWtUPlPkYCgvoLuNRrJMnEOFcX/eJJv5RQl9/qAQ==` |
| 1.0.0-beta.3 | 140 | 43,073,375 | `kY87vo1HXpFx6aKb9LDXbe/AmQND5iH+W7a3qpf2AejmEl+i7wKch/JY3zhBHrmWIuksiKOwFIIklT4sQFMjDw==` |
| 1.0.0-beta.4 | 151 | 43,169,474 | `QXjzgcZXuF4zAy1AeYXAS2+WXLYWmMQYcm46isVO3WRp3I3IPHrXLOmWlVFixsFMM3JCKRmOnYsftEAyWjGbAA==` |
| 1.0.0-beta.5 | 157 | 43,227,774 | `wAhA+mtSpcXd4f62yyF4bzSt/IG9ynPPVIRmIwcMCBgCZh0mavixiEPUHxYMGlukVuC+TXLJfqXowiCwMH8tBQ==` |
| 1.0.0-beta.6 | 159 | 43,312,816 | `g84r8XLzvfeVHccjULfpjRGClf9Wll14PVLXCktUBkc+TRA312troC8dw1+bEn/ta5itW7nErwOCCIGD8U21DA==` |
| 1.0.0-beta.7 | 165 | 43,383,612 | `vdcImChUp1qKY3V/8CTnyxq0TXkQjPXnEbEvks0xwWbzqvSP1xe3MBr/5kalilFpC9dH7wMxO9ohoNhHTjOvBQ==` |
| 1.0.0-beta.8 | 172 | 44,748,347 | `/538z6L/qhhnHkfWU1hVoqeKvFdHubFRobfq6Vfmwz4UCpDVhJrqG+W28xW1wU4W9+xt41NMgei+DLJr1JV8Cg==` |

All signatures above are generated with the correct file-based private key and verified to work with the public key in Info.plist.

## Benefits of Stats.store

1. **Privacy-First Analytics**: 
   - Track update adoption rates without collecting personal data
   - Monitor OS version distribution and hardware stats
   - Daily unique users via salted IP hashes (change daily)
   - No IP tracking, device IDs, or fingerprinting

2. **Anonymous Data Collection**:
   - macOS version and CPU architecture
   - App version numbers
   - Hardware info (RAM, Mac model, core count)
   - System language (no location data)

3. **Technical Benefits**:
   - Transparent proxy (doesn't host files)
   - 1-minute appcast caching
   - GitHub outage protection
   - Free for open source projects

4. **Future Features** (Planned):
   - A/B testing for gradual rollouts
   - Custom update channels
   - Geographic CDN capabilities

## Troubleshooting Guide

### Common Issues

#### "Application not found" Error
- **Cause**: Missing or incorrect User-Agent header
- **Fix**: Ensure Sparkle is configured correctly in the app

#### Signature Verification Failed
- **Cause**: Wrong private key used for signing
- **Fix**: Use `sign_update -f private/sparkle_private_key`

#### Updates Not Detected
- **Cause**: Stats.store cache or incorrect version numbers
- **Fix**: Wait 1 minute after updating appcast, verify version increments

#### File Size Mismatch
- **Cause**: DMG was modified after signing
- **Fix**: Re-download and re-sign the DMG

### Debugging Commands

```bash
# Check current appcast
curl -H "User-Agent: VibeTunnel/1.0.0-beta.8 Sparkle/2.7.1" \
     https://stats.store/api/v1/appcast/appcast-prerelease.xml | xmllint --format -

# Verify DMG signature
sign_update -f private/sparkle_private_key downloaded.dmg

# Compare with appcast signature
grep "sparkle:edSignature" appcast-prerelease.xml
```

## The Beta 8 Update Incident (July 2025)

### Timeline of Events

1. **Initial Success**: Updates from beta 1 through beta 7 worked correctly
2. **Problem Detected**: Users updating from beta 7 to beta 8 received error:
   > "The update is improperly signed and could not be validated"
3. **Investigation**: Discovered multiple Sparkle private keys on the system
4. **Root Cause**: Wrong private key used to generate appcast signatures
5. **Resolution**: Updated appcast with correct signature

### Technical Details

#### The Problem

Two different Sparkle private keys existed:

1. **File-based key** (`private/sparkle_private_key`)
   - Base64: `SMYPxE98bJ5iLdHTLHTqGKZNFcZLgrT5Hyjh79h3TaU=`
   - Matches public key: `AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=`
   - **This is the correct key**

2. **Keychain key** (accessed without `-f` flag)
   - Different key stored in macOS keychain
   - Produces incompatible signatures
   - **This was incorrectly used**

#### The Investigation

Used `sign_update` to test both keys:
```bash
# Wrong way (uses keychain)
sign_update VibeTunnel-1.0.0-beta.8.dmg
# Result: XcdsjTw01IMbHGVnRVAq1cZ4ii4bY69CE+xqRHO/XXHP+05xzqndwlQ3cv22Ju083zbU2eu8W1J5AoCa75jLBw==

# Correct way (uses file)
sign_update -f private/sparkle_private_key VibeTunnel-1.0.0-beta.8.dmg
# Result: /538z6L/qhhnHkfWU1hVoqeKvFdHubFRobfq6Vfmwz4UCpDVhJrqG+W28xW1wU4W9+xt41NMgei+DLJr1JV8Cg==
```

#### The Mystery

Why did beta 1-7 updates work despite incorrect signatures? Theories:
- DMGs might have been originally signed with the keychain key
- The keychain key might have changed between releases
- There could have been a different issue masking the problem

#### The Solution

1. **Identified** the correct private key file
2. **Generated** the correct signature using `-f` flag
3. **Updated** only the appcast XML (no DMG changes needed)
4. **Waited** for Stats.store cache to expire (1 minute)
5. **Verified** updates now work correctly

### Key Lessons Learned

1. **Always use `-f` flag**: `sign_update -f private/sparkle_private_key`
2. **Document key locations**: Keep clear records of which keys to use
3. **Understand the architecture**: Signatures live in appcast, not DMG files
4. **Remember caching**: Stats.store has a 1-minute cache
5. **Test thoroughly**: Verify signatures match before releasing

### Prevention Measures

- Created this comprehensive documentation
- Added warnings about multiple keys
- Established correct signing procedure
- Documented all historical signatures for reference

The incident was resolved quickly once the root cause was identified, demonstrating the importance of understanding the complete update pipeline from app to Stats.store to GitHub.