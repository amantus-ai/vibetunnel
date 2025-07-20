import SwiftUI

/// View that displays autocomplete suggestions in a dropdown
struct AutocompleteView: View {
    let suggestions: [AutocompleteService.PathSuggestion]
    @Binding var selectedIndex: Int
    let onSelect: (String) -> Void

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
                                .id(index)
                                .onHover { hovering in
                                    if hovering {
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
                    if newIndex >= 0 && newIndex < suggestions.count {
                        withAnimation(.easeInOut(duration: 0.1)) {
                            proxy.scrollTo(newIndex, anchor: .center)
                        }
                    }
                }
            }
        }
        .background(.regularMaterial)
        .cornerRadius(6)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
    }
}

private struct AutocompleteRow: View {
    let suggestion: AutocompleteService.PathSuggestion
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

                // Name
                Text(suggestion.name)
                    .font(.system(size: 12))
                    .foregroundColor(.primary)
                    .lineLimit(1)

                Spacer()

                // Path hint
                Text(suggestion.path)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
                    .frame(maxWidth: 120)
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
    @StateObject private var autocompleteService = AutocompleteService()
    @State private var showSuggestions = false
    @State private var selectedIndex = -1
    @FocusState private var isFocused: Bool
    @State private var debounceTask: Task<Void, Never>?
    @State private var justSelectedCompletion = false

    var body: some View {
        VStack(spacing: 4) {
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
                    }
                }

            if showSuggestions && !autocompleteService.suggestions.isEmpty {
                AutocompleteView(
                    suggestions: autocompleteService.suggestions,
                    selectedIndex: $selectedIndex
                ) { suggestion in
                    justSelectedCompletion = true
                    text = suggestion
                    showSuggestions = false
                    selectedIndex = -1
                    autocompleteService.clearSuggestions()
                }
                .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: showSuggestions)
    }

    private func handleKeyPress(_ keyPress: KeyPress) -> KeyPress.Result {
        guard showSuggestions && !autocompleteService.suggestions.isEmpty else {
            return .ignored
        }

        switch keyPress.key {
        case .downArrow:
            selectedIndex = min(selectedIndex + 1, autocompleteService.suggestions.count - 1)
            return .handled

        case .upArrow:
            selectedIndex = max(selectedIndex - 1, -1)
            return .handled

        case .tab, .return:
            if selectedIndex >= 0 && selectedIndex < autocompleteService.suggestions.count {
                justSelectedCompletion = true
                text = autocompleteService.suggestions[selectedIndex].suggestion
                showSuggestions = false
                selectedIndex = -1
                autocompleteService.clearSuggestions()
                return .handled
            }
            return .ignored

        case .escape:
            if showSuggestions {
                showSuggestions = false
                selectedIndex = -1
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

        // Reset selection when text changes
        selectedIndex = -1

        guard !newValue.isEmpty else {
            showSuggestions = false
            autocompleteService.clearSuggestions()
            return
        }

        // Debounce the autocomplete request
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000) // 300ms

            if !Task.isCancelled {
                await autocompleteService.fetchSuggestions(for: newValue)

                await MainActor.run {
                    if !autocompleteService.suggestions.isEmpty {
                        showSuggestions = true
                        // Auto-select first item if it's a good match
                        if let first = autocompleteService.suggestions.first,
                           first.name.lowercased().hasPrefix(
                               newValue.split(separator: "/").last?.lowercased() ?? ""
                           )
                        {
                            selectedIndex = 0
                        }
                    } else {
                        showSuggestions = false
                    }
                }
            }
        }
    }
}
