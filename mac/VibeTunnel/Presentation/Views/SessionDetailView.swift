import os
import SwiftUI

/// View displaying detailed information about a specific terminal session
struct SessionDetailView: View {
    let session: ServerSessionInfo
    @State private var windowTitle = ""

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SessionDetailView")

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Session Header
            VStack(alignment: .leading, spacing: 8) {
                Text("Session Details")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                HStack {
                    if let pid = session.pid {
                        Label("PID: \(pid)", systemImage: "number.circle.fill")
                            .font(.title3)
                    } else {
                        Label("PID: N/A", systemImage: "number.circle.fill")
                            .font(.title3)
                    }

                    Spacer()

                    StatusBadge(isRunning: session.isRunning)
                }
            }
            .padding(.bottom, 10)

            // Session Information
            VStack(alignment: .leading, spacing: 16) {
                DetailRow(label: "Session ID", value: session.id)
                DetailRow(label: "Command", value: session.command.joined(separator: " "))
                DetailRow(label: "Working Directory", value: session.workingDir)
                DetailRow(label: "Status", value: session.status.capitalized)
                DetailRow(label: "Started At", value: formatDate(session.startedAt))
                DetailRow(label: "Last Modified", value: formatDate(session.lastModified))

                if let pid = session.pid {
                    DetailRow(label: "Process ID", value: "\(pid)")
                }

                if let exitCode = session.exitCode {
                    DetailRow(label: "Exit Code", value: "\(exitCode)")
                }
            }

            Spacer()

            // Action Buttons
            HStack {
                Button("Open in Terminal") {
                    openInTerminal()
                }
                .controlSize(.large)

                Spacer()

                if session.isRunning {
                    Button("Terminate Session") {
                        terminateSession()
                    }
                    .controlSize(.large)
                    .foregroundColor(.red)
                }
            }
        }
        .padding(30)
        .frame(minWidth: 600, minHeight: 450)
        .onAppear {
            updateWindowTitle()
        }
        .background(WindowAccessor(title: $windowTitle))
    }

    private func updateWindowTitle() {
        let dir = URL(fileURLWithPath: session.workingDir).lastPathComponent
        if let pid = session.pid {
            windowTitle = "\(dir) — VibeTunnel (PID: \(pid))"
        } else {
            windowTitle = "\(dir) — VibeTunnel"
        }
    }

    private func formatDate(_ dateString: String) -> String {
        // Parse the date string and format it nicely
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"

        if let date = formatter.date(from: String(dateString.prefix(19))) {
            formatter.dateStyle = .medium
            formatter.timeStyle = .medium
            return formatter.string(from: date)
        }

        return dateString
    }

    private func openInTerminal() {
        // TODO: Implement opening session in terminal
        logger.info("Opening session \(session.id) in terminal")
    }

    private func terminateSession() {
        // TODO: Implement session termination
        logger.info("Terminating session \(session.id)")
    }
}

// MARK: - Supporting Views

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label + ":")
                .fontWeight(.medium)
                .foregroundColor(.secondary)
                .frame(width: 140, alignment: .trailing)

            Text(value)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct StatusBadge: View {
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isRunning ? Color.green : Color.red)
                .frame(width: 10, height: 10)

            Text(isRunning ? "Running" : "Stopped")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(isRunning ? .green : .red)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isRunning ? Color.green.opacity(0.1) : Color.red.opacity(0.1))
        )
    }
}

// MARK: - Window Title Accessor

struct WindowAccessor: NSViewRepresentable {
    @Binding var title: String

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            if let window = view.window {
                window.title = self.title

                // Watch for title changes
                Task { @MainActor in
                    context.coordinator.startObserving(window: window, binding: self.$title)
                }
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if let window = nsView.window {
                window.title = self.title
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject {
        private var observation: NSKeyValueObservation?

        @MainActor
        func startObserving(window: NSWindow, binding: Binding<String>) {
            // Update the binding when window title changes
            observation = window.observe(\.title, options: [.new]) { _, change in
                if let newTitle = change.newValue {
                    DispatchQueue.main.async {
                        binding.wrappedValue = newTitle
                    }
                }
            }

            // Set initial title
            window.title = binding.wrappedValue
        }

        deinit {
            observation?.invalidate()
        }
    }
}
