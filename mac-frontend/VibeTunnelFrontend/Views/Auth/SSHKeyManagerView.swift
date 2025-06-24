import SwiftUI
import UniformTypeIdentifiers

struct SSHKeyManagerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var sshKeys: [SSHKey] = []
    @State private var isLoading = false
    @State private var error: Error?
    @State private var showAddKeySheet = false
    @State private var selectedKeyForRemoval: SSHKey?
    @State private var showRemoveConfirmation = false
    
    let onSelect: ((SSHKey) -> Void)?
    
    init(onSelect: ((SSHKey) -> Void)? = nil) {
        self.onSelect = onSelect
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("SSH Keys")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Spacer()
                
                Button("Add Key") {
                    showAddKeySheet = true
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
            .padding()
            .background(Theme.Colors.secondaryBackground)
            
            Divider()
            
            // Keys List
            if isLoading {
                LoadingView(message: "Loading SSH keys...")
                    .frame(maxHeight: .infinity)
            } else if sshKeys.isEmpty {
                EmptyStateView(
                    title: "No SSH Keys",
                    message: "Add an SSH key to authenticate with the server.",
                    systemImage: "key"
                )
                .frame(maxHeight: .infinity)
            } else {
                List(sshKeys) { key in
                    SSHKeyRow(key: key) {
                        selectedKeyForRemoval = key
                        showRemoveConfirmation = true
                    } onSelect: {
                        if let onSelect {
                            onSelect(key)
                        }
                    }
                }
                .listStyle(.inset)
            }
            
            // Error Display
            if let error {
                ErrorView(error: error, onRetry: {
                    Task {
                        await loadKeys()
                    }
                })
                    .padding()
            }
        }
        .frame(width: 600, height: 400)
        .background(Theme.Colors.background)
        .task {
            await loadKeys()
        }
        .sheet(isPresented: $showAddKeySheet) {
            AddSSHKeyView { _ in
                showAddKeySheet = false
                Task {
                    await loadKeys()
                }
            }
        }
        .alert("Remove SSH Key?", isPresented: $showRemoveConfirmation, presenting: selectedKeyForRemoval) { key in
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) {
                Task {
                    await removeKey(key)
                }
            }
        } message: { key in
            Text("Are you sure you want to remove the SSH key '\(key.displayName)'? This action cannot be undone.")
        }
    }
    
    @MainActor
    private func loadKeys() async {
        isLoading = true
        error = nil
        
        do {
            sshKeys = try await AuthService.shared.fetchSSHKeys()
        } catch {
            self.error = error
        }
        
        isLoading = false
    }
    
    @MainActor
    private func removeKey(_ key: SSHKey) async {
        do {
            try await AuthService.shared.removeSSHKey(id: key.id)
            await loadKeys()
        } catch {
            self.error = error
        }
    }
}

struct SSHKeyRow: View {
    let key: SSHKey
    let onRemove: () -> Void
    let onSelect: (() -> Void)?
    
    @State private var isHovered = false
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(key.displayName)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(.medium)
                
                HStack {
                    Label(key.type, systemImage: "lock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    Text("•")
                        .foregroundStyle(.tertiary)
                    
                    Text(key.fingerprint)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            
            Spacer()
            
            HStack(spacing: 8) {
                if let onSelect {
                    Button("Select") {
                        onSelect()
                    }
                    .controlSize(.small)
                }
                
                Button {
                    onRemove()
                } label: {
                    Image(systemName: "trash")
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .opacity(isHovered ? 1 : 0)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(isHovered ? Theme.Colors.tertiaryBackground : Color.clear)
        .cornerRadius(6)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovered = hovering
            }
        }
    }
}

struct AddSSHKeyView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var keyContent = ""
    @State private var passphrase = ""
    @State private var saveToKeychain = true
    @State private var isLoading = false
    @State private var error: Error?
    @State private var isDragging = false
    
    let onAdd: (SSHKey) -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Add SSH Key")
                .font(.title2)
                .fontWeight(.semibold)
            
            // Key Input
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Private Key")
                        .font(.headline)
                    
                    Spacer()
                    
                    Button("Choose File...") {
                        selectKeyFile()
                    }
                    .controlSize(.small)
                }
                
                ZStack {
                    TextEditor(text: $keyContent)
                        .font(.system(.body, design: .monospaced))
                        .frame(height: 200)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(isDragging ? Theme.Colors.accent : Color.gray.opacity(0.2), lineWidth: 2)
                        )
                    
                    if keyContent.isEmpty {
                        Text("Paste your private key here or drag a key file...")
                            .foregroundStyle(.tertiary)
                            .allowsHitTesting(false)
                    }
                }
                .onDrop(of: [.fileURL], isTargeted: $isDragging) { providers in
                    handleDrop(providers)
                }
            }
            
            // Passphrase
            VStack(alignment: .leading, spacing: 8) {
                Text("Passphrase")
                    .font(.headline)
                
                SecureField("Enter passphrase if key is encrypted", text: $passphrase)
                    .textFieldStyle(.roundedBorder)
            }
            
            // Keychain Option
            Toggle("Save to macOS Keychain", isOn: $saveToKeychain)
            
            // Error Display
            if let error {
                ErrorView(error: error, onRetry: {})
                    .transition(.opacity.combined(with: .scale))
            }
            
            // Action Buttons
            HStack(spacing: 12) {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
                
                Button("Add Key") {
                    addKey()
                }
                .keyboardShortcut(.return)
                .disabled(keyContent.isEmpty || isLoading)
                .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
        }
        .padding(30)
        .frame(width: 500)
        .background(Theme.Colors.secondaryBackground)
        .interactiveDismissDisabled(isLoading)
    }
    
    private func selectKeyFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = "Select an SSH private key file"
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ssh")
        
        if panel.runModal() == .OK, let url = panel.url {
            do {
                keyContent = try String(contentsOf: url, encoding: .utf8)
            } catch {
                self.error = error
            }
        }
    }
    
    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        
        _ = provider.loadObject(ofClass: URL.self) { url, error in
            guard let url = url else { return }
            
            DispatchQueue.main.async {
                do {
                    keyContent = try String(contentsOf: url, encoding: .utf8)
                } catch {
                    self.error = error
                }
            }
        }
        
        return true
    }
    
    private func addKey() {
        Task {
            isLoading = true
            error = nil
            
            do {
                let key = try await AuthService.shared.addSSHKey(
                    privateKey: keyContent,
                    passphrase: passphrase.isEmpty ? nil : passphrase,
                    saveToKeychain: saveToKeychain
                )
                
                onAdd(key)
            } catch {
                self.error = error
            }
            
            isLoading = false
        }
    }
}

#Preview("SSH Key Manager") {
    SSHKeyManagerView()
}

#Preview("Add SSH Key") {
    AddSSHKeyView { _ in }
}