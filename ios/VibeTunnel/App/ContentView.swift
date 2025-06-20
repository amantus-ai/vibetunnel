import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    
    var body: some View {
        Group {
            if connectionManager.isConnected, connectionManager.serverConfig != nil {
                SessionListView()
            } else {
                ConnectionView()
            }
        }
        .animation(.default, value: connectionManager.isConnected)
    }
}