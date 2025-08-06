# Liquid Glass Design Overview

## What is Liquid Glass?

Dynamic material design combining optical glass properties with fluidity:
- **Blurs** content behind it
- **Reflects** color and light from surroundings  
- **Reacts** to touch and pointer interactions
- **Morphs** between shapes during transitions

## Platform Availability

| Platform | Framework | Primary Class/Modifier | Min Version |
|----------|-----------|----------------------|-------------|
| macOS | AppKit | `NSGlassEffectView` | macOS 14.0+ |
| macOS | SwiftUI | `.glassEffect()` | macOS 14.0+ |
| iOS/iPadOS | SwiftUI | `.glassEffect()` | iOS 17.0+ |

## Core Concepts

### Glass Variants
- **Regular**: Standard glass effect
- **Prominent**: Enhanced visibility with tint
- **Interactive**: Responds to user input

### Container Optimization
Containers improve performance and enable effect merging:
- **AppKit**: `NSGlassEffectContainerView`
- **SwiftUI**: `GlassEffectContainer`

### Key Properties
- `cornerRadius` / `shape`: Visual appearance
- `tintColor` / `.tint()`: Color overlay
- `spacing`: Merge distance threshold

## Quick Start

### SwiftUI
```swift
Text("Hello").glassEffect()
Button("Click").buttonStyle(.glass)
```

### AppKit
```swift
let glass = NSGlassEffectView()
glass.cornerRadius = 12.0
glass.contentView = myView
```

## Performance Guidelines
1. Use containers for multiple glass views
2. Limit total glass effects on screen
3. Consider GPU impact on older devices
4. Batch similar effects together

## Next Steps
- [AppKit Implementation](appkit.md)
- [SwiftUI Implementation](swiftui.md)
- [Common Patterns](patterns.md)