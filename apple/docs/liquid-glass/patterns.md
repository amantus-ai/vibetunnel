# Liquid Glass Common Patterns

## Cross-Platform Patterns

### State-Based Glass
**SwiftUI**
```swift
.glassEffect(.regular.tint(isActive ? .blue : .clear))
```

**AppKit**
```swift
glassView.tintColor = isActive ? NSColor.systemBlue.withAlphaComponent(0.3) : nil
```

### Hover Effects
**SwiftUI**
```swift
@State private var isHovered = false
Text("Hover")
    .glassEffect(.regular.tint(isHovered ? .blue : .clear))
    .onHover { isHovered = $0 }
```

**AppKit**
```swift
override func mouseEntered(with: NSEvent) {
    animator().tintColor = NSColor.systemBlue.withAlphaComponent(0.2)
}
```

### Animated Transitions
**SwiftUI**
```swift
.animation(.spring(duration: 0.3), value: glassState)
```

**AppKit**
```swift
NSAnimationContext.runAnimationGroup { context in
    context.duration = 0.3
    // animations
}
```

## UI Component Patterns

### Glass Card
```swift
// SwiftUI
struct GlassCard<Content: View>: View {
    let content: Content
    var body: some View {
        content
            .padding()
            .glassEffect(in: .rect(cornerRadius: 16))
    }
}

// AppKit
class GlassCard: NSView {
    let glass = NSGlassEffectView()
    init(content: NSView) {
        super.init(frame: .zero)
        glass.cornerRadius = 16
        glass.contentView = content
        addSubview(glass)
    }
}
```

### Glass Badge
```swift
// SwiftUI
struct GlassBadge: View {
    let count: Int
    var body: some View {
        Text("\(count)")
            .padding(.horizontal, 8)
            .glassEffect(.regular.tint(.red))
    }
}
```

### Glass Toolbar
```swift
// SwiftUI
.toolbar {
    ToolbarItemGroup {
        Button("One") { }.buttonStyle(.glass)
        Button("Two") { }.buttonStyle(.glass)
    }
}
```

## Layout Patterns

### Grid of Glass Items
```swift
// SwiftUI
GlassEffectContainer(spacing: 20) {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))]) {
        ForEach(items) { item in
            ItemView(item).glassEffect()
        }
    }
}
```

### Merging Glass Groups
```swift
// SwiftUI with union
@Namespace private var ns
ForEach(items.indices) { i in
    ItemView(items[i])
        .glassEffect()
        .glassEffectUnion(id: groupID(for: i), namespace: ns)
}
```

## Animation Patterns

### Pulse Effect
```swift
// SwiftUI
@State private var isPulsing = false
Circle()
    .glassEffect(.regular.tint(isPulsing ? .blue : .clear))
    .animation(.easeInOut(duration: 1).repeatForever(), value: isPulsing)
    .onAppear { isPulsing = true }
```

### Morphing Between States
```swift
// SwiftUI
@Namespace private var namespace
if expanded {
    LargeView().glassEffect().glassEffectID("morph", in: namespace)
} else {
    SmallView().glassEffect().glassEffectID("morph", in: namespace)
}
```

## Performance Patterns

### Lazy Loading Glass
```swift
// SwiftUI
ScrollView {
    LazyVStack {
        ForEach(items) { item in
            ItemView(item)
                .glassEffect(isEnabled: item.isVisible)
        }
    }
}
```

### Batch Processing
```swift
// AppKit
let container = NSGlassEffectContainerView()
container.spacing = 20
// Add all glass views to container's contentView
```

## Decision Matrix

| Use Case | SwiftUI | AppKit |
|----------|---------|--------|
| Simple glass | `.glassEffect()` | `NSGlassEffectView` |
| Multiple glass | `GlassEffectContainer` | `NSGlassEffectContainerView` |
| Button styling | `.buttonStyle(.glass)` | Custom `GlassButton` class |
| Morphing | `.glassEffectID()` | Manual animation |
| Performance | Container + lazy | Container + batch |

## Tips & Tricks

1. **Merge Control**: Adjust container spacing to control merge distance
2. **State Changes**: Use tint color for visual feedback
3. **Touch Feedback**: Enable `.interactive()` for user interaction
4. **Performance**: Disable glass when off-screen
5. **Consistency**: Match corner radius across app

## See Also
- [Overview](overview.md)
- [AppKit Implementation](appkit.md)
- [SwiftUI Implementation](swiftui.md)