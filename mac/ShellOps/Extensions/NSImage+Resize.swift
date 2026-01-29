import AppKit

extension NSImage {
    /// Resizes the image to the specified size while maintaining aspect ratio and quality
    func resized(to targetSize: NSSize) -> NSImage {
        let image = NSImage(size: targetSize)
        image.lockFocus()

        // Calculate the aspect-fit rectangle
        let aspectWidth = targetSize.width / self.size.width
        let aspectHeight = targetSize.height / self.size.height
        let aspectRatio = min(aspectWidth, aspectHeight)

        let scaledWidth = self.size.width * aspectRatio
        let scaledHeight = self.size.height * aspectRatio
        let drawingRect = NSRect(
            x: (targetSize.width - scaledWidth) / 2,
            y: (targetSize.height - scaledHeight) / 2,
            width: scaledWidth,
            height: scaledHeight)

        // Use high-quality interpolation
        NSGraphicsContext.current?.imageInterpolation = .high

        // Draw the image
        self.draw(
            in: drawingRect,
            from: NSRect(origin: .zero, size: self.size),
            operation: .copy,
            fraction: 1.0)

        image.unlockFocus()
        return image
    }
}
