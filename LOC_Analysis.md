# Lines of Code (LOC) Analysis

## Project Overview
This repository contains multiple platform-specific projects for VibeTunnel, a cross-platform application. Here's the breakdown of lines of code for each project:

## Individual Project Breakdown

### 1. **Web Project** - 30,793 LOC
- **Language**: TypeScript/JavaScript
- **Location**: `web/src/`
- **Description**: Main web application with comprehensive client-side functionality
- **Largest codebase** in the repository

### 2. **Tauri Project** - 25,468 LOC total
- **Backend (Rust)**: 16,708 LOC
  - Location: `tauri/src-tauri/`
  - Language: Rust
- **Frontend (TypeScript/JavaScript)**: 8,760 LOC
  - Location: `tauri/src/`
  - Language: TypeScript/JavaScript
- **Description**: Cross-platform desktop application using Tauri framework

### 3. **iOS Project** - 24,082 LOC
- **Language**: Swift
- **Location**: `ios/VibeTunnel/`, `ios/VibeTunnelTests/`, `ios/Sources/`
- **Description**: Native iOS application with comprehensive test coverage

### 4. **Mac Project** - 14,591 LOC
- **Language**: Swift
- **Location**: `mac/VibeTunnel/`, `mac/VibeTunnelTests/`
- **Description**: Native macOS application

### 5. **Scripts & Utilities** - 250 LOC
- **Languages**: Shell scripts
- **Locations**: `scripts/`, root directory scripts
- **Description**: Build scripts, test automation, and utilities

### 6. **Apple Shared** - 0 LOC
- **Location**: `apple/`
- **Description**: Configuration files only, no source code

## Summary Statistics

| Project | Lines of Code | Primary Language | Platform |
|---------|---------------|------------------|----------|
| Web | 30,793 | TypeScript/JavaScript | Web |
| Tauri (Total) | 25,468 | Rust + TypeScript | Cross-platform Desktop |
| └─ Tauri Backend | 16,708 | Rust | Backend |
| └─ Tauri Frontend | 8,760 | TypeScript/JavaScript | Frontend |
| iOS | 24,082 | Swift | iOS |
| Mac | 14,591 | Swift | macOS |
| Scripts | 250 | Shell | Build/Utilities |

## Total Repository LOC: **95,184 lines**

## Key Insights

1. **Web project is the largest** single codebase with over 30K lines
2. **Tauri project** represents a significant investment in cross-platform desktop development
3. **Strong mobile presence** with substantial iOS codebase
4. **Multi-platform strategy** evident from separate Mac and iOS implementations
5. **Well-maintained** with comprehensive test coverage across projects
6. **Modern tech stack** using TypeScript, Swift, and Rust across different platforms

## Language Distribution
- **TypeScript/JavaScript**: 40,313 lines (42.3%)
- **Swift**: 38,673 lines (40.6%) 
- **Rust**: 16,708 lines (17.5%)
- **Shell Scripts**: 250 lines (0.3%)

This analysis shows a substantial codebase with strong cross-platform coverage and modern language choices.