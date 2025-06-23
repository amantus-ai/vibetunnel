import Foundation
import Testing
@testable import VibeTunnel

@Suite("FileInfo Tests", .tags(.models))
struct FileInfoTests {

    @Test("Encode and decode FileInfo")
    func encodeDecodeFileInfo() throws {
        let fileInfo = FileInfo(
            name: "test.txt",
            path: "/home/user/test.txt",
            isDir: false,
            size: 1024,
            mode: "0644",
            modTime: Date(timeIntervalSince1970: 1234567890),
            mimeType: "text/plain",
            readable: true,
            executable: false
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(fileInfo)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decodedFileInfo = try decoder.decode(FileInfo.self, from: data)

        #expect(decodedFileInfo.name == fileInfo.name)
        #expect(decodedFileInfo.path == fileInfo.path)
        #expect(decodedFileInfo.isDir == fileInfo.isDir)
        #expect(decodedFileInfo.size == fileInfo.size)
        #expect(decodedFileInfo.mode == fileInfo.mode)
        #expect(decodedFileInfo.modTime == fileInfo.modTime)
        #expect(decodedFileInfo.mimeType == fileInfo.mimeType)
        #expect(decodedFileInfo.readable == fileInfo.readable)
        #expect(decodedFileInfo.executable == fileInfo.executable)
    }

    @Test("Decode from JSON with snake_case keys")
    func decodeFromJSONWithSnakeCase() throws {
        let json = """
        {
            "name": "directory",
            "path": "/home/user/directory",
            "is_dir": true,
            "size": 4096,
            "mode": "0755",
            "mod_time": "2023-12-25T10:30:00Z",
            "mime_type": "inode/directory",
            "readable": true,
            "executable": true
        }
        """

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let fileInfo = try decoder.decode(FileInfo.self, from: data)

        #expect(fileInfo.name == "directory")
        #expect(fileInfo.path == "/home/user/directory")
        #expect(fileInfo.isDir == true)
        #expect(fileInfo.size == 4096)
        #expect(fileInfo.mode == "0755")
        #expect(fileInfo.mimeType == "inode/directory")
        #expect(fileInfo.readable == true)
        #expect(fileInfo.executable == true)

        // Check date was parsed correctly
        let expectedDate = ISO8601DateFormatter().date(from: "2023-12-25T10:30:00Z")!
        #expect(fileInfo.modTime == expectedDate)
    }

    @Test("Various file types")
    func variousFileTypes() throws {
        // Regular file
        let textFile = FileInfo(
            name: "document.txt",
            path: "/docs/document.txt",
            isDir: false,
            size: 2048,
            mode: "0644",
            modTime: Date(),
            mimeType: "text/plain",
            readable: true,
            executable: false
        )
        #expect(textFile.isDir == false)
        #expect(textFile.mimeType == "text/plain")

        // Directory
        let directory = FileInfo(
            name: "folder",
            path: "/home/folder",
            isDir: true,
            size: 4096,
            mode: "0755",
            modTime: Date(),
            mimeType: "inode/directory",
            readable: true,
            executable: true
        )
        #expect(directory.isDir == true)
        #expect(directory.executable == true)

        // Executable file
        let executable = FileInfo(
            name: "script.sh",
            path: "/bin/script.sh",
            isDir: false,
            size: 512,
            mode: "0755",
            modTime: Date(),
            mimeType: "application/x-sh",
            readable: true,
            executable: true
        )
        #expect(executable.executable == true)
        #expect(executable.mimeType == "application/x-sh")

        // Hidden file
        let hiddenFile = FileInfo(
            name: ".gitignore",
            path: "/project/.gitignore",
            isDir: false,
            size: 128,
            mode: "0644",
            modTime: Date(),
            mimeType: "text/plain",
            readable: true,
            executable: false
        )
        #expect(hiddenFile.name.hasPrefix("."))
        #expect(hiddenFile.executable == false)
    }

    @Test("Edge cases")
    func edgeCases() throws {
        // Empty file
        let emptyFile = FileInfo(
            name: "empty.txt",
            path: "/tmp/empty.txt",
            isDir: false,
            size: 0,
            mode: "0644",
            modTime: Date(),
            mimeType: "text/plain",
            readable: true,
            executable: false
        )
        #expect(emptyFile.size == 0)

        // File with special characters in name
        let specialFile = FileInfo(
            name: "file with spaces & symbols!@#.txt",
            path: "/home/user/file with spaces & symbols!@#.txt",
            isDir: false,
            size: 100,
            mode: "0644",
            modTime: Date(),
            mimeType: "text/plain",
            readable: true,
            executable: false
        )
        #expect(specialFile.name.contains(" "))
        #expect(specialFile.name.contains("&"))
        #expect(specialFile.name.contains("!"))

        // Unreadable file
        let unreadableFile = FileInfo(
            name: "protected.dat",
            path: "/system/protected.dat",
            isDir: false,
            size: 1024,
            mode: "0000",
            modTime: Date(),
            mimeType: "application/octet-stream",
            readable: false,
            executable: false
        )
        #expect(unreadableFile.readable == false)
        #expect(unreadableFile.mode == "0000")

        // Large file
        let largeFile = FileInfo(
            name: "huge.bin",
            path: "/data/huge.bin",
            isDir: false,
            size: Int64.max - 1, // Near maximum size
            mode: "0644",
            modTime: Date(),
            mimeType: "application/octet-stream",
            readable: true,
            executable: false
        )
        #expect(largeFile.size == Int64.max - 1)
    }

    @Test("JSON encoding produces correct keys")
    func jsonEncodingKeys() throws {
        let fileInfo = FileInfo(
            name: "test.json",
            path: "/test.json",
            isDir: false,
            size: 256,
            mode: "0644",
            modTime: Date(timeIntervalSince1970: 1234567890),
            mimeType: "application/json",
            readable: true,
            executable: false
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(fileInfo)
        let jsonString = String(data: data, encoding: .utf8)!

        // Verify snake_case keys are used
        #expect(jsonString.contains("\"is_dir\":"))
        #expect(jsonString.contains("\"mod_time\":"))
        #expect(jsonString.contains("\"mime_type\":"))

        // Verify regular keys
        #expect(jsonString.contains("\"name\":"))
        #expect(jsonString.contains("\"path\":"))
        #expect(jsonString.contains("\"size\":"))
        #expect(jsonString.contains("\"mode\":"))
        #expect(jsonString.contains("\"readable\":"))
        #expect(jsonString.contains("\"executable\":"))
    }
}
