import AppKit
import ScreenCaptureKit
import Testing
@testable import VibeTunnel

@MainActor
struct CoordinateTransformerTests {
    let transformer = CoordinateTransformer()

    @Test
    func coordinateFlippingConfiguration() {
        // Test default configuration
        let defaultConfig = CoordinateTransformer.Configuration()
        #expect(defaultConfig.shouldFlipY == true) // Default is true

        // Test custom configuration
        let customConfig = CoordinateTransformer.Configuration(
            shouldFlipY: false
        )
        #expect(customConfig.shouldFlipY == false)
    }

    @Test
    func transformContextCreation() {
        // Test that we can create a transform context with different configurations
        let config1 = CoordinateTransformer.Configuration(shouldFlipY: true)
        #expect(config1.shouldFlipY == true)

        let config2 = CoordinateTransformer.Configuration(shouldFlipY: false)
        #expect(config2.shouldFlipY == false)
    }
}
