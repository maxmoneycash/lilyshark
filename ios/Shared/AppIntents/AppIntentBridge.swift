// AppIntentBridge.swift — PommeCore
// Static bridge giving App Intents access to live store instances.
// Populated in PommeCoreViewModel.wireStoreDependencies().

import Foundation
import MeshCoreKit

final class AppIntentBridge: @unchecked Sendable {
    static let shared = AppIntentBridge()
    private init() {}

    // Assigned on MainActor at launch; read inside MainActor.run blocks in intents.
    var connectionManager: ConnectionManager?
    var contactStore: ContactStore?
    var channelStore: ChannelStore?
    var messageStoreManager: MessageStoreManager?
}
