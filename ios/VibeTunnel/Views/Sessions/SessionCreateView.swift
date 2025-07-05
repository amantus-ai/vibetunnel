import SwiftUI

private let logger = Logger(category: "SessionCreate")

/// Custom text field style for terminal-like appearance.
///
/// Applies terminal-themed styling to text fields including
/// monospace font, dark background, and subtle border.
struct TerminalTextFieldStyle: TextFieldStyle {
    // swiftlint:disable:next identifier_name
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(Theme.Typography.terminalSystem(size: 16))
            .foregroundColor(Theme.Colors.terminalForeground)
            .padding()
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .fill(Theme.Colors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
            )
    }
}

/// View for creating new terminal sessions.
///
/// Provides form inputs for command, working directory, and session name
/// with file browser integration for directory selection.
struct SessionCreateView: View {
    @Binding var isPresented: Bool
    let onCreated: (String) -> Void

    @State private var command = "zsh"
    @State private var workingDirectory = "~/"
    @State private var sessionName = ""
    @State private var isCreating = false
    @State private var presentedError: IdentifiableError?
    @State private var showFileBrowser = false

    @FocusState private var focusedField: Field?
    @Environment(\.horizontalSizeClass)
    private var horizontalSizeClass

    enum Field {
        case command
        case workingDir
        case name
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: Theme.Spacing.large) {
                        // Configuration Fields
                        VStack(spacing: Theme.Spacing.large) {
                            // Command Field
                            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                                Label("Command", systemImage: "terminal")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.primaryAccent)

                                TextField("zsh", text: $command)
                                    .textFieldStyle(TerminalTextFieldStyle())
                                    .autocapitalization(.none)
                                    .disableAutocorrection(true)
                                    .focused($focusedField, equals: .command)
                            }

                            // Working Directory
                            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                                Label("Working Directory", systemImage: "folder")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.primaryAccent)

                                HStack(spacing: Theme.Spacing.small) {
                                    TextField("~/", text: $workingDirectory)
                                        .textFieldStyle(TerminalTextFieldStyle())
                                        .autocapitalization(.none)
                                        .disableAutocorrection(true)
                                        .focused($focusedField, equals: .workingDir)

                                    Button(action: {
                                        HapticFeedback.impact(.light)
                                        showFileBrowser = true
                                    }, label: {
                                        Image(systemName: "folder")
                                            .font(.system(size: 16))
                                            .foregroundColor(Theme.Colors.primaryAccent)
                                            .frame(width: 44, height: 44)
                                            .background(
                                                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                                    .fill(Theme.Colors.primaryAccent)
                                            )
                                    })
                                    .buttonStyle(PlainButtonStyle())
                                }
                            }

                            // Session Name
                            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                                Label("Session Name (Optional)", systemImage: "tag")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.primaryAccent)

                                TextField("My Session", text: $sessionName)
                                    .textFieldStyle(TerminalTextFieldStyle())
                                    .focused($focusedField, equals: .name)
                            }

                            // Error Message
                            if presentedError != nil {
                                ErrorBanner(
                                    message: presentedError?.error.localizedDescription ?? "An error occurred"
                                ) {
                                    presentedError = nil
                                }
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                        .stroke(Theme.Colors.errorAccent.opacity(0.3), lineWidth: 1)
                                )
                                .transition(.asymmetric(
                                    insertion: .scale(scale: 0.95).combined(with: .opacity),
                                    removal: .scale(scale: 0.95).combined(with: .opacity)
                                ))
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, Theme.Spacing.large)

                        // Quick Directories
                        if focusedField == .workingDir {
                            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                                Text("COMMON DIRECTORIES")
                                    .font(Theme.Typography.terminalSystem(size: 10))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                    .tracking(1)
                                    .padding(.horizontal)

                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: Theme.Spacing.small) {
                                        ForEach(commonDirectories, id: \.self) { dir in
                                            Button(action: {
                                                workingDirectory = dir
                                                HapticFeedback.selection()
                                            }, label: {
                                                HStack(spacing: 4) {
                                                    Image(systemName: "folder.fill")
                                                        .font(.system(size: 12))
                                                    Text(dir)
                                                        .font(Theme.Typography.terminalSystem(size: 13))
                                                }
                                                .foregroundColor(workingDirectory == dir ? Theme.Colors
                                                    .terminalBackground : Theme.Colors.terminalForeground
                                                )
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 8)
                                                .background(
                                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                        .fill(workingDirectory == dir ? Theme.Colors
                                                            .primaryAccent : Theme.Colors.cardBorder.opacity(0.1)
                                                        )
                                                )
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                                        .stroke(
                                                            workingDirectory == dir ? Theme.Colors.primaryAccent : Theme
                                                                .Colors.cardBorder.opacity(0.3),
                                                            lineWidth: 1
                                                        )
                                                )
                                            })
                                            .buttonStyle(PlainButtonStyle())
                                        }
                                    }
                                    .padding(.horizontal)
                                }
                            }
                        }

                        // Quick Start Commands
                        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                            Text("QUICK START")
                                .font(Theme.Typography.terminalSystem(size: 11))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.4))
                                .tracking(0.5)
                                .padding(.horizontal)

                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ], spacing: Theme.Spacing.small) {
                                ForEach(quickStartCommands, id: \.title) { item in
                                    Button(action: {
                                        command = item.command
                                        HapticFeedback.selection()
                                    }, label: {
                                        HStack(spacing: Theme.Spacing.small) {
                                            Image(systemName: item.icon)
                                                .font(.system(size: 16))
                                                .frame(width: 20)
                                            Text(item.title)
                                                .font(Theme.Typography.terminalSystem(size: 15))
                                            Spacer()
                                        }
                                        .foregroundColor(command == item.command ? Theme.Colors
                                            .terminalBackground : Theme.Colors
                                            .terminalForeground
                                        )
                                        .padding(.horizontal, Theme.Spacing.medium)
                                        .padding(.vertical, 14)
                                        .background(
                                            RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                                .fill(command == item.command ? Theme.Colors.primaryAccent : Theme
                                                    .Colors
                                                    .cardBackground
                                                )
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                                .stroke(
                                                    command == item.command ? Theme.Colors.primaryAccent : Theme.Colors
                                                        .cardBorder.opacity(0.3),
                                                    lineWidth: 1
                                                )
                                        )
                                    })
                                    .buttonStyle(PlainButtonStyle())
                                }
                            }
                            .padding(.horizontal)
                        }

                        Spacer(minLength: 40)
                    }
                    .frame(maxWidth: horizontalSizeClass == .regular ? 600 : .infinity)
                    .frame(maxWidth: .infinity)
                }
            }
            .navigationBarHidden(true)
            .safeAreaInset(edge: .top) {
                // Custom Navigation Bar with proper safe area handling
                ZStack {
                    // Background with blur and transparency
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .background(Theme.Colors.terminalBackground.opacity(0.5))

                    // Content
                    HStack {
                        Button(action: {
                            HapticFeedback.impact(.light)
                            isPresented = false
                        }, label: {
                            Text("Cancel")
                                .font(.system(size: 17))
                                .foregroundColor(Theme.Colors.errorAccent)
                        })
                        .buttonStyle(PlainButtonStyle())

                        Spacer()

                        Text("New Session")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(Theme.Colors.terminalForeground)

                        Spacer()

                        Button(action: {
                            HapticFeedback.impact(.medium)
                            createSession()
                        }, label: {
                            if isCreating {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                                    .scaleEffect(0.8)
                            } else {
                                Text("Create")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundColor(command.isEmpty ? Theme.Colors.primaryAccent.opacity(0.5) : Theme
                                        .Colors.primaryAccent
                                    )
                            }
                        })
                        .buttonStyle(PlainButtonStyle())
                        .disabled(isCreating || command.isEmpty)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .frame(height: 56) // Fixed height for the header
                .overlay(
                    // Subtle bottom border
                    Rectangle()
                        .fill(Theme.Colors.cardBorder.opacity(0.15))
                        .frame(height: 0.5),
                    alignment: .bottom
                )
            }
            .onAppear {
                loadDefaults()
                focusedField = .command
            }
        }
        .sheet(isPresented: $showFileBrowser) {
            FileBrowserView(initialPath: workingDirectory) { selectedPath in
                workingDirectory = selectedPath
                HapticFeedback.notification(.success)
            }
        }
        .errorAlert(item: $presentedError)
    }

    private struct QuickStartItem {
        let title: String
        let command: String
        let icon: String
    }

    private var quickStartCommands: [QuickStartItem] {
        [
            QuickStartItem(title: "claude", command: "claude", icon: "sparkle"),
            QuickStartItem(title: "gemini", command: "gemini", icon: "sparkle"),
            QuickStartItem(title: "zsh", command: "zsh", icon: "terminal"),
            QuickStartItem(title: "python3", command: "python3", icon: "chevron.left.forwardslash.chevron.right"),
            QuickStartItem(title: "node", command: "node", icon: "server.rack"),
            QuickStartItem(title: "npm run dev", command: "npm run dev", icon: "play.circle")
        ]
    }

    private var commonDirectories: [String] {
        ["~/", "~/Desktop", "~/Documents", "~/Downloads", "~/Projects", "/tmp"]
    }

    private func commandIcon(for command: String) -> String {
        switch command {
        case "gemini":
            "sparkle"
        case "claude":
            "sparkle"
        case "zsh", "bash":
            "terminal"
        case "python3":
            "chevron.left.forwardslash.chevron.right"
        case "node":
            "server.rack"
        case "npm run dev":
            "play.circle"
        case "irb":
            "diamond"
        default:
            "terminal"
        }
    }

    private func loadDefaults() {
        // Load last used values matching web behavior
        if let lastCommand = UserDefaults.standard.string(forKey: "vibetunnel_last_command"), !lastCommand.isEmpty {
            command = lastCommand
        } else {
            // Default to zsh
            command = "zsh"
        }
        if let lastDir = UserDefaults.standard.string(forKey: "vibetunnel_last_working_dir"), !lastDir.isEmpty {
            workingDirectory = lastDir
        } else {
            // Default to home directory
            workingDirectory = "~/"
        }

        // Match the web's selectedQuickStart behavior
        if quickStartCommands.contains(where: { $0.command == command }) {
            // Command matches a quick start option
        }
    }

    private func createSession() {
        isCreating = true
        presentedError = nil

        // Save preferences matching web localStorage keys
        UserDefaults.standard.set(command, forKey: "vibetunnel_last_command")
        UserDefaults.standard.set(workingDirectory, forKey: "vibetunnel_last_working_dir")

        Task {
            do {
                let sessionData = SessionCreateData(
                    command: command,
                    workingDir: workingDirectory.isEmpty ? "~" : workingDirectory,
                    name: sessionName.isEmpty ? nil : sessionName
                )

                // Log the request for debugging
                logger.info("Creating session with data:")
                logger.debug("  Command: \(sessionData.command)")
                logger.debug("  Working Dir: \(sessionData.workingDir)")
                logger.debug("  Name: \(sessionData.name ?? "nil")")
                logger.debug("  Spawn Terminal: \(sessionData.spawnTerminal ?? false)")
                logger.debug("  Cols: \(sessionData.cols ?? 0), Rows: \(sessionData.rows ?? 0)")

                let sessionId = try await SessionService().createSession(sessionData)

                logger.info("Session created successfully with ID: \(sessionId)")

                await MainActor.run {
                    onCreated(sessionId)
                    isPresented = false
                }
            } catch {
                logger.error("Failed to create session: \(error)")
                if let apiError = error as? APIError {
                    logger.error("  API Error: \(apiError)")
                }

                await MainActor.run {
                    presentedError = IdentifiableError(error: error)
                    isCreating = false
                }
            }
        }
    }
}
