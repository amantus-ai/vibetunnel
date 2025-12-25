import Foundation
import Testing

@Suite("Path Splitting Tests")
struct PathSplittingTests {
    @Test("Path expansion with tilde")
    func pathExpansion() {
        // Test 1: Expanding "~/Pr"
        let shortPath = "~/Pr"
        let expandedPath = NSString(string: shortPath).expandingTildeInPath

        // Verify expansion
        #expect(expandedPath.hasPrefix("/"))
        #expect(expandedPath.contains("/Pr"))
        #expect(expandedPath == "\(NSHomeDirectory())/Pr")
    }

    @Test("URL handling of non-existent paths")
    func urlWithNonExistentPath() {
        // Test 2: How URL handles non-existent paths
        let nonExistentPath = NSString(string: "~/Pr").expandingTildeInPath
        let url = URL(fileURLWithPath: nonExistentPath)

        // Check file existence
        let fileManager = FileManager.default
        let exists = fileManager.fileExists(atPath: nonExistentPath)

        // URL is always created for any path (even non-existent ones)
        #expect(url.path == nonExistentPath)
        #expect(!exists)
    }

    @Test("Path components extraction", arguments: [
        "~/Pr",
        "/Users/steipete/Pr",
        "/Users/steipete/Projects",
        "/Users/steipete/Projects/vibetunnel"
    ])
    func pathComponents(path: String) {
        // Test 3: deletingLastPathComponent and lastPathComponent
        let url = URL(fileURLWithPath: path.starts(with: "~") ? NSString(string: path).expandingTildeInPath : path)
        let parent = url.deletingLastPathComponent()
        let lastComponent = url.lastPathComponent

        // Basic validation
        #expect(!lastComponent.isEmpty)
        #expect(parent.path.count <= url.path.count)
    }

    @Test("Special path cases")
    func specialCases() {
        // Test with trailing slash
        let pathWithSlash = "~/Pr/"
        let expandedWithSlash = NSString(string: pathWithSlash).expandingTildeInPath
        let urlWithSlash = URL(fileURLWithPath: expandedWithSlash)

        #expect(urlWithSlash.lastPathComponent == "Pr")

        // Test root directory
        let rootUrl = URL(fileURLWithPath: "/")
        #expect(rootUrl.path == "/")
        // Root URL's parent has differed across Foundation versions (/ or /..)
        #expect(["/", "/.."].contains(rootUrl.deletingLastPathComponent().path))
        // Root URL's last component is "/" on macOS
        #expect(rootUrl.lastPathComponent == "/")

        // Test single component after root
        let singleComponent = URL(fileURLWithPath: "/Users")
        #expect(singleComponent.path == "/Users")
        #expect(singleComponent.deletingLastPathComponent().path == "/")
        #expect(singleComponent.lastPathComponent == "Users")
    }

    @Test("Autocomplete scenario")
    func autocompleteScenario() throws {
        // Test the actual autocomplete scenario
        let input = "~/Pr"
        let expandedInput = NSString(string: input).expandingTildeInPath
        let inputURL = URL(fileURLWithPath: expandedInput)
        let parentURL = inputURL.deletingLastPathComponent()
        let prefix = inputURL.lastPathComponent

        #expect(prefix == "Pr")
        #expect(parentURL.path == NSHomeDirectory())

        // List contents of parent directory
        let fileManager = FileManager.default
        let contents = try #require(try? fileManager.contentsOfDirectory(
            at: parentURL,
            includingPropertiesForKeys: nil))

        let matching = contents.filter { $0.lastPathComponent.hasPrefix(prefix) }
        // We can't assert specific matches as they depend on the user's home directory
        // But we can verify the filtering logic works
        for item in matching {
            #expect(item.lastPathComponent.hasPrefix(prefix))
        }
    }
}
