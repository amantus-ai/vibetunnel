// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VibeTunnel",
    platforms: [
        .macOS(.v14),
        .iOS(.v17)
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
        .package(url: "https://github.com/apple/swift-http-types.git", from: "1.4.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.6.3"),
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.14.1"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.7.1")
    ],
    targets: [
        .target(
            name: "VibeTunnel",
            dependencies: [
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "HTTPTypesFoundation", package: "swift-http-types"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "HummingbirdCore", package: "hummingbird"),
                .product(name: "HummingbirdTesting", package: "hummingbird"),
                .product(name: "Sparkle", package: "Sparkle")
            ],
            path: "VibeTunnel",
            exclude: [
                "Info.plist",
                "VibeTunnel.entitlements",
                "Local.xcconfig",
                "Local.xcconfig.template",
                "Shared.xcconfig",
                "version.xcconfig",
                "sparkle-public-ed-key.txt",
                "Resources",
                "Assets.xcassets",
                "AppIcon.icon",
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
