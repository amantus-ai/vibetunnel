import SwiftUI

struct LogsView: View {
    @State private var showLogViewer = false
    
    var body: some View {
        LogViewerWindow()
    }
}

#Preview {
    LogsView()
        .environment(ConnectionManager())
        .frame(width: 1000, height: 700)
}