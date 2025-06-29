import SwiftUI

private let logger = Logger(category: "FullscreenTextInput")

/// Full-screen text input overlay for better typing experience
struct FullscreenTextInput: View {
    @Binding var isPresented: Bool
    let onSubmit: (String) -> Void
    @State private var text: String = ""
    @FocusState private var isFocused: Bool
    @State private var showingOptions = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Text editor
                ScrollView {
                    TextEditor(text: $text)
                        .font(Theme.Typography.terminalSystem(size: 16))
                        .foregroundColor(Theme.Colors.terminalForeground)
                        .padding(Theme.Spacing.medium)
                        .background(Color.clear)
                        .focused($isFocused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .frame(minHeight: 200)
                }
                .background(Theme.Colors.cardBackground)
                .cornerRadius(Theme.CornerRadius.medium)
                .padding()

                // Quick actions
                HStack(spacing: Theme.Spacing.medium) {
                    // Template commands
                    Menu {
                        Button(action: { insertTemplate("ls -la") }, label: {
                            Label("List Files", systemImage: "folder")
                        })

                        Button(action: { insertTemplate("cd ") }, label: {
                            Label("Change Directory", systemImage: "arrow.right.square")
                        })

                        Button(action: { insertTemplate("git status") }, label: {
                            Label("Git Status", systemImage: "arrow.triangle.branch")
                        })

                        Button(action: { insertTemplate("sudo ") }, label: {
                            Label("Sudo Command", systemImage: "lock")
                        })

                        Divider()

                        Button(action: { insertTemplate("ssh ") }, label: {
                            Label("SSH Connect", systemImage: "network")
                        })

                        Button(action: { insertTemplate("docker ps") }, label: {
                            Label("Docker List", systemImage: "shippingbox")
                        })
                    } label: {
                        Label("Templates", systemImage: "text.badge.plus")
                            .font(Theme.Typography.terminalSystem(size: 14))
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    // Character count
                    Text("\(text.count) characters")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText)

                    // Clear button
                    if !text.isEmpty {
                        Button(action: {
                            text = ""
                            HapticFeedback.impact(.light)
                        }, label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(Theme.Colors.secondaryText)
                        })
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, Theme.Spacing.small)

                Divider()
                    .background(Theme.Colors.cardBorder)

                // Input options
                VStack(spacing: Theme.Spacing.small) {
                    // Common special characters
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Spacing.small) {
                            ForEach(["~", "/", "|", "&", ";", "&&", "||", ">", "<", ">>", "2>&1"], id: \.self) { char in
                                Button(action: { insertText(char) }, label: {
                                    Text(char)
                                        .font(Theme.Typography.terminalSystem(size: 14))
                                        .padding(.horizontal, Theme.Spacing.medium)
                                        .padding(.vertical, Theme.Spacing.small)
                                        .background(Theme.Colors.cardBackground)
                                        .cornerRadius(Theme.CornerRadius.small)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                                        )
                                })
                            }
                        }
                        .padding(.horizontal)
                    }

                    // Submit options
                    HStack(spacing: Theme.Spacing.medium) {
                        // Execute immediately
                        Button(action: {
                            submitAndClose()
                        }, label: {
                            HStack {
                                Image(systemName: "arrow.right.circle.fill")
                                Text("Execute")
                            }
                            .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                            .foregroundColor(.white)
                            .padding(.horizontal, Theme.Spacing.large)
                            .padding(.vertical, Theme.Spacing.medium)
                            .background(Theme.Colors.primaryAccent)
                            .cornerRadius(Theme.CornerRadius.medium)
                        })

                        // Insert without executing
                        Button(action: {
                            insertAndClose()
                        }, label: {
                            HStack {
                                Image(systemName: "text.insert")
                                Text("Insert")
                            }
                            .font(Theme.Typography.terminalSystem(size: 16))
                            .foregroundColor(Theme.Colors.primaryAccent)
                            .padding(.horizontal, Theme.Spacing.large)
                            .padding(.vertical, Theme.Spacing.medium)
                            .background(Theme.Colors.primaryAccent.opacity(0.1))
                            .cornerRadius(Theme.CornerRadius.medium)
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                    .stroke(Theme.Colors.primaryAccent, lineWidth: 1)
                            )
                        })
                    }
                    .padding(.horizontal)
                    .padding(.bottom, Theme.Spacing.medium)
                }
                .background(Theme.Colors.terminalBackground)
            }
            .navigationTitle("Compose Command")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        isPresented = false
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingOptions.toggle() }, label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundColor(Theme.Colors.primaryAccent)
                    })
                }
            }
        }
        .onAppear {
            isFocused = true
        }
    }

    private func insertText(_ text: String) {
        self.text.append(text)
        HapticFeedback.impact(.light)
    }

    private func insertTemplate(_ template: String) {
        self.text = template
        HapticFeedback.impact(.light)
    }

    private func submitAndClose() {
        if !text.isEmpty {
            onSubmit(text + "\n") // Add newline to execute
            HapticFeedback.impact(.medium)
        }
        isPresented = false
    }

    private func insertAndClose() {
        if !text.isEmpty {
            onSubmit(text) // Don't add newline, just insert
            HapticFeedback.impact(.light)
        }
        isPresented = false
    }
}

// MARK: - Preview

#Preview {
    FullscreenTextInput(isPresented: .constant(true)) { text in
        logger.debug("Submitted: \(text)")
    }
}
