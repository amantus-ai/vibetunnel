import Foundation
import Testing
@testable import VibeTunnel

@Suite("FileEntry Tests", .tags(.models))
struct FileEntryTests {

    @Test("File entry initialization")
    func fileEntryInit() {
        let fileEntry = FileEntry(
            name: "test.txt",
            path: "/home/user/test.txt",
            type: .file,
            size: 1024,
            permissions: "rw-r--r--",
            modifiedDate: Date(timeIntervalSince1970: 1700000000),
            owner: "user",
            group: "staff"
        )

        #expect(fileEntry.name == "test.txt")
        #expect(fileEntry.path == "/home/user/test.txt")
        #expect(fileEntry.type == .file)
        #expect(fileEntry.size == 1024)
        #expect(fileEntry.permissions == "rw-r--r--")
        #expect(fileEntry.owner == "user")
        #expect(fileEntry.group == "staff")
    }

    @Test("Directory entry initialization")
    func directoryEntryInit() {
        let dirEntry = FileEntry(
            name: "Documents",
            path: "/home/user/Documents",
            type: .directory,
            size: 4096,
            permissions: "rwxr-xr-x",
            modifiedDate: Date(),
            owner: "user",
            group: "staff"
        )

        #expect(dirEntry.type == .directory)
        #expect(dirEntry.isDirectory == true)
        #expect(dirEntry.isFile == false)
    }

    @Test("Symlink entry initialization")
    func symlinkEntryInit() {
        let linkEntry = FileEntry(
            name: "link",
            path: "/home/user/link",
            type: .symlink,
            size: 10,
            permissions: "lrwxrwxrwx",
            modifiedDate: Date()
        )

        #expect(linkEntry.type == .symlink)
        #expect(linkEntry.isDirectory == false)
        #expect(linkEntry.isFile == false)
    }

    @Test("File entry type helpers")
    func fileTypeHelpers() {
        let file = FileEntry(name: "file", path: "/file", type: .file, size: 100, permissions: "", modifiedDate: Date())
        let dir = FileEntry(name: "dir", path: "/dir", type: .directory, size: 4096, permissions: "", modifiedDate: Date())
        let link = FileEntry(name: "link", path: "/link", type: .symlink, size: 10, permissions: "", modifiedDate: Date())

        #expect(file.isFile == true)
        #expect(file.isDirectory == false)

        #expect(dir.isFile == false)
        #expect(dir.isDirectory == true)

        #expect(link.isFile == false)
        #expect(link.isDirectory == false)
    }

    @Test("File size formatting")
    func fileSizeFormatting() {
        #expect(FileEntry.formatSize(0) == "0 B")
        #expect(FileEntry.formatSize(512) == "512 B")
        #expect(FileEntry.formatSize(1024) == "1.0 KB")
        #expect(FileEntry.formatSize(1536) == "1.5 KB")
        #expect(FileEntry.formatSize(1048576) == "1.0 MB")
        #expect(FileEntry.formatSize(1572864) == "1.5 MB")
        #expect(FileEntry.formatSize(1073741824) == "1.0 GB")
        #expect(FileEntry.formatSize(1610612736) == "1.5 GB")
    }

    @Test("Icon names for file types")
    func iconNames() {
        let file = FileEntry(name: "file", path: "/file", type: .file, size: 100, permissions: "", modifiedDate: Date())
        let dir = FileEntry(name: "dir", path: "/dir", type: .directory, size: 4096, permissions: "", modifiedDate: Date())
        let link = FileEntry(name: "link", path: "/link", type: .symlink, size: 10, permissions: "", modifiedDate: Date())

        #expect(file.iconName == "doc")
        #expect(dir.iconName == "folder")
        #expect(link.iconName == "link")
    }

    @Test("Special file icons")
    func specialFileIcons() {
        let imageFile = FileEntry(name: "photo.jpg", path: "/photo.jpg", type: .file, size: 1000, permissions: "", modifiedDate: Date())
        let textFile = FileEntry(name: "readme.txt", path: "/readme.txt", type: .file, size: 100, permissions: "", modifiedDate: Date())
        let codeFile = FileEntry(name: "main.swift", path: "/main.swift", type: .file, size: 500, permissions: "", modifiedDate: Date())

        #expect(imageFile.iconName == "photo")
        #expect(textFile.iconName == "doc.text")
        #expect(codeFile.iconName == "doc.text")
    }

    @Test("File entry identifiable")
    func fileEntryIdentifiable() {
        let file1 = FileEntry(name: "test1.txt", path: "/test1.txt", type: .file, size: 100, permissions: "", modifiedDate: Date())
        let file2 = FileEntry(name: "test2.txt", path: "/test2.txt", type: .file, size: 100, permissions: "", modifiedDate: Date())

        #expect(file1.id == "/test1.txt")
        #expect(file2.id == "/test2.txt")
        #expect(file1.id != file2.id)
    }

    @Test("File entry equatable")
    func fileEntryEquatable() {
        let date = Date()
        let file1 = FileEntry(name: "test.txt", path: "/test.txt", type: .file, size: 100, permissions: "rw-r--r--", modifiedDate: date)
        let file2 = FileEntry(name: "test.txt", path: "/test.txt", type: .file, size: 100, permissions: "rw-r--r--", modifiedDate: date)
        let file3 = FileEntry(name: "other.txt", path: "/other.txt", type: .file, size: 100, permissions: "rw-r--r--", modifiedDate: date)

        #expect(file1 == file2)
        #expect(file1 != file3)
    }

    @Test("Codable encoding and decoding")
    func codable() throws {
        let original = FileEntry(
            name: "test.txt",
            path: "/home/user/test.txt",
            type: .file,
            size: 1024,
            permissions: "rw-r--r--",
            modifiedDate: Date(timeIntervalSince1970: 1700000000),
            owner: "user",
            group: "staff"
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(original)

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(FileEntry.self, from: data)

        #expect(decoded.name == original.name)
        #expect(decoded.path == original.path)
        #expect(decoded.type == original.type)
        #expect(decoded.size == original.size)
        #expect(decoded.permissions == original.permissions)
        #expect(decoded.owner == original.owner)
        #expect(decoded.group == original.group)
    }
}
