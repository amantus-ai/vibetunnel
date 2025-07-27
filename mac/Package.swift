// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VibeTunnel",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "VibeTunnel",
            targets: ["VibeTunnel"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/realm/SwiftLint.git", from: "0.59.1"),
        .package(url: "https://github.com/nicklockwood/SwiftFormat.git", from: "0.56.4"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.6.3"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.7.1")
    ],
    targets: [
        .target(
            name: "VibeTunnel",
            dependencies: [
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle")
            ],
            path: "VibeTunnel",
            exclude: [
                "Info.plist",
                "VibeTunnel.entitlements",
                "Shared.xcconfig",
                "version.xcconfig",
                "sparkle-public-ed-key.txt",
                "Assets.xcassets",
                "VibeTunnelApp.swift"
            ]
        ),
        .testTarget(
            name: "VibeTunnelTests",
            dependencies: ["VibeTunnel"],
            path: "VibeTunnelTests"
        )
    ]
)
