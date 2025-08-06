# SwiftUI Toolbar Features

## Quick Reference

| Feature | Modifier/Type | Purpose |
|---------|--------------|---------|
| `.toolbar(id:)` | Customizable toolbar | User can add/remove/reorder |
| `ToolbarSpacer` | Spacing control | Fixed or flexible spacing |
| `.searchToolbarBehavior()` | Search field display | Minimize/expand behavior |
| `DefaultToolbarItem` | System items | Reposition system controls |
| `.matchedTransitionSource()` | Transitions | Zoom from toolbar items |

## Customizable Toolbars

### Basic Setup
```swift
.toolbar(id: "main") {
    ToolbarItem(id: "save") { SaveButton() }
    ToolbarItem(id: "share") { ShareButton() }
    ToolbarSpacer(.flexible)
    ToolbarItem(id: "more") { MoreButton() }
}
```

### Spacer Types
```swift
ToolbarSpacer(.fixed)     // Fixed width
ToolbarSpacer(.flexible)  // Pushes items apart
```

## Search Integration

### Minimize Behavior
```swift
@State private var searchText = ""

NavigationStack {
    ContentView()
        .searchable($searchText)
        .searchToolbarBehavior(.minimize)  // Compact search button
}
```

### Repositioning Search
```swift
.toolbar {
    ToolbarItem(placement: .bottomBar) { Button1() }
    DefaultToolbarItem(kind: .search, placement: .bottomBar)
    ToolbarItem(placement: .bottomBar) { Button2() }
}
```

## Placement Options

### Common Placements
```swift
.toolbar {
    // Navigation bar
    ToolbarItem(placement: .navigationBarLeading) { }
    ToolbarItem(placement: .navigationBarTrailing) { }
    ToolbarItem(placement: .principal) { }
    
    // Bottom bar (iOS)
    ToolbarItem(placement: .bottomBar) { }
    
    // Large title area
    ToolbarItem(placement: .largeSubtitle) { CustomSubtitle() }
}
```

### Large Subtitle
```swift
NavigationStack {
    Content()
        .navigationTitle("Title")
        .navigationSubtitle("Subtitle")
        .toolbar {
            ToolbarItem(placement: .largeSubtitle) {
                // Overrides navigationSubtitle
                CustomSubtitleView()
            }
        }
}
```

## Visual Effects

### Matched Transitions
```swift
@State private var showDetail = false
@Namespace private var namespace

NavigationStack {
    Content()
        .toolbar {
            ToolbarItem {
                Button("Open") { showDetail = true }
                    .matchedTransitionSource(id: "btn", in: namespace)
            }
        }
        .sheet(isPresented: $showDetail) {
            DetailView()
                .navigationTransition(.zoom(sourceID: "btn", in: namespace))
        }
}
```

### Background Visibility
```swift
.toolbar(id: "main") {
    ToolbarItem(id: "status", placement: .principal) {
        StatusView()
            .sharedBackgroundVisibility(.hidden)  // No glass background
    }
}
```

## System Items

### Default Items
```swift
.toolbar {
    // Reposition system search
    DefaultToolbarItem(kind: .search, placement: .bottomBar)
    
    // Sidebar toggle
    DefaultToolbarItem(kind: .sidebar, placement: .navigationBarLeading)
}
```

## Platform Considerations

### iOS/iPadOS
```swift
#if os(iOS)
.toolbar {
    ToolbarItemGroup(placement: .bottomBar) {
        // Bottom bar items for iPhone
    }
}
#endif
```

### macOS
```swift
#if os(macOS)
.toolbar {
    ToolbarItem(placement: .automatic) {
        // macOS toolbar items
    }
}
#endif
```

## Common Patterns

### Dynamic Toolbar
```swift
@State private var isEditing = false

.toolbar {
    if isEditing {
        ToolbarItem(id: "done") { DoneButton() }
    } else {
        ToolbarItem(id: "edit") { EditButton() }
    }
}
```

### Grouped Actions
```swift
.toolbar {
    ToolbarItemGroup(placement: .bottomBar) {
        Button("One") { }
        Button("Two") { }
        Button("Three") { }
    }
}
```

### Contextual Items
```swift
@State private var selection: Item?

.toolbar {
    if selection != nil {
        ToolbarItem { DeleteButton() }
        ToolbarItem { ShareButton() }
    }
}
```

## Best Practices

1. **Unique IDs**: Use meaningful identifiers for customizable items
2. **Logical Groups**: Use spacers to group related actions
3. **Platform Awareness**: Test on all target platforms
4. **Consistent Placement**: Follow platform conventions
5. **Minimal Items**: Avoid overcrowding toolbars

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Items not customizable | Add `id` to toolbar and items |
| Search not minimizing | Apply `.searchToolbarBehavior(.minimize)` |
| Transition not working | Check namespace and ID match |
| Items hidden | Check placement compatibility |

## References
- [Apple Docs: ToolbarContent](https://developer.apple.com/documentation/SwiftUI/ToolbarContent)
- [Apple Docs: CustomizableToolbarContent](https://developer.apple.com/documentation/SwiftUI/CustomizableToolbarContent)
- [Liquid Glass Integration](../liquid-glass/swiftui.md)