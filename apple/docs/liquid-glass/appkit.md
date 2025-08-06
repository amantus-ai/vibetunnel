# Liquid Glass in AppKit

## Quick Reference

| Class | Purpose | Key Properties |
|-------|---------|---------------|
| `NSGlassEffectView` | Single glass effect | `contentView`, `cornerRadius`, `tintColor` |
| `NSGlassEffectContainerView` | Multiple glass effects | `contentView`, `spacing` |

## NSGlassEffectView

### Basic Usage
```swift
let glassView = NSGlassEffectView(frame: NSRect(x: 0, y: 0, width: 200, height: 100))
glassView.cornerRadius = 16.0
glassView.tintColor = NSColor.systemBlue.withAlphaComponent(0.3)
glassView.contentView = myContentView
```

### Interactive Glass
```swift
class InteractiveGlass: NSGlassEffectView {
    override func mouseEntered(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            animator().tintColor = NSColor.accent.withAlphaComponent(0.2)
        }
    }
    
    override func mouseExited(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup { _ in
            animator().tintColor = nil
        }
    }
}
```

## NSGlassEffectContainerView

### Container Setup
```swift
let container = NSGlassEffectContainerView()
container.spacing = 40.0  // Merge distance

let contentView = NSView()
container.contentView = contentView

// Add multiple glass views to contentView
[glass1, glass2, glass3].forEach { contentView.addSubview($0) }
```

### Animated Merging
```swift
NSAnimationContext.runAnimationGroup { context in
    context.duration = 0.5
    // Move glass views closer to trigger merge
    glass2.animator().frame.origin.x -= 50
}
```

## Custom Components

### Glass Button
```swift
class GlassButton: NSButton {
    private let glass = NSGlassEffectView()
    
    override init(frame: NSRect) {
        super.init(frame: frame)
        setup()
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }
    
    private func setup() {
        bezelStyle = .rounded
        isBordered = false
        glass.autoresizingMask = [.width, .height]
        glass.cornerRadius = 8.0
        addSubview(glass, positioned: .below, relativeTo: nil)
    }
}
```

### Glass Toolbar
```swift
// Add glass to toolbar area
let toolbar = NSToolbar(identifier: "main")
let glassView = NSGlassEffectView()
glassView.frame = NSRect(x: 0, y: view.bounds.height - 50, 
                         width: view.bounds.width, height: 50)
glassView.autoresizingMask = [.width, .minYMargin]
view.addSubview(glassView)
```

## Best Practices

### Z-Order
- Only `contentView` guaranteed inside effect
- Arbitrary subviews may render incorrectly

### Performance
- Batch in containers when possible
- Limit total glass views (5-10 max)
- Disable when scrolling for performance

### Animation
- Use `NSAnimationContext` for smooth transitions
- Standard duration: 0.2-0.5 seconds
- Animate `tintColor` for state changes

## Common Issues

| Issue | Solution |
|-------|----------|
| Glass not visible | Check view hierarchy, ensure added to window |
| Performance lag | Use containers, reduce glass count |
| Merge not working | Check container spacing value |
| Content outside glass | Use contentView property exclusively |

## See Also
- [Overview](overview.md)
- [SwiftUI Implementation](swiftui.md)
- [Common Patterns](patterns.md)
- [Apple Docs: NSGlassEffectView](https://developer.apple.com/documentation/AppKit/NSGlassEffectView)