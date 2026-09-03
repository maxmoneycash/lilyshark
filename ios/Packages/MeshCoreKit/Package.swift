// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MeshCoreKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
        .watchOS(.v11)
    ],
    products: [
        .library(
            name: "MeshCoreKit",
            targets: ["MeshCoreKit"]
        )
    ],
    targets: [
        .target(
            name: "MeshCoreKit",
            path: "Sources/MeshCoreKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "MeshCoreKitTests",
            dependencies: ["MeshCoreKit"]
        )
    ]
)
