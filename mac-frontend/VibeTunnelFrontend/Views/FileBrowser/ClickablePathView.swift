import SwiftUI

struct ClickablePathView: View {
    let currentPath: String
    let onNavigate: (String) -> Void
    @State private var hoveredSegment: Int?
    
    private var pathSegments: [(name: String, fullPath: String)] {
        guard !currentPath.isEmpty && currentPath != "/" else {
            return [(name: "Root", fullPath: "/")]
        }
        
        var segments: [(name: String, fullPath: String)] = []
        
        // Always start with root/home
        let isHomePath = currentPath.hasPrefix("~")
        segments.append((name: isHomePath ? "Home" : "Root", fullPath: isHomePath ? "~" : "/"))
        
        // Split the path and build cumulative paths
        let cleanPath = currentPath.replacingOccurrences(of: "~", with: "")
        let components = cleanPath.split(separator: "/", omittingEmptySubsequences: true)
        
        for (index, component) in components.enumerated() {
            let componentStr = String(component)
            var fullPath: String
            
            if isHomePath {
                fullPath = "~/" + components[0...index].joined(separator: "/")
            } else {
                fullPath = "/" + components[0...index].joined(separator: "/")
            }
            
            segments.append((name: componentStr, fullPath: fullPath))
        }
        
        return segments
    }
    
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(Array(pathSegments.enumerated()), id: \.offset) { index, segment in
                    Button(action: {
                        if segment.fullPath != currentPath {
                            onNavigate(segment.fullPath)
                        }
                    }) {
                        Text(segment.name)
                            .font(.system(size: 12, weight: index == pathSegments.count - 1 ? .semibold : .medium))
                            .foregroundColor(
                                index == pathSegments.count - 1 
                                    ? Theme.Colors.primaryText 
                                    : (hoveredSegment == index ? Theme.Colors.accent : Theme.Colors.accentBlue)
                            )
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(
                                        hoveredSegment == index && index != pathSegments.count - 1
                                            ? Theme.Colors.tertiaryBackground.opacity(0.5)
                                            : Color.clear
                                    )
                            )
                            .animation(.easeInOut(duration: 0.15), value: hoveredSegment)
                    }
                    .buttonStyle(.plain)
                    .disabled(index == pathSegments.count - 1)
                    .onHover { hovering in
                        if index != pathSegments.count - 1 {
                            hoveredSegment = hovering ? index : nil
                        }
                    }
                    
                    if index < pathSegments.count - 1 {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(Theme.Colors.tertiaryText.opacity(0.6))
                            .padding(.horizontal, 2)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 20) {
        ClickablePathView(
            currentPath: "/",
            onNavigate: { path in print("Navigate to: \(path)") }
        )
        
        ClickablePathView(
            currentPath: "/Users/john/Documents",
            onNavigate: { path in print("Navigate to: \(path)") }
        )
        
        ClickablePathView(
            currentPath: "~/Projects/VibeTunnel/src",
            onNavigate: { path in print("Navigate to: \(path)") }
        )
    }
    .padding()
    .frame(width: 600)
    .background(Theme.Colors.secondaryBackground)
}