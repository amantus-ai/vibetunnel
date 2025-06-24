// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VibeTunnelFrontend",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(
            name: "VibeTunnelFrontend",
            targets: ["VibeTunnelFrontend"]
        )
    ],
    dependencies: [
        // For WebView-based terminal if needed
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.2.0"),
        // For syntax highlighting in file preview
        .package(url: "https://github.com/raspu/Highlightr.git", from: "2.2.1")
    ],
    targets: [
        .executableTarget(
            name: "VibeTunnelFrontend",
            dependencies: [
                "SwiftTerm",
                "Highlightr"
            ],
            path: "VibeTunnelFrontend",
            exclude: [
                "Local.xcconfig.example",
                "version.xcconfig",
                "Info.plist",
                "Shared.xcconfig"
            ],
            resources: [
                .process("Assets.xcassets")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("StrictConcurrency")
            ]
        ),
        .testTarget(
            name: "VibeTunnelFrontendTests",
            dependencies: ["VibeTunnelFrontend"],
            path: "VibeTunnelFrontendTests"
        )
    ]
)