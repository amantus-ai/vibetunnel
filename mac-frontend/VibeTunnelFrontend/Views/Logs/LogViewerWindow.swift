import SwiftUI
import UniformTypeIdentifiers

struct LogViewerWindow: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var logManager: LogStreamManager?
    @State private var searchText = ""
    @State private var selectedLevels: Set<LogEntry.LogLevel> = Set(LogEntry.LogLevel.allCases)
    @State private var showClient = true
    @State private var showServer = true
    @State private var autoScroll = true
    @State private var fontSize: Double = 11
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            LogViewerToolbar(
                searchText: $searchText,
                selectedLevels: $selectedLevels,
                showClient: $showClient,
                showServer: $showServer,
                autoScroll: $autoScroll,
                fontSize: $fontSize,
                logSize: logManager?.logSize ?? "",
                onClear: clearLogs,
                onExport: exportLogs,
                onClose: { dismiss() }
            )
            
            Divider()
            
            // Log list
            if logManager != nil {
                LogListView(
                    logs: filteredLogs,
                    fontSize: fontSize,
                    autoScroll: autoScroll
                )
            } else {
                LoadingView(message: "Connecting to log stream...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.Colors.terminalBackground)
            }
            
            Divider()
            
            // Footer
            HStack {
                Text("\(filteredLogs.count) / \(logManager?.logs.count ?? 0) logs")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.secondaryText)
                
                if let logSize = logManager?.logSize, !logSize.isEmpty {
                    Text("• \(logSize)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                
                Spacer()
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, Theme.Spacing.sm)
            .background(Theme.Colors.secondaryBackground)
        }
        .frame(minWidth: 900, minHeight: 600)
        .background(Theme.Colors.background)
        .onAppear {
            setupLogStream()
        }
        .onDisappear {
            logManager?.disconnect()
        }
    }
    
    private var filteredLogs: [LogEntry] {
        guard let logs = logManager?.logs else { return [] }
        
        return logs.filter { log in
            // Filter by level
            guard selectedLevels.contains(log.level) else { return false }
            
            // Filter by client/server
            if !showClient && log.isClient { return false }
            if !showServer && !log.isClient { return false }
            
            // Filter by search text
            if !searchText.isEmpty {
                let searchLower = searchText.lowercased()
                return log.module.lowercased().contains(searchLower) ||
                       log.message.lowercased().contains(searchLower)
            }
            
            return true
        }
    }
    
    private func setupLogStream() {
        guard let serverURL = connectionManager.serverURL else { return }
        
        let manager = LogStreamManager(
            serverURL: serverURL,
            authHeader: connectionManager.authHeader
        )
        
        self.logManager = manager
        manager.connect()
    }
    
    private func clearLogs() {
        Task {
            await logManager?.clearLogs()
        }
    }
    
    private func exportLogs() {
        guard let logs = logManager?.logs else { return }
        
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        
        var content = ""
        for log in logs {
            let timestamp = formatter.string(from: log.timestamp)
            let level = log.level.rawValue.uppercased()
            let module = log.isClient ? "CLIENT:\(log.module)" : log.module
            content += "\(timestamp) \(level) [\(module)] \(log.message)\n"
        }
        
        let savePanel = NSSavePanel()
        savePanel.allowedContentTypes = [.text]
        savePanel.nameFieldStringValue = "vibetunnel-logs-\(Date().formatted(.iso8601)).txt"
        
        if savePanel.runModal() == .OK, let url = savePanel.url {
            do {
                try content.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                // Handle error
                print("Failed to save logs: \(error)")
            }
        }
    }
}

struct LogViewerToolbar: View {
    @Binding var searchText: String
    @Binding var selectedLevels: Set<LogEntry.LogLevel>
    @Binding var showClient: Bool
    @Binding var showServer: Bool
    @Binding var autoScroll: Bool
    @Binding var fontSize: Double
    let logSize: String
    let onClear: () -> Void
    let onExport: () -> Void
    let onClose: () -> Void
    
    var body: some View {
        HStack {
            // Title
            Text("System Logs")
                .font(Theme.Typography.headline)
            
            Spacer()
            
            // Controls
            HStack(spacing: Theme.Spacing.md) {
                // Search
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Theme.Colors.secondaryText)
                    
                    TextField("Filter logs...", text: $searchText)
                        .textFieldStyle(.plain)
                        .frame(width: 200)
                }
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, 4)
                .background(Theme.Colors.secondaryBackground)
                .cornerRadius(Theme.Sizes.cornerRadius)
                
                Divider()
                    .frame(height: 20)
                
                // Level filters
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(LogEntry.LogLevel.allCases, id: \.self) { level in
                        Toggle(isOn: Binding(
                            get: { selectedLevels.contains(level) },
                            set: { isOn in
                                if isOn {
                                    selectedLevels.insert(level)
                                } else {
                                    selectedLevels.remove(level)
                                }
                            }
                        )) {
                            Text(level.label)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(
                                    selectedLevels.contains(level) ? Theme.Colors.terminalBackground : level.color
                                )
                        }
                        .toggleStyle(.button)
                        .buttonStyle(.borderedProminent)
                        .tint(level.color)
                        .controlSize(.small)
                    }
                }
                
                Divider()
                    .frame(height: 20)
                
                // Client/Server toggles
                Toggle("CLIENT", isOn: $showClient)
                    .toggleStyle(.button)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Colors.warning)
                    .controlSize(.small)
                
                Toggle("SERVER", isOn: $showServer)
                    .toggleStyle(.button)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Colors.accent)
                    .controlSize(.small)
                
                Divider()
                    .frame(height: 20)
                
                // Auto-scroll
                Toggle("AUTO SCROLL", isOn: $autoScroll)
                    .toggleStyle(.button)
                    .controlSize(.small)
                
                Divider()
                    .frame(height: 20)
                
                // Font size
                HStack(spacing: Theme.Spacing.xs) {
                    Button {
                        fontSize = max(9, fontSize - 1)
                    } label: {
                        Image(systemName: "textformat.size.smaller")
                    }
                    .buttonStyle(.plain)
                    
                    Text("\(Int(fontSize))pt")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .monospacedDigit()
                        .frame(width: 30)
                    
                    Button {
                        fontSize = min(16, fontSize + 1)
                    } label: {
                        Image(systemName: "textformat.size.larger")
                    }
                    .buttonStyle(.plain)
                }
                
                Divider()
                    .frame(height: 20)
                
                // Actions
                Button("Export", action: onExport)
                    .controlSize(.small)
                
                Button("Clear", action: onClear)
                    .controlSize(.small)
                    .tint(Theme.Colors.error)
                
                Button("Close", action: onClose)
                    .keyboardShortcut(.escape)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Theme.Colors.background)
    }
}

struct LogListView: View {
    let logs: [LogEntry]
    let fontSize: Double
    let autoScroll: Bool
    
    @State private var scrollViewID = UUID()
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(logs) { log in
                        LogRowView(log: log, fontSize: fontSize)
                            .id(log.id)
                    }
                    
                    // Invisible anchor for auto-scrolling
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(Theme.Spacing.sm)
            }
            .background(Theme.Colors.terminalBackground)
            .onChange(of: logs.count) { _, _ in
                if autoScroll {
                    withAnimation(.none) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
            .onAppear {
                if autoScroll {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }
}

struct LogRowView: View {
    let log: LogEntry
    let fontSize: Double
    
    private var isMultiline: Bool {
        log.message.contains("\n")
    }
    
    private var messageLines: [String] {
        log.message.components(separatedBy: .newlines)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                // Timestamp
                Text(formatTime(log.timestamp))
                    .font(.custom("SF Mono", size: fontSize))
                    .foregroundStyle(Theme.Colors.tertiaryText.opacity(0.6))
                    .frame(width: 60, alignment: .leading)
                
                // Level
                Text(log.level.label)
                    .font(.custom("SF Mono", size: fontSize).bold())
                    .foregroundStyle(log.level.color)
                    .frame(width: 30, alignment: .center)
                    .padding(.horizontal, 4)
                    .background(log.level.color.opacity(0.2))
                    .cornerRadius(2)
                
                // Source indicator
                Text(log.isClient ? "◆ C" : "▸ S")
                    .font(.custom("SF Mono", size: fontSize))
                    .foregroundStyle(log.isClient ? Theme.Colors.warning : Theme.Colors.accent)
                    .frame(width: 25)
                
                // Module
                Text(log.module)
                    .font(.custom("SF Mono", size: fontSize))
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .frame(minWidth: 100, alignment: .leading)
                
                // Separator
                Text("│")
                    .font(.custom("SF Mono", size: fontSize))
                    .foregroundStyle(Theme.Colors.tertiaryText.opacity(0.3))
                
                // Message (first line)
                Text(messageLines[0])
                    .font(.custom("SF Mono", size: fontSize))
                    .foregroundStyle(Theme.Colors.terminalText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            
            // Additional message lines
            if isMultiline {
                ForEach(Array(messageLines.dropFirst().enumerated()), id: \.offset) { _, line in
                    HStack {
                        Spacer()
                            .frame(width: 60 + 30 + 25 + 100 + Theme.Spacing.sm * 4 + 20)
                        
                        Text(line)
                            .font(.custom("SF Mono", size: fontSize))
                            .foregroundStyle(Theme.Colors.terminalText.opacity(0.8))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(.vertical, 1)
        .background(
            log.isClient ? Theme.Colors.warning.opacity(0.05) : Color.clear
        )
    }
    
    private func formatTime(_ date: Date) -> String {
        let now = Date()
        let diff = now.timeIntervalSince(date)
        
        if diff < 60 {
            return "\(Int(diff))s ago"
        } else if diff < 3600 {
            return "\(Int(diff / 60))m ago"
        } else if diff < 86400 {
            return "\(Int(diff / 3600))h ago"
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm:ss"
            return formatter.string(from: date)
        }
    }
}

#Preview {
    LogViewerWindow()
        .environment(ConnectionManager())
        .frame(width: 1000, height: 700)
}