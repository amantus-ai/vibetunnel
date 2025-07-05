import SwiftUI
import UniformTypeIdentifiers

private let logger = Logger(category: "RecordingExport")

/// Sheet for exporting terminal recordings.
///
/// Provides interface for exporting recorded terminal sessions
/// as Asciinema cast files with sharing functionality.
struct RecordingExportSheet: View {
    var recorder: CastRecorder
    let sessionName: String
    @Environment(\.dismiss)
    var dismiss
    @State private var isExporting = false
    @State private var showingShareSheet = false
    @State private var exportedFileURL: URL?

    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.Spacing.extraLarge) {
                // Icon
                ZStack {
                    Circle()
                        .fill(Theme.Colors.primaryAccent.opacity(0.1))
                        .frame(width: 80, height: 80)

                    Image(systemName: "record.circle.fill")
                        .font(.system(size: 40))
                        .foregroundColor(Theme.Colors.primaryAccent)
                }
                .padding(.top, Theme.Spacing.extraLarge)

                // Info
                VStack(spacing: Theme.Spacing.small) {
                    Text("Recording Export")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(Theme.Colors.terminalForeground)

                    if recorder.isRecording {
                        Text("Recording in progress...")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    } else if !recorder.events.isEmpty {
                        VStack(spacing: Theme.Spacing.extraSmall) {
                            Text("\(recorder.events.count) events recorded")
                                .font(Theme.Typography.terminalSystem(size: 14))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                            if let duration = recorder.events.last?.time {
                                Text("Duration: \(formatDuration(duration))")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            }
                        }
                    } else {
                        Text("No recording available")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    }
                }

                Spacer()

                // Export button
                if !recorder.events.isEmpty {
                    Button(action: exportRecording) {
                        if isExporting {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalBackground))
                                .scaleEffect(0.8)
                        } else {
                            HStack(spacing: Theme.Spacing.small) {
                                Image(systemName: "square.and.arrow.up")
                                Text("Export as .cast file")
                            }
                        }
                    }
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .fontWeight(.medium)
                    .foregroundColor(Theme.Colors.terminalBackground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Spacing.medium)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                            .fill(Theme.Colors.primaryAccent)
                    )
                    .disabled(isExporting)
                    .padding(.horizontal)
                }

                Spacer()
            }
            .background(Theme.Colors.terminalBackground)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
        .sheet(isPresented: $showingShareSheet) {
            if let url = exportedFileURL {
                ShareSheet(items: [url])
            }
        }
    }

    private func exportRecording() {
        isExporting = true

        Task {
            if let castData = recorder.exportCastFile() {
                // Create temporary file
                let fileName =
                    "\(sessionName.replacingOccurrences(of: " ", with: "_"))_\(Date().timeIntervalSince1970).cast"
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

                do {
                    try castData.write(to: tempURL)

                    await MainActor.run {
                        exportedFileURL = tempURL
                        isExporting = false
                        showingShareSheet = true
                    }
                } catch {
                    logger.error("Failed to save cast file: \(error)")
                    await MainActor.run {
                        isExporting = false
                    }
                }
            } else {
                await MainActor.run {
                    isExporting = false
                }
            }
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds) / 60
        let remainingSeconds = Int(seconds) % 60
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }
}

/// UIKit share sheet wrapper for SwiftUI.
///
/// Presents the system share sheet for exporting files
/// and sharing content with other apps.
/// UIKit share sheet wrapper for exporting files.
/// Presents the system share interface for cast file sharing.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
