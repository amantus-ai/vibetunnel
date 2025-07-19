# VibeTunnel Documentation Index

This index provides a comprehensive overview of all documentation in the VibeTunnel project, organized by category and purpose.

## 📚 Main Documentation

### Getting Started
- [**README.md**](../README.md) - Project overview, quick start guide, and basic usage
- [**introduction.mdx**](introduction.mdx) - Mintlify documentation landing page
- [**docs.json**](../docs.json) - Mintlify documentation configuration

### Architecture & Design
- [**ARCHITECTURE.md**](ARCHITECTURE.md) - System architecture, component relationships, data flow
- [**architecture-mario.md**](architecture-mario.md) - Alternative architecture documentation
- [**spec.md**](spec.md) - Core technical specifications and protocols
- [**ios-spec.md**](ios-spec.md) - iOS companion app specification

### Development Guides
- [**CONTRIBUTING.md**](CONTRIBUTING.md) - Contributing guidelines and development workflow
- [**development.md**](development.md) - Development setup, code style, patterns
- [**build-system.md**](build-system.md) - Build system overview and usage
- [**deployment.md**](deployment.md) - Deployment and distribution guide
- [**RELEASE.md**](RELEASE.md) - Comprehensive release process documentation

### Feature Documentation
- [**authentication.md**](authentication.md) - Authentication system and security
- [**push-notification.md**](push-notification.md) - Push notification implementation
- [**security.md**](security.md) - Security configuration and best practices
- [**keyboard-shortcuts.md**](keyboard-shortcuts.md) - Keyboard shortcut reference

### Testing
- [**testing.md**](testing.md) - Testing strategy and test suite documentation
- [**TESTING_EXTERNAL_DEVICES.md**](TESTING_EXTERNAL_DEVICES.md) - Testing on external devices (iPad, etc.)

### Tools & Utilities
- [**claude.md**](claude.md) - Claude CLI usage guide
- [**gemini.md**](gemini.md) - Gemini CLI for large codebase analysis
- [**custom-node.md**](custom-node.md) - Custom Node.js build documentation

### Reference
- [**project-overview.md**](project-overview.md) - High-level project overview
- [**files.md**](files.md) - File catalog and organization
- [**logging-style-guide.md**](logging-style-guide.md) - Logging conventions and style guide
- [**CHANGELOG.md**](../CHANGELOG.md) - Project changelog

## 🍎 Platform-Specific Documentation

### macOS (`mac/`)
- [**mac/README.md**](../mac/README.md) - macOS app overview and quick start
- [**mac/docs/code-signing.md**](../mac/docs/code-signing.md) - Comprehensive code signing guide
- [**mac/docs/BuildArchitectures.md**](../mac/docs/BuildArchitectures.md) - Build architecture details
- [**mac/docs/BuildRequirements.md**](../mac/docs/BuildRequirements.md) - Build requirements
- [**mac/docs/sparkle-keys.md**](../mac/docs/sparkle-keys.md) - Sparkle update framework keys
- [**mac/docs/sparkle-stats-store.md**](../mac/docs/sparkle-stats-store.md) - Update statistics

### iOS (`ios/`)
- [**ios/README.md**](../ios/README.md) - iOS app overview
- [**ios/CLAUDE.md**](../ios/CLAUDE.md) - iOS development guidelines for Claude

### Web (`web/`)
- [**web/README.md**](../web/README.md) - Web server and frontend overview
- [**web/docs/spec.md**](../web/docs/spec.md) - Web server implementation specification
- [**web/docs/performance.md**](../web/docs/performance.md) - Performance optimization guide
- [**web/docs/playwright-testing.md**](../web/docs/playwright-testing.md) - Playwright E2E testing
- [**web/docs/socket-protocol.md**](../web/docs/socket-protocol.md) - WebSocket protocol documentation
- [**web/docs/terminal-titles.md**](../web/docs/terminal-titles.md) - Terminal title management
- [**web/docs/VT_INSTALLATION.md**](../web/docs/VT_INSTALLATION.md) - VT command installation
- [**web/docs/npm.md**](../web/docs/npm.md) - NPM package documentation

### Apple Shared (`apple/`)
- [**apple/docs/modern-swift.md**](../apple/docs/modern-swift.md) - Modern Swift patterns
- [**apple/docs/swift-concurrency.md**](../apple/docs/swift-concurrency.md) - Swift concurrency guide
- [**apple/docs/swift-testing-playbook.md**](../apple/docs/swift-testing-playbook.md) - Swift testing best practices
- [**apple/docs/swiftui.md**](../apple/docs/swiftui.md) - SwiftUI guidelines
- [**apple/docs/logging-private-fix.md**](../apple/docs/logging-private-fix.md) - Logging configuration

## 🤖 AI Assistant Guidelines

### CLAUDE.md Files
These files provide specific instructions for Claude AI when working with different parts of the codebase:

- [**CLAUDE.md**](../CLAUDE.md) - Main project guidelines for Claude
- [**web/CLAUDE.md**](../web/CLAUDE.md) - Web development specific instructions
- [**mac/CLAUDE.md**](../mac/CLAUDE.md) - macOS development guidelines
- [**ios/CLAUDE.md**](../ios/CLAUDE.md) - iOS development guidelines

### GEMINI.md
- [**GEMINI.md**](../GEMINI.md) - Instructions for Gemini AI assistant

## 📋 Documentation Standards

When adding new documentation:

1. **Location**: Place documentation in the most relevant directory
   - General docs in `/docs`
   - Platform-specific docs in their respective directories
   - Keep related documentation together

2. **Naming**: Use clear, descriptive names
   - UPPERCASE.md for important documents (README, CHANGELOG, etc.)
   - lowercase-with-hyphens.md for regular documentation
   - Include platform prefix when needed (ios-spec.md)

3. **Content**: Follow consistent structure
   - Start with a clear title and overview
   - Include practical examples
   - Add cross-references to related docs
   - Keep content up-to-date with code changes

4. **Maintenance**: Regular reviews
   - Remove outdated documentation
   - Update when features change
   - Consolidate duplicate content
   - Maintain this index when adding/removing docs