import Foundation
import XCTest

final class PathSplittingTests: XCTestCase {
    func testPathExpansion() {
        // Test 1: Expanding "~/Pr"
        let shortPath = "~/Pr"
        let expandedPath = NSString(string: shortPath).expandingTildeInPath

        print("=== Test 1: Path Expansion ===")
        print("Original path: \(shortPath)")
        print("Expanded path: \(expandedPath)")
        print("Home directory: \(NSHomeDirectory())")

        // Verify expansion
        XCTAssertTrue(expandedPath.hasPrefix("/"))
        XCTAssertTrue(expandedPath.contains("/Pr"))
        XCTAssertEqual(expandedPath, "\(NSHomeDirectory())/Pr")
    }

    func testURLWithNonExistentPath() {
        // Test 2: How URL handles non-existent paths
        let nonExistentPath = NSString(string: "~/Pr").expandingTildeInPath
        let url = URL(fileURLWithPath: nonExistentPath)

        print("\n=== Test 2: URL with Non-Existent Path ===")
        print("Path: \(nonExistentPath)")
        print("URL: \(url)")
        print("URL path: \(url.path)")
        print("URL absolute string: \(url.absoluteString)")

        // Check file existence
        let fileManager = FileManager.default
        let exists = fileManager.fileExists(atPath: nonExistentPath)
        print("Path exists: \(exists)")

        // URL is still created even for non-existent paths
        XCTAssertNotNil(url)
        XCTAssertEqual(url.path, nonExistentPath)
    }

    func testPathComponents() {
        // Test 3: deletingLastPathComponent and lastPathComponent
        let testPaths = [
            "~/Pr",
            NSString(string: "~/Pr").expandingTildeInPath,
            "/Users/steipete/Pr",
            "/Users/steipete/Projects",
            "/Users/steipete/Projects/vibetunnel"
        ]

        print("\n=== Test 3: Path Components ===")

        for path in testPaths {
            let url = URL(fileURLWithPath: path.starts(with: "~") ? NSString(string: path).expandingTildeInPath : path)
            let parent = url.deletingLastPathComponent()
            let lastComponent = url.lastPathComponent

            print("\nPath: \(path)")
            print("  Expanded: \(url.path)")
            print("  Parent: \(parent.path)")
            print("  Last component: \(lastComponent)")
            print("  Parent exists: \(FileManager.default.fileExists(atPath: parent.path))")
        }
    }

    func testSpecialCases() {
        // Test edge cases
        print("\n=== Test 4: Special Cases ===")

        // Test with trailing slash
        let pathWithSlash = "~/Pr/"
        let expandedWithSlash = NSString(string: pathWithSlash).expandingTildeInPath
        let urlWithSlash = URL(fileURLWithPath: expandedWithSlash)

        print("\nPath with trailing slash: \(pathWithSlash)")
        print("  Expanded: \(expandedWithSlash)")
        print("  URL path: \(urlWithSlash.path)")
        print("  Last component: \(urlWithSlash.lastPathComponent)")

        // Test root directory
        let rootUrl = URL(fileURLWithPath: "/")
        print("\nRoot directory:")
        print("  Path: \(rootUrl.path)")
        print("  Parent: \(rootUrl.deletingLastPathComponent().path)")
        print("  Last component: \(rootUrl.lastPathComponent)")

        // Test single component after root
        let singleComponent = URL(fileURLWithPath: "/Users")
        print("\nSingle component (/Users):")
        print("  Path: \(singleComponent.path)")
        print("  Parent: \(singleComponent.deletingLastPathComponent().path)")
        print("  Last component: \(singleComponent.lastPathComponent)")
    }

    func testAutocompleteScenario() {
        // Test the actual autocomplete scenario
        print("\n=== Test 5: Autocomplete Scenario ===")

        let input = "~/Pr"
        let expandedInput = NSString(string: input).expandingTildeInPath
        let inputURL = URL(fileURLWithPath: expandedInput)
        let parentURL = inputURL.deletingLastPathComponent()
        let prefix = inputURL.lastPathComponent

        print("Input: \(input)")
        print("Expanded: \(expandedInput)")
        print("Parent directory: \(parentURL.path)")
        print("Prefix to match: \(prefix)")

        // List contents of parent directory
        let fileManager = FileManager.default
        if let contents = try? fileManager.contentsOfDirectory(at: parentURL, includingPropertiesForKeys: nil) {
            print("\nContents of \(parentURL.path):")
            let matching = contents.filter { $0.lastPathComponent.hasPrefix(prefix) }
            for item in matching {
                print("  - \(item.lastPathComponent)")
            }
        } else {
            print("Failed to list contents of parent directory")
        }
    }
}
