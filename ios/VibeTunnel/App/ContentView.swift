import SwiftUI
import UniformTypeIdentifiers

/// Root content view that manages the main app navigation.
/// Displays either the connection view or session list based on
/// connection state, and handles opening cast files.
struct ContentView: View {
    @Environment(ConnectionManager.self)
    var connectionManager
    @State private var showingFilePicker = false
    @State private var showingCastPlayer = false
    @State private var selectedCastFile: URL?
    @State private var isValidatingConnection = true
    @State private var showingWelcome = false
    @AppStorage("welcomeCompleted")
    private var welcomeCompleted = false

    var body: some View {
        Group {
            if self.isValidatingConnection, self.connectionManager.isConnected {
                // Show loading while validating restored connection
                VStack(spacing: Theme.Spacing.large) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                        .scaleEffect(1.5)

                    Text("Restoring connection...")
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.terminalForeground)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.Colors.terminalBackground)
            } else if self.connectionManager.isConnected, self.connectionManager.serverConfig != nil {
                SessionListView()
            } else {
                ServerListView()
            }
        }
        .animation(.default, value: self.connectionManager.isConnected)
        .onAppear {
            self.validateRestoredConnection()

            // Show welcome on first launch
            if !self.welcomeCompleted {
                self.showingWelcome = true
            }
        }
        .fullScreenCover(isPresented: self.$showingWelcome) {
            WelcomeView()
        }
        .onOpenURL { url in
            // Handle cast file opening
            if url.pathExtension == "cast" {
                self.selectedCastFile = url
                self.showingCastPlayer = true
            }
        }
        .sheet(isPresented: self.$showingCastPlayer) {
            if let castFile = selectedCastFile {
                CastPlayerView(castFileURL: castFile)
            }
        }
    }

    private func validateRestoredConnection() {
        guard self.connectionManager.isConnected,
              self.connectionManager.serverConfig != nil
        else {
            self.isValidatingConnection = false
            return
        }

        // Test the restored connection
        Task {
            do {
                // Try to fetch sessions to validate connection
                _ = try await APIClient.shared.getSessions()
                // Connection is valid
                await MainActor.run {
                    self.isValidatingConnection = false
                }
            } catch {
                // Connection failed, reset state
                await MainActor.run {
                    Task {
                        await self.connectionManager.disconnect()
                    }
                    self.isValidatingConnection = false
                }
            }
        }
    }
}
