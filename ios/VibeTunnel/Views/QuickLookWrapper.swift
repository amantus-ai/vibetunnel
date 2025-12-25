import QuickLook
import SwiftUI

/// SwiftUI wrapper for QLPreviewController
struct QuickLookWrapper: UIViewControllerRepresentable {
    let quickLookManager: QuickLookManager

    func makeUIViewController(context: Context) -> UINavigationController {
        let previewController = self.quickLookManager.makePreviewController()
        previewController.navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: context.coordinator,
            action: #selector(Coordinator.dismiss))

        let navigationController = UINavigationController(rootViewController: previewController)
        navigationController.navigationBar.prefersLargeTitles = false

        // Apply dark theme styling
        navigationController.navigationBar.barStyle = .black
        navigationController.navigationBar.tintColor = UIColor(Theme.Colors.terminalAccent)
        navigationController.navigationBar.titleTextAttributes = [
            .foregroundColor: UIColor(Theme.Colors.terminalWhite),
            .font: UIFont(name: "SF Mono", size: 16) ?? UIFont.systemFont(ofSize: 16),
        ]

        return navigationController
    }

    func updateUIViewController(_ uiViewController: UINavigationController, context: Context) {
        // No updates needed
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(quickLookManager: self.quickLookManager)
    }

    class Coordinator: NSObject {
        let quickLookManager: QuickLookManager

        init(quickLookManager: QuickLookManager) {
            self.quickLookManager = quickLookManager
        }

        @MainActor
        @objc
        func dismiss() {
            self.quickLookManager.isPresenting = false
        }
    }
}
