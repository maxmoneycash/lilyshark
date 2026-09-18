import Foundation
import MeshCoreKit

extension PommeCoreViewModel {
    func makeRadioBrowsingSnapshot() -> RadioBrowsingSnapshot? {
        #if DEBUG && LILYSHARK_UI_CHAT_FIXTURE && os(iOS)
        return nil
        #else
        guard !deviceConfig.isSavedRadioData, deviceConfig.loadedSections.contains("selfInfo") else { return nil }
        let transport: RadioBrowsingSnapshot.Transport = messageStoreManager.meshtasticNodeNum == 0 ? .meshCore : .meshtastic
        let key = deviceConfig.publicKeyHex.lowercased()
        guard RadioBrowsingSnapshot.isValidIdentity(key, transport: transport) else { return nil }
        let syncingNodes = contactStore.isSyncingContacts || meshtasticConfigNonce != 0
        let syncingChannels = !channelStore.hasCompletedInitialChannelSync
        let prior = syncingNodes || syncingChannels
            ? MessageStore(radioPrefix: String(key.prefix(12))).loadBrowsingSnapshot(publicKey: key) : nil
        // A disconnect during the initial dump must not erase the last complete
        // index. New reports replace matching saved records under this identity.
        var contacts = Dictionary((syncingNodes ? prior?.contacts ?? [] : []).map { ($0.publicKey, $0) }, uniquingKeysWith: { _, new in new })
        for contact in contactStore.contacts { contacts[contact.publicKey] = contact }
        let snapshot = RadioBrowsingSnapshot(publicKey: key,
            name: deviceConfig.deviceName, transport: transport, contacts: contacts.values.sorted { $0.name < $1.name },
            channels: syncingChannels ? prior?.channels ?? channelStore.channels : channelStore.channels,
            positions: (syncingNodes ? prior?.positions ?? [:] : [:]).merging(contactStore.nodePositions) { _, new in new },
            observations: (syncingNodes ? prior?.observations ?? [:] : [:]).merging(contactStore.nodeObservations) { _, new in new })
        return snapshot.hasValidIdentity ? snapshot : nil
        #endif
    }

    func persistRadioBrowsingSnapshot(_ snapshot: RadioBrowsingSnapshot) {
        if MessageStore(radioPrefix: snapshot.storagePrefix).saveBrowsingSnapshot(snapshot) {
            UserDefaults.standard.set(snapshot.publicKey, forKey: "lastBrowsableRadioKey")
        }
    }

    func scheduleRadioBrowsingSave() {
        guard !deviceConfig.isSavedRadioData, deviceConfig.loadedSections.contains("selfInfo") else { return }
        radioBrowsingSaveTask?.cancel()
        radioBrowsingSaveTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            guard let self, let snapshot = self.makeRadioBrowsingSnapshot() else { return }
            self.persistRadioBrowsingSnapshot(snapshot)
        }
    }

    func restoreLastRadioForBrowsing() {
        #if DEBUG && LILYSHARK_UI_CHAT_FIXTURE && os(iOS)
        return
        #else
        guard connectionManager.connectionState == .disconnected,
              let key = UserDefaults.standard.string(forKey: "lastBrowsableRadioKey"),
              RadioBrowsingSnapshot.isValidIdentity(key, transport: key.count == 8 ? .meshtastic : .meshCore),
              let snapshot = MessageStore(radioPrefix: String(key.prefix(12))).loadBrowsingSnapshot(publicKey: key) else { return }
        applyRadioBrowsingSnapshot(snapshot)
        #endif
    }

    func applyRadioBrowsingSnapshot(_ snapshot: RadioBrowsingSnapshot) {
        guard snapshot.hasValidIdentity else { return }
        deviceConfig.publicKeyHex = snapshot.publicKey
        deviceConfig.deviceName = snapshot.name
        deviceConfig.isSavedRadioData = true
        deviceConfig.savedRadioDataDate = snapshot.savedAt
        contactStore.contacts = snapshot.contacts
        contactStore.nodePositions = snapshot.positions
        contactStore.nodeObservations = snapshot.observations
        contactStore.loadNicknamesFromiCloud()
        contactStore.loadContactNotesFromiCloud()
        channelStore.activateForRadio(snapshot.storagePrefix)
        channelStore.channels = snapshot.channels
        channelStore.hasCompletedInitialChannelSync = true
        messageStoreManager.activateForRadio(snapshot.storagePrefix)
        messageStoreManager.meshtasticNodeNum = snapshot.transport == .meshtastic ? UInt32(snapshot.publicKey, radix: 16) ?? 0 : 0
        // A process can terminate without the disconnect callback. Saved pending
        // sends have no active radio transaction and must not keep spinning.
        messageStoreManager.markAllSendingAsFailed()
    }

    func clearSavedRadioBeforeConnecting() {
        guard deviceConfig.isSavedRadioData else { return }
        radioBrowsingSaveTask?.cancel()
        navigationStore.sidebarSelection = nil
        navigationStore.visibleConversationKey = nil
        navigationStore.radioSessionGeneration = UUID()
        #if !os(watchOS)
        navigationStore.selectedMapNodeKey = nil
        #endif
        // Flush messages while providers still identify the previous radio.
        messageStoreManager.deactivate()
        messageStoreManager.reset()
        deviceConfig.reset()
        contactStore.reset()
        channelStore.reset()
    }
}
