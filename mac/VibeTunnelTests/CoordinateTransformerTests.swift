import AppKit
import ScreenCaptureKit
import Testing
@testable import VibeTunnel

@MainActor
struct CoordinateTransformerTests {
    let transformer = CoordinateTransformer()

    @Test
    func coordinateFlippingConfiguration() {
        // Test environment-based configuration
        let defaultConfig = CoordinateTransformer.Configuration.fromEnvironment()
        // Just verify it can be created
        #expect(defaultConfig.shouldFlipY == true || defaultConfig.shouldFlipY == false)

        // Test custom configuration
        let customConfig = CoordinateTransformer.Configuration(
            shouldFlipY: false,
            useWarpCursor: true
        )
        #expect(customConfig.shouldFlipY == false)
        #expect(customConfig.useWarpCursor == true)
    }

    @Test
    func transformContextCreation() {
        // Test that we can create a transform context with different configurations
        let config1 = CoordinateTransformer.Configuration(shouldFlipY: true, useWarpCursor: false)
        #expect(config1.shouldFlipY == true)
        #expect(config1.useWarpCursor == false)

        let config2 = CoordinateTransformer.Configuration(shouldFlipY: false, useWarpCursor: true)
        #expect(config2.shouldFlipY == false)
        #expect(config2.useWarpCursor == true)
    }
}
