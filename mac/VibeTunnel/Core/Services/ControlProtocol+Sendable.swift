import Foundation

/// Extension to make ControlMessage properly Sendable
extension ControlProtocol.ControlMessage: @unchecked Sendable {
    // The payload dictionary is not technically Sendable, but we control
    // its usage and ensure thread safety through actor isolation
}
