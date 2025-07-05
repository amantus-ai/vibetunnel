import Foundation
import QuickLook
import SwiftUI

/// Manager for previewing files using iOS QuickLook framework.
/// Handles file downloads and presentation of preview controllers.
@MainActor
class QuickLookManager: NSObject, ObservableObject {
    static let shared = QuickLookManager()

    @Published var isPresenting = false
    @Published var downloadProgress: Double = 0
    @Published var isDownloading = false

    private var previewItems: [QLPreviewItem] = []
    private var currentFile: FileEntry?
    private let temporaryDirectory: URL

    override init() {
        // Create a temporary directory for downloaded files
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("QuickLookCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        self.temporaryDirectory = tempDir
        super.init()

        // Clean up old files on init
        cleanupTemporaryFiles()
    }

    func previewFile(_ file: FileEntry, apiClient: APIClient) async throws {
        guard !file.isDir else {
            throw QuickLookError.isDirectory
        }

        currentFile = file
        isDownloading = true
        downloadProgress = 0

        do {
            let localURL = try await downloadFileForPreview(file: file, apiClient: apiClient)

            // Create preview item
            let previewItem = PreviewItem(url: localURL, title: file.name)
            previewItems = [previewItem]

            isDownloading = false
            isPresenting = true
        } catch {
            isDownloading = false
            throw error
        }
    }

    private func downloadFileForPreview(file: FileEntry, apiClient: APIClient) async throws -> URL {
        // Check if file is already cached
        let cachedURL = temporaryDirectory.appendingPathComponent(file.name)

        // For now, always download fresh (could implement proper caching later)
        if FileManager.default.fileExists(atPath: cachedURL.path) {
            try FileManager.default.removeItem(at: cachedURL)
        }

        // Download the file
        let data = try await apiClient.downloadFile(path: file.path) { progress in
            Task { @MainActor in
                self.downloadProgress = progress
            }
        }

        // Save to temporary location
        try data.write(to: cachedURL)

        return cachedURL
    }

    func cleanupTemporaryFiles() {
        // Remove files older than 1 hour
        let oneHourAgo = Date().addingTimeInterval(-3_600)

        guard let files = try? FileManager.default.contentsOfDirectory(
            at: temporaryDirectory,
            includingPropertiesForKeys: [.creationDateKey]
        ) else {
            return
        }

        for file in files {
            if let creationDate = try? file.resourceValues(forKeys: [.creationDateKey]).creationDate,
               creationDate < oneHourAgo
            {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }

    func makePreviewController() -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = self
        controller.delegate = self
        return controller
    }
}

// MARK: - QLPreviewControllerDataSource

extension QuickLookManager: QLPreviewControllerDataSource {
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewItems.count
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        previewItems[index]
    }
}

// MARK: - QLPreviewControllerDelegate

extension QuickLookManager: QLPreviewControllerDelegate {
    nonisolated func previewControllerDidDismiss(_ controller: QLPreviewController) {
        Task { @MainActor in
            isPresenting = false
            previewItems = []
            currentFile = nil
        }
    }
}

// MARK: - Preview Item

/// Wrapper class for QuickLook preview items.
/// Provides URL and title for files to be previewed.
private class PreviewItem: NSObject, QLPreviewItem {
    let previewItemURL: URL?
    let previewItemTitle: String?

    init(url: URL, title: String) {
        self.previewItemURL = url
        self.previewItemTitle = title
    }
}

// MARK: - Errors

/// Errors that can occur during QuickLook operations.
/// Provides specific error cases for preview failures.
enum QuickLookError: LocalizedError {
    case isDirectory
    case downloadFailed
    case unsupportedFileType

    var errorDescription: String? {
        switch self {
        case .isDirectory:
            "Cannot preview directories"
        case .downloadFailed:
            "Failed to download file"
        case .unsupportedFileType:
            "This file type cannot be previewed"
        }
    }
}
