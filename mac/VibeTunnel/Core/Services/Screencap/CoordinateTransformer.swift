import AppKit
import CoreGraphics
import Foundation
import OSLog
@preconcurrency import ScreenCaptureKit

/// Transforms normalized coordinates (0-1000 range) to screen coordinates
/// based on the current capture context and mode.
@MainActor
public final class CoordinateTransformer {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CoordinateTransformer")

    /// Configuration for coordinate transformation
    public struct Configuration {
        /// Whether to flip Y coordinates (true by default)
        /// SCDisplay uses top-left origin, NSEvent/CGEvent uses bottom-left origin
        public let shouldFlipY: Bool

        /// Whether to use CGWarpMouseCursorPosition (false by default)
        public let useWarpCursor: Bool

        /// Creates a configuration from environment variables
        public static func fromEnvironment() -> Self {
            Self(
                shouldFlipY: ProcessInfo.processInfo.environment["VIBETUNNEL_FLIP_Y"] != "false",
                useWarpCursor: ProcessInfo.processInfo.environment["VIBETUNNEL_USE_WARP"] == "true"
            )
        }

        public init(shouldFlipY: Bool = true, useWarpCursor: Bool = false) {
            self.shouldFlipY = shouldFlipY
            self.useWarpCursor = useWarpCursor
        }
    }

    /// Context information for coordinate transformation
    public struct TransformContext {
        /// The current capture mode
        public let captureMode: CaptureMode

        /// The capture filter being used
        public let captureFilter: SCContentFilter

        /// The actual captured content rect from the sample buffer (if available)
        public let actualContentRect: CGRect?

        /// Configuration for the transformation
        public let configuration: Configuration

        public init(
            captureMode: CaptureMode,
            captureFilter: SCContentFilter,
            actualContentRect: CGRect? = nil,
            configuration: Configuration = .fromEnvironment()
        ) {
            self.captureMode = captureMode
            self.captureFilter = captureFilter
            self.actualContentRect = actualContentRect
            self.configuration = configuration
        }
    }

    /// Transforms normalized coordinates (0-1000) to screen coordinates
    /// - Parameters:
    ///   - normalizedX: X coordinate in 0-1000 range
    ///   - normalizedY: Y coordinate in 0-1000 range
    ///   - context: The transformation context
    /// - Returns: The transformed screen coordinates
    /// - Throws: ScreencapError if transformation fails
    public func transform(normalizedX: Double, normalizedY: Double, context: TransformContext) async throws -> CGPoint {
        // Validate input coordinates
        guard normalizedX >= 0 && normalizedX <= 1_000 && normalizedY >= 0 && normalizedY <= 1_000 else {
            throw ScreencapError.invalidCoordinates(x: normalizedX, y: normalizedY)
        }

        // Convert to 0-1 range
        let x = normalizedX / 1_000.0
        let y = normalizedY / 1_000.0

        // Use actual captured content rect if available, otherwise fall back to filter
        let contentRect = context.actualContentRect ?? context.captureFilter.contentRect

        // Calculate pixel coordinates based on capture mode
        let pixelCoordinates = try await calculatePixelCoordinates(
            normalizedX: x,
            normalizedY: y,
            contentRect: contentRect,
            context: context
        )

        // Apply Y-coordinate flipping if needed
        let finalCoordinates = applyCoordinateFlipping(
            pixelCoordinates: pixelCoordinates,
            configuration: context.configuration
        )

        // Validate final coordinates are within screen bounds
        let validatedCoordinates = try validateAndClampCoordinates(finalCoordinates)

        // Test warp cursor if enabled (for debugging)
        if context.configuration.useWarpCursor {
            testWarpCursor(at: validatedCoordinates)
        }

        return validatedCoordinates
    }

    // MARK: - Private Methods

    /// Calculates pixel coordinates based on capture mode
    private func calculatePixelCoordinates(
        normalizedX: Double,
        normalizedY: Double,
        contentRect: CGRect,
        context: TransformContext
    )
        async throws -> CGPoint
    {
        switch context.captureMode {
        case .desktop(let displayIndex):
            try await calculateDesktopCoordinates(
                normalizedX: normalizedX,
                normalizedY: normalizedY,
                displayIndex: displayIndex
            )

        case .allDisplays:
            try await calculateAllDisplaysCoordinates(
                normalizedX: normalizedX,
                normalizedY: normalizedY
            )

        case .window:
            calculateWindowCoordinates(
                normalizedX: normalizedX,
                normalizedY: normalizedY,
                contentRect: contentRect
            )

        case .application:
            calculateApplicationCoordinates(
                normalizedX: normalizedX,
                normalizedY: normalizedY,
                contentRect: contentRect
            )
        }
    }

    /// Calculates coordinates for desktop capture mode
    private func calculateDesktopCoordinates(
        normalizedX: Double,
        normalizedY: Double,
        displayIndex: Int
    )
        async throws -> CGPoint
    {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        guard displayIndex >= 0 && displayIndex < content.displays.count else {
            throw ScreencapError.noDisplay
        }

        let display = content.displays[displayIndex]

        // Convert normalized to logical point coordinates within the display
        // The normalized coordinates represent the pixel space (0-1000 maps to full capture resolution)
        // We need to map them back to logical points for CGEvent
        let x = display.frame.origin.x + (normalizedX * display.frame.width)
        let y = display.frame.origin.y + (normalizedY * display.frame.height)

        return CGPoint(x: x, y: y)
    }

    /// Calculates coordinates for all displays capture mode
    private func calculateAllDisplaysCoordinates(
        normalizedX: Double,
        normalizedY: Double
    )
        async throws -> CGPoint
    {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        // Calculate the bounding rectangle that encompasses all displays
        var minX = CGFloat.greatestFiniteMagnitude
        var minY = CGFloat.greatestFiniteMagnitude
        var maxX: CGFloat = -CGFloat.greatestFiniteMagnitude
        var maxY: CGFloat = -CGFloat.greatestFiniteMagnitude

        for display in content.displays {
            minX = min(minX, display.frame.origin.x)
            minY = min(minY, display.frame.origin.y)
            maxX = max(maxX, display.frame.origin.x + display.frame.width)
            maxY = max(maxY, display.frame.origin.y + display.frame.height)
        }

        let totalWidth = maxX - minX
        let totalHeight = maxY - minY

        // Convert normalized to logical point coordinates within the combined bounds
        let x = minX + (normalizedX * totalWidth)
        let y = minY + (normalizedY * totalHeight)

        return CGPoint(x: x, y: y)
    }

    /// Calculates coordinates for window capture mode
    private func calculateWindowCoordinates(
        normalizedX: Double,
        normalizedY: Double,
        contentRect: CGRect
    )
        -> CGPoint
    {
        // Convert normalized to logical point coordinates within the window
        // Use the actual captured content rect which reflects the window's current position
        let x = contentRect.origin.x + (normalizedX * contentRect.width)
        let y = contentRect.origin.y + (normalizedY * contentRect.height)

        return CGPoint(x: x, y: y)
    }

    /// Calculates coordinates for application capture mode
    private func calculateApplicationCoordinates(
        normalizedX: Double,
        normalizedY: Double,
        contentRect: CGRect
    )
        -> CGPoint
    {
        // Convert normalized to logical point coordinates within the application bounds
        let x = contentRect.origin.x + (normalizedX * contentRect.width)
        let y = contentRect.origin.y + (normalizedY * contentRect.height)

        return CGPoint(x: x, y: y)
    }

    /// Applies Y-coordinate flipping if needed
    private func applyCoordinateFlipping(
        pixelCoordinates: CGPoint,
        configuration: Configuration
    )
        -> CGPoint
    {
        guard configuration.shouldFlipY else {
            return pixelCoordinates
        }

        // Find the screen that contains our click point
        guard let targetScreen = findScreenContaining(point: pixelCoordinates) else {
            logger
                .warning("No screen contains point at (\(pixelCoordinates.x), \(pixelCoordinates.y)), using main screen"
                )
            guard let mainScreen = NSScreen.main ?? NSScreen.screens.first else {
                return pixelCoordinates
            }
            return flipYCoordinate(y: pixelCoordinates.y, inScreen: mainScreen, x: pixelCoordinates.x)
        }

        return flipYCoordinate(y: pixelCoordinates.y, inScreen: targetScreen, x: pixelCoordinates.x)
    }

    /// Finds the screen containing the given point
    private func findScreenContaining(point: CGPoint) -> NSScreen? {
        for screen in NSScreen.screens {
            if screen.frame.contains(point) {
                return screen
            }
        }
        return nil
    }

    /// Flips Y coordinate for the given screen
    private func flipYCoordinate(y: Double, inScreen screen: NSScreen, x: Double) -> CGPoint {
        // Calculate the correct Y coordinate flip relative to the target screen
        let screenHeight = screen.frame.height
        let screenOriginY = screen.frame.origin.y

        // For NSScreen coordinates, we need to flip Y relative to the screen's coordinate system
        // SCDisplay uses top-left origin, NSEvent uses bottom-left origin
        let relativeY = y - screenOriginY // Y position relative to the screen's top
        let flippedY = screenOriginY + (screenHeight - relativeY) // Flip Y within the screen

        return CGPoint(x: x, y: flippedY)
    }

    /// Validates and clamps coordinates to ensure they're within screen bounds
    private func validateAndClampCoordinates(_ point: CGPoint) throws -> CGPoint {
        let allScreensBounds = NSScreen.screens.reduce(CGRect.null) { result, screen in
            result.union(screen.frame)
        }

        guard !allScreensBounds.isNull else {
            throw ScreencapError.noDisplay
        }

        if allScreensBounds.contains(point) {
            return point
        }

        // Clamp to valid bounds
        let clampedX = max(allScreensBounds.minX, min(point.x, allScreensBounds.maxX - 1))
        let clampedY = max(allScreensBounds.minY, min(point.y, allScreensBounds.maxY - 1))

        logger.warning("Coordinates clamped from (\(point.x), \(point.y)) to (\(clampedX), \(clampedY))")

        return CGPoint(x: clampedX, y: clampedY)
    }

    /// Tests CGWarpMouseCursorPosition (for debugging)
    private func testWarpCursor(at point: CGPoint) {
        let result = CGWarpMouseCursorPosition(point)
        logger
            .info(
                "CGWarpMouseCursorPosition test at (\(point.x), \(point.y)): \(result == .success ? "SUCCESS" : "FAILED with error \(result.rawValue)")"
            )
    }
}

// MARK: - Helper Extensions

extension CoordinateTransformer {
    /// Convenience method for transforming with minimal parameters
    public func transform(
        x: Double,
        y: Double,
        captureMode: CaptureMode,
        captureFilter: SCContentFilter,
        actualContentRect: CGRect? = nil
    )
        async throws -> CGPoint
    {
        let context = TransformContext(
            captureMode: captureMode,
            captureFilter: captureFilter,
            actualContentRect: actualContentRect
        )
        return try await transform(normalizedX: x, normalizedY: y, context: context)
    }
}
