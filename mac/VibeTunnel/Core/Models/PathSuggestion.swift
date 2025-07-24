import Foundation

/// Path suggestion model for autocomplete functionality
struct PathSuggestion: Identifiable, Equatable {
    let id = UUID()
    let name: String
    let path: String
    let type: SuggestionType
    let suggestion: String // The complete path to insert
    let isRepository: Bool
    let gitInfo: GitInfo?

    enum SuggestionType {
        case file
        case directory
    }
}
