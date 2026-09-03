// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MeshtasticKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
        .watchOS(.v11)
    ],
    products: [
        .library(
            name: "MeshtasticKit",
            targets: ["MeshtasticKit"]
        )
    ],
    targets: [
        .target(
            name: "MeshtasticKit",
            path: "Sources/MeshtasticKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "MeshtasticKitTests",
            dependencies: ["MeshtasticKit"]
        )
    ]
)
