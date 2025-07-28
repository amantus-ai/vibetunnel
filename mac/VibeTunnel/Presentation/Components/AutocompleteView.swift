import os.log
import SwiftUI

private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "AutocompleteView")

/// View that displays autocomplete suggestions in a dropdown
struct AutocompleteView: View {
    let suggestions: [PathSuggestion]
    @Binding var selectedIndex: Int
    let onSelect: (String) -> Void

    var body: some View {
        AutocompleteViewWithKeyboard(
            suggestions: suggestions,
            selectedIndex: $selectedIndex,
            keyboardNavigating: false,
            onSelect: onSelect
        )
    }
}

/// View that displays autocomplete suggestions with keyboard navigation support
struct AutocompleteViewWithKeyboard: View {
    let suggestions: [PathSuggestion]
    @Binding var selectedIndex: Int
    let keyboardNavigating: Bool
    let onSelect: (String) -> Void

    @State private var lastKeyboardState = false
    @State private var mouseHoverTriggered = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, suggestion in
                            AutocompleteRow(
                                suggestion: suggestion,
                                isSelected: index == selectedIndex
                            ) { onSelect(suggestion.suggestion) }
                                .id(suggestion.id)
                                .onHover { hovering in
                                    if hovering {
                                        mouseHoverTriggered = true
                                        selectedIndex = index
                                    }
                                }

                            if index < suggestions.count - 1 {
                                Divider()
                                    .padding(.horizontal, 8)
                            }
                        }
                    }
                }
                .frame(maxHeight: 200)
                .onChange(of: selectedIndex) { _, newIndex in
                    // Only animate scroll when using keyboard navigation, not mouse hover
                    if newIndex >= 0 && newIndex < suggestions.count && keyboardNavigating && !mouseHoverTriggered {
                        withAnimation(.easeInOut(duration: 0.1)) {
                            proxy.scrollTo(newIndex, anchor: .center)
                        }
                    }
                    // Reset the mouse hover flag after processing
                    mouseHoverTriggered = false
                }
                .onChange(of: keyboardNavigating) { _, newValue in
                    lastKeyboardState = newValue
                }
            }
        }
        .background(
            ZStack {
                // Base opaque layer
                Color(NSColor.windowBackgroundColor)
                // Material overlay for visual consistency
                Color.primary.opacity(0.02)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
    }
}

private struct AutocompleteRow: View {
    let suggestion: PathSuggestion
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                // Icon
                Image(systemName: iconName)
                    .font(.system(size: 12))
                    .foregroundColor(iconColor)
                    .frame(width: 16)

                // Name and Git info
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(suggestion.name)
                            .font(.system(size: 12))
                            .foregroundColor(.primary)
                            .lineLimit(1)

                        // Git status badges
                        if let gitInfo = suggestion.gitInfo {
                            HStack(spacing: 4) {
                                // Branch name
                                if let branch = gitInfo.branch {
                                    Text("[\(branch)]")
                                        .font(.system(size: 10))
                                        .foregroundColor(gitInfo.isWorktree ? .purple : .secondary)
                                }

                                // Ahead/behind indicators
                                if let ahead = gitInfo.aheadCount, ahead > 0 {
                                    HStack(spacing: 2) {
                                        Image(systemName: "arrow.up")
                                            .font(.system(size: 8))
                                        Text("\(ahead)")
                                            .font(.system(size: 10))
                                    }
                                    .foregroundColor(.green)
                                }

                                if let behind = gitInfo.behindCount, behind > 0 {
                                    HStack(spacing: 2) {
                                        Image(systemName: "arrow.down")
                                            .font(.system(size: 8))
                                        Text("\(behind)")
                                            .font(.system(size: 10))
                                    }
                                    .foregroundColor(.orange)
                                }

                                // Changes indicator
                                if gitInfo.hasChanges {
                                    Image(systemName: "circle.fill")
                                        .font(.system(size: 6))
                                        .foregroundColor(.yellow)
                                }
                            }
                        }
                    }
                }

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isSelected ? Color.accentColor.opacity(0.1) : Color.clear
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(
            HStack {
                if isSelected {
                    Rectangle()
                        .fill(Color.accentColor)
                        .frame(width: 2)
                }
                Spacer()
            }
        )
    }

    private var iconName: String {
        if suggestion.isRepository {
            "folder.badge.gearshape"
        } else if suggestion.type == .directory {
            "folder"
        } else {
            "doc"
        }
    }

    private var iconColor: Color {
        if suggestion.isRepository {
            .accentColor
        } else {
            .secondary
        }
    }
}

/// TextField with autocomplete functionality
struct AutocompleteTextField: View {
    @Binding var text: String
    let placeholder: String
    @Environment(GitRepositoryMonitor.self) private var gitMonitor

    @Environment(WorktreeService.self) private var worktreeService
    @State private var autocompleteService: AutocompleteService?
    @State private var showSuggestions = false
    @State private var selectedIndex = -1
    @FocusState private var isFocused: Bool
    @State private var debounceTask: Task<Void, Never>?
    @State private var justSelectedCompletion = false
    @State private var keyboardNavigating = false

    @State private var textFieldSize: CGSize = .zero

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.roundedBorder)
            .focused($isFocused)
            .onKeyPress { keyPress in
                handleKeyPress(keyPress)
            }
            .onChange(of: text) { _, newValue in
                handleTextChange(newValue)
            }
            .onChange(of: isFocused) { _, focused in
                if !focused {
                    // Hide suggestions after a delay to allow clicking
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        showSuggestions = false
                        selectedIndex = -1
                    }
                } else if focused && !text.isEmpty && !(autocompleteService?.suggestions.isEmpty ?? true) {
                    // Show suggestions when field gains focus if we have any
                    showSuggestions = true
                }
            }
            .background(
                GeometryReader { geometry in
                    Color.clear
                        .onAppear {
                            textFieldSize = geometry.size
                        }
                        .onChange(of: geometry.size) { _, newSize in
                            textFieldSize = newSize
                        }
                }
            )
            .background(
                AutocompleteWindowView(
                    suggestions: autocompleteService?.suggestions ?? [],
                    selectedIndex: $selectedIndex,
                    keyboardNavigating: keyboardNavigating,
                    onSelect: { suggestion in
                        justSelectedCompletion = true
                        text = suggestion
                        showSuggestions = false
                        selectedIndex = -1
                        autocompleteService?.clearSuggestions()
                        // Keep focus on the text field
                        DispatchQueue.main.async {
                            isFocused = true
                        }
                    },
                    width: textFieldSize.width,
                    isShowing: Binding(
                        get: { showSuggestions && isFocused && !(autocompleteService?.suggestions.isEmpty ?? true) },
                        set: { showSuggestions = $0 }
                    )
                )
            )
            .onAppear {
                // Initialize autocompleteService with GitRepositoryMonitor
                autocompleteService = AutocompleteService(gitMonitor: gitMonitor)
            }
    }

    private func handleKeyPress(_ keyPress: KeyPress) -> KeyPress.Result {
        guard isFocused && showSuggestions && !(autocompleteService?.suggestions.isEmpty ?? true) else {
            return .ignored
        }

        switch keyPress.key {
        case .downArrow:
            keyboardNavigating = true
            selectedIndex = min(selectedIndex + 1, (autocompleteService?.suggestions.count ?? 0) - 1)
            return .handled

        case .upArrow:
            keyboardNavigating = true
            selectedIndex = max(selectedIndex - 1, -1)
            return .handled

        case .tab, .return:
            if selectedIndex >= 0 && selectedIndex < (autocompleteService?.suggestions.count ?? 0) {
                justSelectedCompletion = true
                text = autocompleteService?.suggestions[selectedIndex].suggestion ?? ""
                showSuggestions = false
                selectedIndex = -1
                autocompleteService?.clearSuggestions()
                keyboardNavigating = false
                return .handled
            }
            return .ignored

        case .escape:
            if showSuggestions {
                showSuggestions = false
                selectedIndex = -1
                keyboardNavigating = false
                return .handled
            }
            return .ignored

        default:
            return .ignored
        }
    }

    private func handleTextChange(_ newValue: String) {
        // If we just selected a completion, don't trigger a new search
        if justSelectedCompletion {
            justSelectedCompletion = false
            return
        }

        // Cancel previous debounce
        debounceTask?.cancel()

        // Reset selection and keyboard navigation flag when text changes
        selectedIndex = -1
        keyboardNavigating = false

        guard !newValue.isEmpty else {
            // Hide suggestions when text is empty
            showSuggestions = false
            autocompleteService?.clearSuggestions()
            return
        }

        // Show suggestions immediately if we already have them and field is focused, they'll update when new ones
        // arrive
        if isFocused && !(autocompleteService?.suggestions.isEmpty ?? true) {
            showSuggestions = true
        }

        // Debounce the autocomplete request
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 100_000_000) // 100ms - reduced for better responsiveness

            if !Task.isCancelled {
                await autocompleteService?.fetchSuggestions(for: newValue)

                await MainActor.run {
                    // Update suggestion visibility based on results - only show if focused
                    if isFocused && !(autocompleteService?.suggestions.isEmpty ?? true) {
                        showSuggestions = true
                        logger.debug("Updated with \(autocompleteService?.suggestions.count ?? 0) suggestions")

                        // Try to maintain selection if possible
                        if selectedIndex >= (autocompleteService?.suggestions.count ?? 0) {
                            selectedIndex = -1
                        }

                        // Auto-select first item if it's a good match and nothing is selected
                        if selectedIndex == -1,
                           let first = autocompleteService?.suggestions.first,
                           first.name.lowercased().hasPrefix(
                               newValue.split(separator: "/").last?.lowercased() ?? ""
                           )
                        {
                            selectedIndex = 0
                        }
                    } else if showSuggestions {
                        // Only hide if we're already showing and have no results
                        showSuggestions = false
                    }
                }
            }
        }
    }
}
