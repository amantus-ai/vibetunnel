import SwiftUI

struct ImagePreviewView: View {
    let imagePath: String
    @Environment(\.dismiss) private var dismiss
    @State private var nsImage: NSImage?
    @State private var isLoading = true
    @State private var error: Error?
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Image Preview")
                        .font(Theme.Typography.title3)
                    Text(URL(fileURLWithPath: imagePath).lastPathComponent)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .lineLimit(1)
                }
                
                Spacer()
                
                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
            }
            .padding(Theme.Spacing.lg)
            
            Divider()
            
            // Content
            if isLoading {
                LoadingView(message: "Loading image...")
            } else if let error {
                ErrorView(error: error) {
                    loadImage()
                }
            } else if let nsImage {
                GeometryReader { geometry in
                    ScrollView([.horizontal, .vertical]) {
                        Image(nsImage: nsImage)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(
                                maxWidth: max(geometry.size.width, nsImage.size.width),
                                maxHeight: max(geometry.size.height, nsImage.size.height)
                            )
                    }
                }
                .background(Theme.Colors.secondaryBackground)
            }
            
            Divider()
            
            // Footer
            HStack {
                if let nsImage {
                    Text("\(Int(nsImage.size.width)) × \(Int(nsImage.size.height)) pixels")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                
                Spacer()
                
                Button("Copy Path") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(imagePath, forType: .string)
                }
                .secondaryButtonStyle()
                
                Button("Copy Image") {
                    if let nsImage {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.writeObjects([nsImage])
                    }
                }
                .primaryButtonStyle()
                .disabled(nsImage == nil)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(width: 800, height: 600)
        .background(Theme.Colors.background)
        .onAppear {
            loadImage()
        }
    }
    
    private func loadImage() {
        isLoading = true
        error = nil
        
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let image = NSImage(contentsOfFile: imagePath) else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                
                DispatchQueue.main.async {
                    self.nsImage = image
                    self.isLoading = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.error = error
                    self.isLoading = false
                }
            }
        }
    }
}

#Preview {
    ImagePreviewView(imagePath: "/path/to/image.png")
}