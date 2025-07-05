import ApplicationServices
import Foundation
import OSLog

/// A Swift-friendly wrapper around AXUIElement that simplifies accessibility operations.
/// This is a minimal implementation inspired by AXorcist but tailored for VibeTunnel's needs.
public struct AXElement: Equatable, Hashable, @unchecked Sendable {
    // MARK: - Properties

    /// The underlying AXUIElement
    public let element: AXUIElement

    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "AXElement"
    )

    // MARK: - Initialization

    /// Creates an AXElement wrapper around an AXUIElement
    public init(_ element: AXUIElement) {
        self.element = element
    }

    // MARK: - Factory Methods

    /// Creates an element for the system-wide accessibility object
    public static var systemWide: Self {
        Self(AXUIElementCreateSystemWide())
    }

    /// Creates an element for an application with the given process ID
    public static func application(pid: pid_t) -> Self {
        Self(AXUIElementCreateApplication(pid))
    }

    // MARK: - Attribute Access

    /// Gets a string attribute value
    public func string(for attribute: String) -> String? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success,
              let stringValue = value as? String
        else {
            return nil
        }

        return stringValue
    }

    /// Gets a boolean attribute value
    public func bool(for attribute: String) -> Bool? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success else { return nil }

        if let boolValue = value as? Bool {
            return boolValue
        }

        // Handle CFBoolean
        if CFGetTypeID(value) == CFBooleanGetTypeID() {
            return CFBooleanGetValue(value as! CFBoolean)
        }

        return nil
    }

    /// Gets an integer attribute value
    public func int(for attribute: String) -> Int? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success,
              let number = value as? NSNumber
        else {
            return nil
        }

        return number.intValue
    }

    /// Gets a CGPoint attribute value
    public func point(for attribute: String) -> CGPoint? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success else { return nil }

        var point = CGPoint.zero
        if AXValueGetValue(value as! AXValue, .cgPoint, &point) {
            return point
        }

        return nil
    }

    /// Gets a CGSize attribute value
    public func size(for attribute: String) -> CGSize? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success else { return nil }

        var size = CGSize.zero
        if AXValueGetValue(value as! AXValue, .cgSize, &size) {
            return size
        }

        return nil
    }

    /// Gets a CGRect by combining position and size attributes
    public func frame() -> CGRect? {
        guard let position = point(for: kAXPositionAttribute),
              let size = size(for: kAXSizeAttribute)
        else {
            return nil
        }

        return CGRect(origin: position, size: size)
    }

    /// Gets an AXUIElement attribute value
    public func element(for attribute: String) -> Self? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success,
              CFGetTypeID(value) == AXUIElementGetTypeID()
        else {
            return nil
        }

        return Self(value as! AXUIElement)
    }

    /// Gets an array of AXUIElement attribute values
    public func elements(for attribute: String) -> [Self]? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success,
              let array = value as? [AXUIElement]
        else {
            return nil
        }

        return array.map { Self($0) }
    }

    /// Gets the raw attribute value as CFTypeRef
    public func rawValue(for attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success else { return nil }

        return value
    }

    // MARK: - Attribute Setting

    /// Sets an attribute value
    @discardableResult
    public func setAttribute(_ attribute: String, value: CFTypeRef) -> AXError {
        AXUIElementSetAttributeValue(element, attribute as CFString, value)
    }

    /// Sets a boolean attribute
    @discardableResult
    public func setBool(_ attribute: String, value: Bool) -> AXError {
        setAttribute(attribute, value: value as CFBoolean)
    }

    /// Sets a CGPoint attribute
    @discardableResult
    public func setPoint(_ attribute: String, value: CGPoint) -> AXError {
        var mutableValue = value
        guard let axValue = AXValueCreate(.cgPoint, &mutableValue) else {
            return .failure
        }
        return setAttribute(attribute, value: axValue)
    }

    /// Sets a CGSize attribute
    @discardableResult
    public func setSize(_ attribute: String, value: CGSize) -> AXError {
        var mutableValue = value
        guard let axValue = AXValueCreate(.cgSize, &mutableValue) else {
            return .failure
        }
        return setAttribute(attribute, value: axValue)
    }

    // MARK: - Actions

    /// Performs an action on the element
    @discardableResult
    public func performAction(_ action: String) -> AXError {
        AXUIElementPerformAction(element, action as CFString)
    }

    /// Gets the list of supported actions
    public func actions() -> [String]? {
        var actions: CFArray?
        let result = AXUIElementCopyActionNames(element, &actions)

        guard result == .success,
              let actionArray = actions as? [String]
        else {
            return nil
        }

        return actionArray
    }

    // MARK: - Common Attributes

    /// Gets the role of the element
    public var role: String? {
        string(for: kAXRoleAttribute)
    }

    /// Gets the title of the element
    public var title: String? {
        string(for: kAXTitleAttribute)
    }

    /// Gets the value of the element
    public var value: Any? {
        rawValue(for: kAXValueAttribute)
    }

    /// Gets the position of the element
    public var position: CGPoint? {
        point(for: kAXPositionAttribute)
    }

    /// Gets the size of the element
    public var size: CGSize? {
        size(for: kAXSizeAttribute)
    }

    /// Gets the focused state of the element
    public var isFocused: Bool {
        bool(for: kAXFocusedAttribute) ?? false
    }

    /// Gets the enabled state of the element
    public var isEnabled: Bool {
        bool(for: kAXEnabledAttribute) ?? true
    }

    /// Gets the window ID (for window elements)
    public var windowID: Int? {
        int(for: "_AXWindowNumber")
    }

    // MARK: - Hierarchy

    /// Gets the parent element
    public var parent: Self? {
        element(for: kAXParentAttribute)
    }

    /// Gets the children elements
    public var children: [Self]? {
        elements(for: kAXChildrenAttribute)
    }

    /// Gets the windows (for application elements)
    public var windows: [Self]? {
        elements(for: kAXWindowsAttribute)
    }

    // MARK: - Parameterized Attributes

    /// Checks if an attribute is settable
    public func isAttributeSettable(_ attribute: String) -> Bool {
        var settable: DarwinBoolean = false
        let result = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
        return result == .success && settable.boolValue
    }

    // MARK: - Equatable & Hashable

    public static func == (lhs: Self, rhs: Self) -> Bool {
        CFEqual(lhs.element, rhs.element)
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(CFHash(element))
    }
}

// MARK: - Common Actions

extension AXElement {
    /// Presses the element (for buttons, etc.)
    @discardableResult
    public func press() -> Bool {
        performAction(kAXPressAction) == .success
    }

    /// Raises the element (for windows)
    @discardableResult
    public func raise() -> Bool {
        performAction(kAXRaiseAction) == .success
    }

    /// Shows the menu for the element
    @discardableResult
    public func showMenu() -> Bool {
        performAction(kAXShowMenuAction) == .success
    }
}

// MARK: - Window-specific Operations

extension AXElement {
    /// Checks if this is a window element
    public var isWindow: Bool {
        role == kAXWindowRole
    }

    /// Checks if the window is minimized
    public var isMinimized: Bool? {
        guard isWindow else { return nil }
        return bool(for: kAXMinimizedAttribute)
    }

    /// Minimizes or unminimizes the window
    @discardableResult
    public func setMinimized(_ minimized: Bool) -> AXError {
        guard isWindow else { return .attributeUnsupported }
        return setBool(kAXMinimizedAttribute, value: minimized)
    }

    /// Gets the close button of the window
    public var closeButton: AXElement? {
        guard isWindow else { return nil }
        return element(for: kAXCloseButtonAttribute)
    }

    /// Gets the minimize button of the window
    public var minimizeButton: AXElement? {
        guard isWindow else { return nil }
        return element(for: kAXMinimizeButtonAttribute)
    }

    /// Gets the main window state
    public var isMain: Bool? {
        guard isWindow else { return nil }
        return bool(for: kAXMainAttribute)
    }

    /// Sets the main window state
    @discardableResult
    public func setMain(_ main: Bool) -> AXError {
        guard isWindow else { return .attributeUnsupported }
        return setBool(kAXMainAttribute, value: main)
    }

    /// Gets the focused window state
    public var isFocusedWindow: Bool? {
        guard isWindow else { return nil }
        return bool(for: kAXFocusedAttribute)
    }

    /// Sets the focused window state
    @discardableResult
    public func setFocused(_ focused: Bool) -> AXError {
        guard isWindow else { return .attributeUnsupported }
        return setBool(kAXFocusedAttribute, value: focused)
    }
}

// MARK: - Tab Operations

extension AXElement {
    /// Gets tabs from a tab group or window
    public var tabs: [AXElement]? {
        // First try the direct tabs attribute
        if let tabs = elements(for: kAXTabsAttribute) {
            return tabs
        }

        // For tab groups, try the AXTabs attribute
        if let tabs = elements(for: "AXTabs") {
            return tabs
        }

        return nil
    }

    /// Checks if this element is selected (for tabs)
    public var isSelected: Bool? {
        bool(for: kAXSelectedAttribute)
    }

    /// Sets the selected state
    @discardableResult
    public func setSelected(_ selected: Bool) -> AXError {
        setBool(kAXSelectedAttribute, value: selected)
    }
}
