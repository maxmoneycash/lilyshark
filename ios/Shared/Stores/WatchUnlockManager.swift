//
//  WatchUnlockManager.swift
//  PommeCore
//
//  Watch Companion unlock state — StoreKit 2 non-consumable + iCloud supporter flag.
//
//  Created by Michael P. Bedworth on 04/22/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if os(iOS)
import Foundation
import StoreKit
import Combine
import MeshCoreKit

@MainActor
final class WatchUnlockManager: ObservableObject {
    static let shared = WatchUnlockManager()

    @Published var isUnlocked = false

    static let companionProductID = "com.mbedworth.meshcore.watch.companion"
    private static let supporterKVSKey = "supporter.watchUnlock"

    private var updateTask: Task<Void, Never>?

    private init() {
        Task { @MainActor in await self.refresh() }
        updateTask = Task { @MainActor in await self.listenForTransactionUpdates() }
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(iCloudDidChange),
            name: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: NSUbiquitousKeyValueStore.default
        )
    }

    // MARK: - Public

    /// Re-checks entitlements and iCloud flag. Called on app launch and after purchases.
    func refresh() async {
        var unlocked = false
        for await entitlement in Transaction.currentEntitlements {
            if case .verified(let tx) = entitlement, tx.productID == Self.companionProductID {
                unlocked = true
                break
            }
        }
        if NSUbiquitousKeyValueStore.default.bool(forKey: Self.supporterKVSKey) {
            unlocked = true
        }
        isUnlocked = unlocked
    }

    /// Called from TipJar after a verified tip.help purchase. Persists across devices.
    func markSupporterUnlocked() {
        let store = NSUbiquitousKeyValueStore.default
        store.set(true, forKey: Self.supporterKVSKey)
        store.synchronize()
        isUnlocked = true
        DebugLogger.shared.log("WATCH: supporter unlock set via iCloud KVS", level: .info)
    }

    // MARK: - Private

    private func listenForTransactionUpdates() async {
        for await update in Transaction.updates {
            guard case .verified(let tx) = update,
                  tx.productID == Self.companionProductID else { continue }
            await tx.finish()
            isUnlocked = true
            DebugLogger.shared.log("WATCH: companion purchase verified — unlocked", level: .info)
        }
    }

    @objc private func iCloudDidChange(_ notification: Notification) {
        if NSUbiquitousKeyValueStore.default.bool(forKey: Self.supporterKVSKey) {
            Task { @MainActor in self.isUnlocked = true }
        }
    }
}
#endif
