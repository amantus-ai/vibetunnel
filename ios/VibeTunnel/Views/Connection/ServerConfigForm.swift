import SwiftUI

struct ServerConfigForm: View {
    @Binding var host: String
    @Binding var port: String
    @Binding var name: String
    let isConnecting: Bool
    let errorMessage: String?
    let onConnect: () -> Void
    
    @FocusState private var focusedField: Field?
    @State private var recentServers: [ServerConfig] = []
    
    enum Field {
        case host, port, name
    }
    
    var body: some View {
        VStack(spacing: Theme.Spacing.xl) {
            // Input Fields
            VStack(spacing: Theme.Spacing.lg) {
                // Host/IP Field
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Label("Server Address", systemImage: "network")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent)
                    
                    TextField("192.168.1.100 or localhost", text: $host)
                        .textFieldStyle(TerminalTextFieldStyle())
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .focused($focusedField, equals: .host)
                        .submitLabel(.next)
                        .onSubmit {
                            focusedField = .port
                        }
                }
                
                // Port Field
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
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
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Label("Connection Name (Optional)", systemImage: "tag")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.primaryAccent)
                    
                    TextField("My Mac", text: $name)
                        .textFieldStyle(TerminalTextFieldStyle())
                        .focused($focusedField, equals: .name)
                        .submitLabel(.done)
                        .onSubmit {
                            focusedField = nil
                            onConnect()
                        }
                }
            }
            .padding(.horizontal)
            
            // Error Message
            if let errorMessage = errorMessage {
                HStack(spacing: Theme.Spacing.sm) {
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
            }) {
                if isConnecting {
                    HStack(spacing: Theme.Spacing.sm) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalBackground))
                            .scaleEffect(0.8)
                        Text("Connecting...")
                            .font(Theme.Typography.terminalSystem(size: 16))
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    HStack(spacing: Theme.Spacing.sm) {
                        Image(systemName: "bolt.fill")
                        Text("Connect")
                    }
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                }
            }
            .foregroundColor(isConnecting ? Theme.Colors.terminalBackground : Theme.Colors.terminalForeground)
            .padding(.vertical, Theme.Spacing.md)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(isConnecting ? Theme.Colors.terminalForeground : Theme.Colors.primaryAccent)
                    .opacity(host.isEmpty ? 0.5 : 1.0)
            )
            .disabled(isConnecting || host.isEmpty)
            .padding(.horizontal)
            .scaleEffect(isConnecting ? 0.98 : 1.0)
            .animation(Theme.Animation.quick, value: isConnecting)
            
            // Recent Servers (if any)
            if !recentServers.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Text("Recent Connections")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                        .padding(.horizontal)
                    
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Spacing.sm) {
                            ForEach(recentServers.prefix(3), id: \Self.host) { server in
                                Button(action: {
                                    host = server.host
                                    port = String(server.port)
                                    name = server.name ?? ""
                                    HapticFeedback.selection()
                                }) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(server.displayName)
                                            .font(Theme.Typography.terminalSystem(size: 12))
                                            .fontWeight(.medium)
                                        Text("\(server.host):\(server.port)")
                                            .font(Theme.Typography.terminalSystem(size: 10))
                                            .opacity(0.7)
                                    }
                                    .foregroundColor(Theme.Colors.terminalForeground)
                                    .padding(.horizontal, Theme.Spacing.md)
                                    .padding(.vertical, Theme.Spacing.sm)
                                    .background(
                                        RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                            .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                                    )
                                }
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
    }
    
    private func loadRecentServers() {
        // Load recent servers from UserDefaults
        if let data = UserDefaults.standard.data(forKey: "recentServers"),
           let servers = try? JSONDecoder().decode([ServerConfig].self, from: data) {
            recentServers = servers
        }
    }
}

// Custom text field style
struct TerminalTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(Theme.Typography.terminalSystem(size: 16))
            .foregroundColor(Theme.Colors.terminalForeground)
            .padding(Theme.Spacing.md)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(Theme.Colors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .stroke(Theme.Colors.primaryAccent.opacity(0.3), lineWidth: 1)
            )
    }
}