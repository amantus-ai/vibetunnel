import SwiftUI

/// System logs viewer with filtering and search capabilities
struct SystemLogsView: View {
    @Environment(\.dismiss)
    var dismiss
    @State private var logs = ""
    @State private var isLoading = true
    @State private var presentedError: IdentifiableError?
    @State private var searchText = ""
    @State private var selectedLevel: LogLevel = .all
    @State private var showClientLogs = true
    @State private var showServerLogs = true
    @State private var autoScroll = true
    @State private var refreshTimer: Timer?
    @State private var showingClearConfirmation = false
    @State private var logsInfo: LogsInfo?

    enum LogLevel: String, CaseIterable {
        case all = "All"
        case error = "Error"
        case warn = "Warn"
        case log = "Log"
        case debug = "Debug"

        var displayName: String { rawValue }

        func matches(_ line: String) -> Bool {
            switch self {
            case .all:
                true
            case .error:
                line.localizedCaseInsensitiveContains("[ERROR]") ||
                    line.localizedCaseInsensitiveContains("error:")
            case .warn:
                line.localizedCaseInsensitiveContains("[WARN]") ||
                    line.localizedCaseInsensitiveContains("warning:")
            case .log:
                line.localizedCaseInsensitiveContains("[LOG]") ||
                    line.localizedCaseInsensitiveContains("log:")
            case .debug:
                line.localizedCaseInsensitiveContains("[DEBUG]") ||
                    line.localizedCaseInsensitiveContains("debug:")
            }
        }
    }

    var filteredLogs: String {
        let lines = self.logs.components(separatedBy: .newlines)
        let filtered = lines.filter { line in
            // Skip empty lines
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return false }

            // Filter by level
            if self.selectedLevel != .all && !self.selectedLevel.matches(line) {
                return false
            }

            // Filter by source
            let isClientLog = line.contains("[Client]") || line.contains("client:")
            let isServerLog = line.contains("[Server]") || line.contains("server:") || !isClientLog

            if !self.showClientLogs, isClientLog {
                return false
            }
            if !self.showServerLogs, isServerLog {
                return false
            }

            // Filter by search text
            if !self.searchText.isEmpty, !line.localizedCaseInsensitiveContains(self.searchText) {
                return false
            }

            return true
        }

        return filtered.joined(separator: "\n")
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Filters toolbar
                    self.filtersToolbar

                    // Search bar
                    self.searchBar

                    // Logs content
                    if self.isLoading {
                        ProgressView("Loading logs...")
                            .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if self.presentedError != nil {
                        ContentUnavailableView {
                            Label("Failed to Load Logs", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text("The logs could not be loaded. Please try again.")
                        } actions: {
                            Button("Retry") {
                                Task {
                                    await self.loadLogs()
                                }
                            }
                            .terminalButton()
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        self.logsContent
                    }
                }
            }
            .navigationTitle("System Logs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        self.dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: self.downloadLogs) {
                            Label("Download", systemImage: "square.and.arrow.down")
                        }

                        Button(action: { self.showingClearConfirmation = true }, label: {
                            Label("Clear Logs", systemImage: "trash")
                        })

                        Toggle("Auto-scroll", isOn: self.$autoScroll)

                        if let info = logsInfo {
                            Section {
                                Label(self.formatFileSize(info.size), systemImage: "doc")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
            }
        }
        .task {
            await self.loadLogs()
            self.startAutoRefresh()
        }
        .onDisappear {
            self.stopAutoRefresh()
        }
        .alert("Clear Logs", isPresented: self.$showingClearConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Clear", role: .destructive) {
                Task {
                    await self.clearLogs()
                }
            }
        } message: {
            Text("Are you sure you want to clear all system logs? This action cannot be undone.")
        }
        .errorAlert(item: self.$presentedError)
    }

    private var filtersToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Level filter
                Menu {
                    ForEach(LogLevel.allCases, id: \.self) { level in
                        Button(action: { self.selectedLevel = level }, label: {
                            HStack {
                                Text(level.displayName)
                                if self.selectedLevel == level {
                                    Image(systemName: "checkmark")
                                }
                            }
                        })
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "line.horizontal.3.decrease.circle")
                        Text(self.selectedLevel.displayName)
                    }
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(6)
                }

                // Source toggles
                Toggle("Client", isOn: self.$showClientLogs)
                    .toggleStyle(ChipToggleStyle())

                Toggle("Server", isOn: self.$showServerLogs)
                    .toggleStyle(ChipToggleStyle())

                Spacer()
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 8)
        .background(Theme.Colors.cardBackground)
    }

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))

            TextField("Search logs...", text: self.$searchText)
                .textFieldStyle(PlainTextFieldStyle())
                .font(Theme.Typography.terminalSystem(size: 14))
                .foregroundColor(Theme.Colors.terminalForeground)
                .autocapitalization(.none)
                .disableAutocorrection(true)

            if !self.searchText.isEmpty {
                Button(action: { self.searchText = "" }, label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                })
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Theme.Colors.terminalDarkGray)
    }

    private var logsContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(self.filteredLogs.isEmpty ? "No logs matching filters" : self.filteredLogs)
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.terminalForeground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .textSelection(.enabled)
                    .id("bottom")
            }
            .background(Theme.Colors.terminalDarkGray)
            .onChange(of: self.filteredLogs) { _, _ in
                if self.autoScroll {
                    withAnimation {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
        }
    }

    private func loadLogs() async {
        self.isLoading = true
        self.presentedError = nil

        do {
            // Load logs content
            self.logs = try await APIClient.shared.getLogsRaw()

            // Load logs info
            self.logsInfo = try await APIClient.shared.getLogsInfo()

            self.isLoading = false
        } catch {
            self.presentedError = IdentifiableError(error: error)
            self.isLoading = false
        }
    }

    private func clearLogs() async {
        do {
            try await APIClient.shared.clearLogs()
            self.logs = ""
            await self.loadLogs()
        } catch {
            self.presentedError = IdentifiableError(error: error)
        }
    }

    private func downloadLogs() {
        // Create activity controller with logs
        let activityVC = UIActivityViewController(
            activityItems: [logs],
            applicationActivities: nil)

        // Present it
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController
        {
            rootVC.present(activityVC, animated: true)
        }
    }

    private func startAutoRefresh() {
        self.refreshTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            Task {
                await self.loadLogs()
            }
        }
    }

    private func stopAutoRefresh() {
        self.refreshTimer?.invalidate()
        self.refreshTimer = nil
    }

    private func formatFileSize(_ size: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter.string(fromByteCount: size)
    }
}

/// Custom toggle style for filter chips
/// Custom toggle style resembling a selectable chip.
/// Provides a compact, button-like appearance for filter toggles.
struct ChipToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(action: { configuration.isOn.toggle() }, label: {
            HStack(spacing: 4) {
                if configuration.isOn {
                    Image(systemName: "checkmark")
                        .font(.caption2)
                }
                configuration.label
            }
            .font(.caption)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(configuration.isOn ? Theme.Colors.primaryAccent.opacity(0.2) : Theme.Colors.cardBackground)
            .foregroundColor(configuration.isOn ? Theme.Colors.primaryAccent : Theme.Colors.terminalForeground)
            .cornerRadius(6)
        })
        .buttonStyle(PlainButtonStyle())
    }
}
