import Foundation

func isRunningPreviews() -> Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] != nil
}
