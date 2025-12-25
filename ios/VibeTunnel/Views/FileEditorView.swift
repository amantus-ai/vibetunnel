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
            initialContent: initialContent))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Editor
                    ScrollView {
                        TextEditor(text: self.$viewModel.content)
                            .font(Theme.Typography.terminal(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground)
                            .scrollContentBackground(.hidden)
                            .padding()
                            .focused(self.$isTextEditorFocused)
                    }
                    .background(Theme.Colors.terminalBackground)

                    // Status bar
                    HStack(spacing: Theme.Spacing.medium) {
                        if self.viewModel.hasChanges {
                            Label("Modified", systemImage: "pencil.circle.fill")
                                .font(.caption)
                                .foregroundColor(Theme.Colors.warningAccent)
                        }

                        Spacer()

                        Text("\(self.viewModel.lineCount) lines")
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))

                        Text("•")
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.3))

                        Text("\(self.viewModel.content.count) chars")
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
                        alignment: .top)
                }
            }
            .navigationTitle(self.viewModel.filename)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        if self.viewModel.hasChanges {
                            self.showingDiscardAlert = true
                        } else {
                            self.dismiss()
                        }
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        Task {
                            await self.viewModel.save()
                            if !self.viewModel.showError {
                                self.dismiss()
                            }
                        }
                    }
                    .foregroundColor(Theme.Colors.successAccent)
                    .disabled(!self.viewModel.hasChanges && !self.viewModel.isNewFile)
                }
            }
            .alert("Discard Changes?", isPresented: self.$showingDiscardAlert) {
                Button("Discard", role: .destructive) {
                    self.dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You have unsaved changes. Are you sure you want to discard them?")
            }
            .alert("Error", isPresented: self.$viewModel.showError, presenting: self.viewModel.errorMessage) { _ in
                Button("OK") {}
            } message: { error in
                Text(error)
            }
        }
        .onAppear {
            self.isTextEditorFocused = true
        }
        .task {
            if !self.viewModel.isNewFile {
                await self.viewModel.loadFile()
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
        if self.isNewFile {
            return "New File"
        }
        return URL(fileURLWithPath: self.path).lastPathComponent
    }

    var hasChanges: Bool {
        self.content != self.originalContent
    }

    var lineCount: Int {
        self.content.isEmpty ? 1 : self.content.components(separatedBy: .newlines).count
    }

    init(path: String, isNewFile: Bool, initialContent: String = "") {
        self.path = path
        self.isNewFile = isNewFile
        self.content = initialContent
        self.originalContent = initialContent
    }

    func loadFile() async {
        // File editing is not yet implemented in the backend
        self.errorMessage = "File editing is not available in the current server version"
        self.showError = true
    }

    func save() async {
        // File editing is not yet implemented in the backend
        self.errorMessage = "File editing is not available in the current server version"
        self.showError = true
        HapticFeedback.notification(.error)
    }
}

#Preview {
    FileEditorView(path: "/tmp/test.txt", isNewFile: true)
}
