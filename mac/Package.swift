// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ShellOps",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "ShellOps",
            targets: ["ShellOps"]),
    ],
    dependencies: [
        .package(url: "https://github.com/realm/SwiftLint.git", from: "0.62.2"),
        .package(url: "https://github.com/nicklockwood/SwiftFormat.git", from: "0.58.7"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
    ],
    targets: [
        .target(
            name: "ShellOps",
            dependencies: [
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            path: "ShellOps",
            exclude: [
                "Info.plist",
                "ShellOps.entitlements",
                "Shared.xcconfig",
                "version.xcconfig",
                "version.xcconfig.bak",
                "Local.xcconfig",
                "ShellOps-Mac.xctestplan",
                "sparkle-public-ed-key.txt",
                "Assets.xcassets",
                "ShellOpsApp.swift",
            ]),
        .testTarget(
            name: "ShellOpsTests",
            dependencies: ["ShellOps"],
            path: "ShellOpsTests"),
    ])
