import SwiftUI

@main
struct VibeTunnelApp: App {
    @StateObject private var connectionManager = ConnectionManager()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectionManager)
        }
    }
}

class ConnectionManager: ObservableObject {
    @Published var isConnected: Bool = false
    @Published var serverConfig: ServerConfig?
    
    init() {
        loadSavedConnection()
    }
    
    private func loadSavedConnection() {
        if let data = UserDefaults.standard.data(forKey: "savedServerConfig"),
           let config = try? JSONDecoder().decode(ServerConfig.self, from: data) {
            self.serverConfig = config
        }
    }
    
    func saveConnection(_ config: ServerConfig) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
            self.serverConfig = config
        }
    }
    
    func disconnect() {
        isConnected = false
    }
}