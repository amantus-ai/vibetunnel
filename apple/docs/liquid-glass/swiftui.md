# Liquid Glass in SwiftUI

## Quick Reference

| Modifier/View | Purpose | Parameters |
|---------------|---------|------------|
| `.glassEffect()` | Apply glass to view | `Glass`, `Shape`, `isEnabled` |
| `GlassEffectContainer` | Optimize multiple glass | `spacing`, `content` |
| `.buttonStyle(.glass)` | Glass button style | N/A |
| `.glassEffectID()` | Morphing transitions | `id`, `namespace` |

## Basic Implementation

### Simple Glass Effect
```swift
Text("Hello")
    .padding()
    .glassEffect()  // Default: regular glass, capsule shape
```

### Custom Shape & Tint
```swift
Image(systemName: "star")
    .glassEffect(
        .regular.tint(.blue).interactive(),
        in: .rect(cornerRadius: 12)
    )
```

## Glass Variants

### Configuration Options
```swift
// Regular glass
.glassEffect(.regular)

// With tint
.glassEffect(.regular.tint(.orange))

// Interactive (responds to touch)
.glassEffect(.regular.interactive())

// Combined
.glassEffect(.regular.tint(.blue).interactive())
```

## Container Usage

### Multiple Glass Views
```swift
GlassEffectContainer(spacing: 40) {
    HStack(spacing: 40) {
        ForEach(items) { item in
            ItemView(item)
                .glassEffect()
        }
    }
}
```

### Union Effect
```swift
@Namespace private var namespace

GlassEffectContainer {
    HStack {
        ForEach(items.indices, id: \.self) { index in
            ItemView(items[index])
                .glassEffect()
                .glassEffectUnion(
                    id: index < 2 ? "group1" : "group2",
                    namespace: namespace
                )
        }
    }
}
```

## Morphing Transitions

### Animated Morphing
```swift
@State private var expanded = false
@Namespace private var namespace

GlassEffectContainer {
    if expanded {
        LargeView()
            .glassEffect()
            .glassEffectID("item", in: namespace)
    } else {
        SmallView()
            .glassEffect()
            .glassEffectID("item", in: namespace)
    }
}
.animation(.spring(), value: expanded)
```

## Button Styles

### Glass Buttons
```swift
// Standard glass button
Button("Action") { }
    .buttonStyle(.glass)

// Prominent glass button
Button("Important") { }
    .buttonStyle(.glassProminent)
```

## Toolbar Integration

### Glass in Toolbar
```swift
.toolbar {
    ToolbarItem(placement: .primaryAction) {
        Button("Save") { }
            .buttonStyle(.glass)
    }
}
```

### Custom Toolbar Background
```swift
.toolbar {
    ToolbarItem(placement: .principal) {
        Text("Title")
            .sharedBackgroundVisibility(.hidden)
    }
}
```

## Advanced Techniques

### Conditional Glass
```swift
@State private var glassEnabled = true

Text("Dynamic")
    .glassEffect(isEnabled: glassEnabled)
```

### Navigation Transitions
```swift
@Namespace private var namespace

NavigationStack {
    Content()
        .toolbar {
            ToolbarItem {
                Button("Open") { }
                    .matchedTransitionSource(id: "btn", in: namespace)
            }
        }
        .sheet(isPresented: $show) {
            DetailView()
                .navigationTransition(.zoom(sourceID: "btn", in: namespace))
        }
}
```

## Performance Tips

1. **Container Usage**: Always wrap multiple glass views
2. **Spacing**: Smaller = merge closer, larger = merge farther
3. **Limit Count**: 5-10 glass effects maximum
4. **Disable When Hidden**: Use `isEnabled` parameter

## Common Patterns

| Pattern | Implementation |
|---------|---------------|
| Toggle glass | `.glassEffect(isEnabled: condition)` |
| Group merge | `.glassEffectUnion(id:namespace:)` |
| Custom shape | `.glassEffect(in: .rect(cornerRadius: 20))` |
| State indication | `.tint(isActive ? .blue : .clear)` |

## Platform Notes

- **iOS**: Bottom bar placement works well
- **iPadOS**: Consider larger touch targets
- **macOS**: Toolbar customization expected

## See Also
- [Overview](overview.md)
- [AppKit Implementation](appkit.md)
- [Common Patterns](patterns.md)
- [Apple Docs: glassEffect](https://developer.apple.com/documentation/SwiftUI/View/glassEffect)