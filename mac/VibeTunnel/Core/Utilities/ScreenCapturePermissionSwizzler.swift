import Foundation
import ObjectiveC

/// A class that swizzles ScreenCaptureKit's permission request methods to automatically grant permissions.
///
/// This is useful for development and testing scenarios where you want to bypass the system
/// permission dialog. This should NEVER be used in production code.
///
/// The implementation swizzles the private `requestUserPermissionForScreenCapture:` method
/// on the `SCStreamManager` class to always call its completion handler with `true`.
///
/// Based on: https://chromium-review.googlesource.com/c/chromium/src/+/4727729/32/media/audio/mac/screen_capture_kit_swizzler.mm#24
final class ScreenCapturePermissionSwizzler {
    // MARK: - Private Properties

    /// Thread-safe singleton initialization using Swift's lazy static properties.
    /// This replaces the `dispatch_once` pattern from the Objective-C++ implementation.
    private static let swizzleOnce: Void = {
        swizzleScreenCapturePermission()
    }()

    // MARK: - Public Methods

    /// Enables the permission bypass by swizzling the ScreenCaptureKit permission method.
    ///
    /// This method is thread-safe and will only perform the swizzling once, regardless
    /// of how many times it's called.
    ///
    /// Usage:
    /// ```swift
    /// #if DEBUG
    /// ScreenCapturePermissionSwizzler.enablePermissionBypass()
    /// #endif
    /// ```
    static func enablePermissionBypass() {
        _ = swizzleOnce
    }

    // MARK: - Private Methods

    /// Performs the actual method swizzling on the SCStreamManager class.
    ///
    /// This method:
    /// 1. Locates the private SCStreamManager class using runtime introspection
    /// 2. Finds the original permission request method
    /// 3. Adds our replacement method to the class
    /// 4. Exchanges the implementations
    ///
    /// The approach mirrors the Chromium implementation but uses Swift's runtime APIs
    /// instead of direct Objective-C runtime calls with C-style syntax.
    private static func swizzleScreenCapturePermission() {
        // Get the private SCStreamManager class using NSClassFromString
        // This is equivalent to objc_getClass("SCStreamManager") in the original
        guard let streamManagerClass = NSClassFromString("SCStreamManager") else {
            print("[ScreenCapturePermissionSwizzler] Failed to find SCStreamManager class")
            return
        }

        // Define selectors for the original and swizzled methods
        let originalSelector = NSSelectorFromString("requestUserPermissionForScreenCapture:")
        let swizzledSelector = #selector(swizzled_requestUserPermissionForScreenCapture(_:))

        // Get the original method from the SCStreamManager class
        guard let originalMethod = class_getInstanceMethod(streamManagerClass, originalSelector) else {
            print(
                "[ScreenCapturePermissionSwizzler] Failed to find original requestUserPermissionForScreenCapture: method"
            )
            return
        }

        // Get the implementation and type encoding for our swizzled method
        guard let swizzledIMP = class_getMethodImplementation(
            ScreenCapturePermissionSwizzler.self,
            swizzledSelector
        ) else {
            print("[ScreenCapturePermissionSwizzler] Failed to get swizzled method implementation")
            return
        }

        // Get the type encoding from the original method to ensure compatibility
        guard let encoding = method_getTypeEncoding(originalMethod) else {
            print("[ScreenCapturePermissionSwizzler] Failed to get method type encoding")
            return
        }

        // First, try to add our swizzled method to the SCStreamManager class
        // This is necessary because our implementation is defined in ScreenCapturePermissionSwizzler
        let didAdd = class_addMethod(
            streamManagerClass,
            swizzledSelector,
            swizzledIMP,
            encoding
        )

        if didAdd {
            // Method was successfully added, now we can exchange implementations
            if let swizzledMethod = class_getInstanceMethod(streamManagerClass, swizzledSelector) {
                method_exchangeImplementations(originalMethod, swizzledMethod)
                print("[ScreenCapturePermissionSwizzler] Successfully swizzled requestUserPermissionForScreenCapture:")
            } else {
                print("[ScreenCapturePermissionSwizzler] Failed to get swizzled method after adding")
            }
        } else {
            // Method already exists (unlikely), try to exchange anyway
            if let swizzledMethod = class_getInstanceMethod(streamManagerClass, swizzledSelector) {
                method_exchangeImplementations(originalMethod, swizzledMethod)
                print("[ScreenCapturePermissionSwizzler] Successfully swizzled existing method")
            } else {
                print("[ScreenCapturePermissionSwizzler] Failed to get existing swizzled method")
            }
        }
    }

    // MARK: - Swizzled Implementation

    /// The replacement implementation for `requestUserPermissionForScreenCapture:`.
    ///
    /// This method always calls the completion handler with `true`, effectively
    /// granting screen capture permission without showing the system dialog.
    ///
    /// - Parameter completionHandler: The completion block that expects a Bool parameter
    ///                               indicating whether permission was granted.
    ///
    /// - Note: This matches the signature of the original SCStreamManager method:
    ///         `- (void)requestUserPermissionForScreenCapture:(void (^)(BOOL))completionHandler;`
    @objc private dynamic func swizzled_requestUserPermissionForScreenCapture(
        _ completionHandler: @escaping @Sendable (Bool)
            -> Void
    ) {
        // Always grant permission by calling the completion handler with true
        // We dispatch to main queue to match the behavior of the system implementation
        DispatchQueue.main.async {
            completionHandler(true)
        }
    }
}

// MARK: - Usage Notes

// Usage example:
//
// ```swift
// // In your app initialization, only for debug builds:
// #if DEBUG
// ScreenCapturePermissionSwizzler.enablePermissionBypass()
// #endif
// ```
//
// Important considerations:
// 1. This should ONLY be used in development/debug builds
// 2. The swizzling affects the entire process
// 3. This bypasses an important security feature of macOS
// 4. Make sure this code is never included in production builds
//
// Original implementation reference:
// https://chromium-review.googlesource.com/c/chromium/src/+/4727729/32/media/audio/mac/screen_capture_kit_swizzler.mm#24
