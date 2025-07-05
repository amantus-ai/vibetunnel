import SwiftUI

/// Form component for entering server connection details.
///
/// Provides input fields for host, port, and name
/// with validation and recent servers functionality.
struct ServerConfigForm: View {
    @Binding var host: String
    @Binding var port: String
    @Binding var name: String
    @Binding var username: String
    @Binding var password: String
    let isConnecting: Bool
    let errorMessage: String?
    let onConnect: () -> Void
    @State private var networkMonitor = NetworkMonitor.shared

    @FocusState private var focusedField: Field?
    @State private var recentServers: [ServerConfig] = []
    @State private var showingDiscoverySheet = false

    enum Field {
        case host
        case port
        case name
        case username
    }

    var body: some View {
        VStack(spacing: Theme.Spacing.extraLarge) {
            // Input Fields
            VStack(spacing: Theme.Spacing.large) {
                // Host/IP Field
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Label("Server Address", systemImage: "network")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent)

                    HStack(spacing: Theme.Spacing.small) {
                        TextField("192.168.1.100 or localhost", text: $host)
                            .textFieldStyle(TerminalTextFieldStyle())
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .focused($focusedField, equals: .host)
                            .submitLabel(.next)
                            .onSubmit {
                                focusedField = .port
                            }

                        Button {
                            showingDiscoverySheet = true
                            HapticFeedback.impact(.light)
                        } label: {
                            Image(systemName: "bonjour")
                                .font(.system(size: 16))
                                .foregroundColor(Theme.Colors.primaryAccent)
                                .frame(width: 44, height: 44)
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                        .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                                )
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }

                // Port Field
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Label("Port", systemImage: "number.circle")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent)

                    TextField("3000", text: $port)
                        .textFieldStyle(TerminalTextFieldStyle())
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .port)
                        .submitLabel(.next)
                        .onSubmit {
                            focusedField = .name
                        }
                }

                // Name Field (Optional)
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Label("Connection Name (Optional)", systemImage: "tag")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent)

                    TextField("My Mac", text: $name)
                        .textFieldStyle(TerminalTextFieldStyle())
                        .focused($focusedField, equals: .name)
                        .submitLabel(.next)
                        .onSubmit {
                            focusedField = .username
                        }
                }

                // Username Field (Optional - for authentication)
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Label("Username (Optional)", systemImage: "person")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent)

                    TextField("admin", text: $username)
                        .textFieldStyle(TerminalTextFieldStyle())
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .focused($focusedField, equals: .username)
                        .submitLabel(.done)
                        .onSubmit {
                            focusedField = nil
                            onConnect()
                        }
                }
            }
            .padding(.horizontal)

            // Error Message
            if let errorMessage {
                HStack(spacing: Theme.Spacing.small) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption)
                    Text(errorMessage)
                        .font(Theme.Typography.terminalSystem(size: 12))
                }
                .foregroundColor(Theme.Colors.errorAccent)
                .padding(.horizontal)
                .transition(.asymmetric(
                    insertion: .scale.combined(with: .opacity),
                    removal: .scale.combined(with: .opacity)
                ))
            }

            // Connect Button
            Button(action: {
                HapticFeedback.impact(.medium)
                onConnect()
            }, label: {
                if isConnecting {
                    HStack(spacing: Theme.Spacing.small) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalBackground))
                            .scaleEffect(0.8)
                        Text("Connecting...")
                            .font(Theme.Typography.terminalSystem(size: 16))
                    }
                    .frame(maxWidth: .infinity)
                } else if !networkMonitor.isConnected {
                    HStack(spacing: Theme.Spacing.small) {
                        Image(systemName: "wifi.slash")
                        Text("No Internet Connection")
                    }
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                } else {
                    HStack(spacing: Theme.Spacing.small) {
                        Image(systemName: "bolt.fill")
                        Text("Connect")
                    }
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                }
            })
            .foregroundColor(
                isConnecting || !networkMonitor.isConnected ? Theme.Colors.terminalForeground : Theme
                    .Colors.primaryAccent
            )
            .padding(.vertical, Theme.Spacing.medium)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(
                        isConnecting || !networkMonitor.isConnected ? Theme.Colors.cardBackground : Theme.Colors
                            .terminalBackground
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .stroke(
                        networkMonitor.isConnected ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                        lineWidth: isConnecting || !networkMonitor.isConnected ? 1 : 2
                    )
                    .opacity(host.isEmpty ? 0.5 : 1.0)
            )
            .disabled(isConnecting || host.isEmpty || !networkMonitor.isConnected)
            .padding(.horizontal)
            .scaleEffect(isConnecting ? 0.98 : 1.0)
            .animation(Theme.Animation.quick, value: isConnecting)
            .animation(Theme.Animation.quick, value: networkMonitor.isConnected)

            // Recent Servers (if any)
            if !recentServers.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Text("Recent Connections")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                        .padding(.horizontal)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Spacing.small) {
                            ForEach(recentServers.prefix(3), id: \.host) { server in
                                Button(action: {
                                    host = server.host
                                    port = String(server.port)
                                    name = server.name ?? ""
                                    HapticFeedback.selection()
                                }, label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(server.displayName)
                                            .font(Theme.Typography.terminalSystem(size: 12))
                                            .fontWeight(.medium)
                                        Text("\(server.host):\(server.port)")
                                            .font(Theme.Typography.terminalSystem(size: 10))
                                            .opacity(0.7)
                                    }
                                    .foregroundColor(Theme.Colors.terminalForeground)
                                    .padding(.horizontal, Theme.Spacing.medium)
                                    .padding(.vertical, Theme.Spacing.small)
                                    .background(
                                        RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                            .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                                    )
                                })
                                .buttonStyle(PlainButtonStyle())
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear {
            focusedField = .host
            loadRecentServers()
        }
        .sheet(isPresented: $showingDiscoverySheet) {
            ServerDiscoverySheet(
                selectedHost: $host,
                selectedPort: $port,
                selectedName: Binding<String?>(
                    get: { name.isEmpty ? nil : name },
                    set: { name = $0 ?? "" }
                )
            )
        }
    }

    private func loadRecentServers() {
        // Load recent servers from UserDefaults
        if let data = UserDefaults.standard.data(forKey: "recentServers"),
           let servers = try? JSONDecoder().decode([ServerConfig].self, from: data)
        {
            recentServers = servers
        }
    }
}
