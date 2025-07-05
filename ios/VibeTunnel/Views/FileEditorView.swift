import Observation
import SwiftUI

/// File editor view for creating and editing text files.
struct FileEditorView: View {
    @Environment(\.dismiss)
    private var dismiss
    @State private var viewModel: FileEditorViewModel
    @State private var showingSaveAlert = false
    @State private var showingDiscardAlert = false
    @FocusState private var isTextEditorFocused: Bool

    init(path: String, isNewFile: Bool = false, initialContent: String = "") {
        self._viewModel = State(initialValue: FileEditorViewModel(
            path: path,
            isNewFile: isNewFile,
            initialContent: initialContent
        ))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Editor
                    ScrollView {
                        TextEditor(text: $viewModel.content)
                            .font(Theme.Typography.terminal(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground)
                            .scrollContentBackground(.hidden)
                            .padding()
                            .focused($isTextEditorFocused)
                    }
                    .background(Theme.Colors.terminalBackground)

                    // Status bar
                    HStack(spacing: Theme.Spacing.medium) {
                        if viewModel.hasChanges {
                            Label("Modified", systemImage: "pencil.circle.fill")
                                .font(.caption)
                                .foregroundColor(Theme.Colors.warningAccent)
                        }

                        Spacer()

                        Text("\(viewModel.lineCount) lines")
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))

                        Text("•")
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.3))

                        Text("\(viewModel.content.count) chars")
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                    }
                    .padding(.horizontal)
                    .padding(.vertical, Theme.Spacing.small)
                    .background(Theme.Colors.cardBackground)
                    .overlay(
                        Rectangle()
                            .fill(Theme.Colors.cardBorder)
                            .frame(height: 1),
                        alignment: .top
                    )
                }
            }
            .navigationTitle(viewModel.filename)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        if viewModel.hasChanges {
                            showingDiscardAlert = true
                        } else {
                            dismiss()
                        }
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        Task {
                            await viewModel.save()
                            if !viewModel.showError {
                                dismiss()
                            }
                        }
                    }
                    .foregroundColor(Theme.Colors.successAccent)
                    .disabled(!viewModel.hasChanges && !viewModel.isNewFile)
                }
            }
            .alert("Discard Changes?", isPresented: $showingDiscardAlert) {
                Button("Discard", role: .destructive) {
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You have unsaved changes. Are you sure you want to discard them?")
            }
            .alert("Error", isPresented: $viewModel.showError, presenting: viewModel.errorMessage) { _ in
                Button("OK") {}
            } message: { error in
                Text(error)
            }
        }
        .onAppear {
            isTextEditorFocused = true
        }
        .task {
            if !viewModel.isNewFile {
                await viewModel.loadFile()
            }
        }
    }
}

/// View model for file editing operations.
/// View model for file editing operations.
/// Handles file loading, saving, and content management.
@MainActor
@Observable
class FileEditorViewModel {
    var content = ""
    var originalContent = ""
    var isLoading = false
    var showError = false
    var errorMessage: String?

    let path: String
    let isNewFile: Bool

    var filename: String {
        if isNewFile {
            return "New File"
        }
        return URL(fileURLWithPath: path).lastPathComponent
    }

    var hasChanges: Bool {
        content != originalContent
    }

    var lineCount: Int {
        content.isEmpty ? 1 : content.components(separatedBy: .newlines).count
    }

    init(path: String, isNewFile: Bool, initialContent: String = "") {
        self.path = path
        self.isNewFile = isNewFile
        self.content = initialContent
        self.originalContent = initialContent
    }

    func loadFile() async {
        // File editing is not yet implemented in the backend
        errorMessage = "File editing is not available in the current server version"
        showError = true
    }

    func save() async {
        // File editing is not yet implemented in the backend
        errorMessage = "File editing is not available in the current server version"
        showError = true
        HapticFeedback.notification(.error)
    }
}

#Preview {
    FileEditorView(path: "/tmp/test.txt", isNewFile: true)
}
