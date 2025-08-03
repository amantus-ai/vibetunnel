// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "VibeTunnelDependencies",
    platforms: [
        .iOS(.v18),
        .macOS(.v10_15)
    ],
    products: [
        .library(
            name: "VibeTunnelDependencies",
            targets: ["VibeTunnelDependencies"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", exact: "1.2.5"),
        .package(url: "https://github.com/mhdhejazi/Dynamic.git", from: "1.2.0")
    ],
    targets: [
        .target(
            name: "VibeTunnelDependencies",
            dependencies: [
                .product(name: "SwiftTerm", package: "SwiftTerm"),
                .product(name: "Dynamic", package: "Dynamic")
            ],
            swiftSettings: [
                .swiftLanguageVersion(.v5)
            ]
        )
    ]
)
