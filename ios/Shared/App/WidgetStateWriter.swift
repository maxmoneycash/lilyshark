//
//  WidgetStateWriter.swift
//  PommeCore
//
//  Writes current app state to the shared App Group UserDefaults so the
//  widget extension can read it, then asks WidgetCenter to reload.
//

#if os(iOS)
import WidgetKit
import Foundation
import MeshCoreKit

@MainActor
func syncWidgetState(
    connectionManager: ConnectionManager,
    deviceConfig: DeviceConfig,
    messageStoreManager: MessageStoreManager,
    geofenceStore: GeofenceStore,
    contactStore: ContactStore,
    channelStore: ChannelStore
) {
    var state = WidgetState()

    state.isConnected = connectionManager.isActivelyConnected
    state.deviceName = deviceConfig.deviceName

    let chemistry = deviceConfig.batteryCalibration.flatMap { BatteryChemistry(rawValue: $0.chemistry) } ?? .lipo
    state.batteryPct = deviceConfig.batteryMillivolts > 0
        ? deviceConfig.batteryPercent(chemistry: chemistry)
        : -1

    var dmCount = 0
    var channelCount = 0
    for (key, count) in messageStoreManager.unreadCounts where count > 0 {
        if key.count == 6 {
            let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == key })
            let isMuted = contact.map { contactStore.effectiveNotifyMode(for: $0) == .muted } ?? false
            if !isMuted { dmCount += count }
        } else if key.count == 1 {
            let channelIndex = key[0]
            let channel = channelStore.channels.first(where: { $0.index == channelIndex })
            let isMuted = channel.map { channelStore.channelNotifyMode(for: $0.name) == .muted } ?? false
            if !isMuted { channelCount += count }
        }
    }
    state.unreadDMCount = dmCount
    state.unreadChannelCount = channelCount
    state.unreadCount = dmCount + channelCount

    state.activeZoneCount = geofenceStore.zones.filter(\.isEnabled).count
    state.alertZoneName = geofenceStore.lastExitZoneName

    // Most recent incoming message across all contacts
    var newestMessage: Message?
    var newestKey: Data?
    for (key, messages) in messageStoreManager.messagesByContact {
        guard let msg = messages.suffix(20).filter({ !$0.isOutgoing }).max(by: { $0.timestamp < $1.timestamp }) else { continue }
        if newestMessage == nil || msg.timestamp > newestMessage!.timestamp {
            newestMessage = msg
            newestKey = key
        }
    }
    if let msg = newestMessage {
        let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == newestKey })
        let sender = contact.map { contactStore.displayName(for: $0) }
            ?? msg.senderName
            ?? "Unknown"
        state.lastMessageSender = sender
        state.lastMessagePreview = String(msg.text.prefix(120))
        state.lastMessageDate = msg.timestamp
    }

    state.save()
    WidgetCenter.shared.reloadAllTimelines()
}
#endif
