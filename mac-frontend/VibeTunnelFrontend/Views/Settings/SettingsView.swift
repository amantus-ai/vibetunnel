import SwiftUI

struct SettingsView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @AppStorage("terminalFontSize") private var terminalFontSize = 13.0
    @AppStorage("terminalColumnWidth") private var terminalColumnWidth = 80
    @AppStorage("showExitedSessionsByDefault") private var showExitedSessionsByDefault = true
    
    var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem {
                    Label("General", systemImage: "gear")
                }
            
            TerminalSettingsView()
                .tabItem {
                    Label("Terminal", systemImage: "terminal")
                }
            
            NotificationSettingsView()
                .tabItem {
                    Label("Notifications", systemImage: "bell")
                }
            
            ConnectionSettingsView()
                .tabItem {
                    Label("Connection", systemImage: "network")
                }
                .environment(connectionManager)
        }
        .frame(width: 600, height: 500)
    }
}

struct GeneralSettingsView: View {
    @AppStorage("showExitedSessionsByDefault") private var showExitedSessionsByDefault = true
    @AppStorage("autoRefreshInterval") private var autoRefreshInterval = 3.0
    
    var body: some View {
        Form {
            Section {
                Toggle("Show exited sessions by default", isOn: $showExitedSessionsByDefault)
                
                HStack {
                    Text("Auto-refresh interval:")
                    Slider(value: $autoRefreshInterval, in: 1...10, step: 1)
                    Text("\(Int(autoRefreshInterval))s")
                        .monospacedDigit()
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

struct TerminalSettingsView: View {
    @AppStorage("terminalFontSize") private var terminalFontSize = 13.0
    @AppStorage("terminalColumnWidth") private var terminalColumnWidth = 80
    @AppStorage("terminalRenderer") private var terminalRenderer = "buffer"
    
    var body: some View {
        Form {
            Section {
                HStack {
                    Text("Font size:")
                    Slider(value: $terminalFontSize, in: 10...24, step: 1)
                    Text("\(Int(terminalFontSize))pt")
                        .monospacedDigit()
                }
                
                Picker("Default column width:", selection: $terminalColumnWidth) {
                    Text("80 columns").tag(80)
                    Text("100 columns").tag(100)
                    Text("120 columns").tag(120)
                    Text("160 columns").tag(160)
                    Text("Unlimited").tag(0)
                }
                
                Picker("Terminal renderer:", selection: $terminalRenderer) {
                    Text("Buffer Protocol (Recommended)").tag("buffer")
                    Text("SwiftTerm").tag("swiftterm")
                    Text("xterm.js (Web)").tag("xterm")
                    Text("Native (NSTextView)").tag("native")
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

struct ConnectionSettingsView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    
    var body: some View {
        Form {
            Section {
                if let serverConfig = connectionManager.serverConfig {
                    LabeledContent("Server URL:") {
                        Text(serverConfig.displayName)
                            .textSelection(.enabled)
                    }
                    
                    LabeledContent("Authentication:") {
                        Text(serverConfig.authHeader != nil ? "Configured" : "None")
                    }
                    
                    Button("Disconnect") {
                        connectionManager.disconnect()
                    }
                    .foregroundStyle(Theme.Colors.error)
                } else {
                    Text("Not connected")
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

#Preview {
    SettingsView()
        .environment(ConnectionManager())
}