import CloudKit
import Foundation

/// CloudKit can terminate the process when a container is created without its
/// signing entitlements. Our app targets supply those entitlements when signed.
/// Their Info.plists expand this marker from CODE_SIGNING_ALLOWED so unsigned
/// simulator/macOS builds retain local functionality without creating a container.
/// A missing or unexpanded marker (including package/test bundles) fails closed.
@MainActor
enum CloudKitAccess {
    static var isEnabledForBuild: Bool {
        Bundle.main.object(forInfoDictionaryKey: "LilysharkCodeSigningAllowed") as? String == "YES"
    }

    static func makeContainer() -> CKContainer? {
        guard isEnabledForBuild else { return nil }
        // This gate covers build capability; account/network availability still
        // comes from CloudKit's normal async errors in the calling feature.
        return CKContainer(identifier: "iCloud.com.lilyshark.app")
    }
}
