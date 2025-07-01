import SwiftUI

/// A custom shape that has rounded corners only on the left and right sides.
/// The top and bottom edges remain flat, creating a shape suitable for
/// menu-style UI elements that appear below the menu bar.
struct SideRoundedRectangle: Shape {
    var cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()

        // Start from top-left corner (flat)
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))

        // Top edge (flat)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))

        // Right edge with rounded corners
        path.addArc(
            center: CGPoint(x: rect.maxX - cornerRadius, y: rect.minY + cornerRadius),
            radius: cornerRadius,
            startAngle: .degrees(-90),
            endAngle: .degrees(0),
            clockwise: false
        )

        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cornerRadius))

        path.addArc(
            center: CGPoint(x: rect.maxX - cornerRadius, y: rect.maxY - cornerRadius),
            radius: cornerRadius,
            startAngle: .degrees(0),
            endAngle: .degrees(90),
            clockwise: false
        )

        // Bottom edge (flat)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))

        // Left edge with rounded corners
        path.addArc(
            center: CGPoint(x: rect.minX + cornerRadius, y: rect.maxY - cornerRadius),
            radius: cornerRadius,
            startAngle: .degrees(90),
            endAngle: .degrees(180),
            clockwise: false
        )

        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + cornerRadius))

        path.addArc(
            center: CGPoint(x: rect.minX + cornerRadius, y: rect.minY + cornerRadius),
            radius: cornerRadius,
            startAngle: .degrees(180),
            endAngle: .degrees(270),
            clockwise: false
        )

        path.closeSubpath()

        return path
    }
}
