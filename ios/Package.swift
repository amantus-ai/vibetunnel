// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "VibeTunnelDependencies",
    platforms: [
        .iOS(.v18),
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "VibeTunnelDependencies",
            targets: ["VibeTunnelDependencies"]),
    ],
    dependencies: [
        .package(url: "https://github.com/mhdhejazi/Dynamic.git", from: "1.2.0"),
    ],
    targets: [
        .target(
            name: "VibeTunnelDependencies",
            dependencies: [
                .product(name: "Dynamic", package: "Dynamic"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ]),
    ])
