import Foundation
import Combine

@MainActor
final class FileSystemService: ObservableObject {
    static let shared = FileSystemService()
    
    private let decoder = JSONDecoder()
    
    private init() {
        decoder.dateDecodingStrategy = .iso8601
    }
    
    func browseDirectory(path: String, showHidden: Bool = false, gitFilter: String = "all") async throws -> DirectoryListing {
        guard let baseURL = UserDefaults.standard.url(forKey: "serverURL") else {
            throw NSError(domain: "FileSystemService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Server URL not configured"])
        }
        
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/fs/browse"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "path", value: path),
            URLQueryItem(name: "showHidden", value: String(showHidden)),
            URLQueryItem(name: "gitFilter", value: gitFilter)
        ]
        
        guard let url = components.url else {
            throw NSError(domain: "FileSystemService", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            if let httpResponse = response as? HTTPURLResponse {
                if let errorData = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let errorMessage = errorData["error"] as? String {
                    throw NSError(domain: "FileSystemService", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: errorMessage])
                }
                throw NSError(domain: "FileSystemService", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: "Failed to load directory"])
            }
            throw NSError(domain: "FileSystemService", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }
        
        return try decoder.decode(DirectoryListing.self, from: data)
    }
    
    func previewFile(path: String) async throws -> FilePreview {
        guard let baseURL = UserDefaults.standard.url(forKey: "serverURL") else {
            throw NSError(domain: "FileSystemService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Server URL not configured"])
        }
        
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/fs/preview"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        
        guard let url = components.url else {
            throw NSError(domain: "FileSystemService", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw NSError(domain: "FileSystemService", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to preview file"])
        }
        
        return try decoder.decode(FilePreview.self, from: data)
    }
    
    func getDiff(path: String) async throws -> FileDiff {
        guard let baseURL = UserDefaults.standard.url(forKey: "serverURL") else {
            throw NSError(domain: "FileSystemService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Server URL not configured"])
        }
        
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/fs/diff"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        
        guard let url = components.url else {
            throw NSError(domain: "FileSystemService", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw NSError(domain: "FileSystemService", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to get diff"])
        }
        
        return try decoder.decode(FileDiff.self, from: data)
    }
    
    func getDiffContent(path: String) async throws -> FileDiffContent {
        guard let baseURL = UserDefaults.standard.url(forKey: "serverURL") else {
            throw NSError(domain: "FileSystemService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Server URL not configured"])
        }
        
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/fs/diff-content"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        
        guard let url = components.url else {
            throw NSError(domain: "FileSystemService", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw NSError(domain: "FileSystemService", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to get diff content"])
        }
        
        return try decoder.decode(FileDiffContent.self, from: data)
    }
}