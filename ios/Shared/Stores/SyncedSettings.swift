//
//  SyncedSettings.swift
//  PommeCore
//
//  App settings synced across devices via iCloud key-value store.
//  Observes UserDefaults changes (from @AppStorage) and pushes to iCloud KVS.
//  When iCloud changes arrive, writes back to UserDefaults so @AppStorage picks them up.
//
//  Created by Michael P. Bedworth on 04/07/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import Combine

/// Codable payload stored as a single blob in iCloud KVS under key "appSettings".
struct SyncedSettingsPayload: Codable {
    var appTheme: String
    var batteryChemistry: String
    var maxMessagesPerContact: Int
    var locationPrivacyRadius: Double
    var shareOnMeshMap: Bool
    var autoUpdateLocation: Bool
    var locationUpdateInterval: Int
    var contactSortByLastSeen: Bool
    var channelsFirst: Bool
    var autoRetry: Bool
    var autoResetPath: Bool
    var lastModified: Date
}

extension SyncedSettingsPayload {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        appTheme = try c.decodeIfPresent(String.self, forKey: .appTheme) ?? "system"
        batteryChemistry = try c.decodeIfPresent(String.self, forKey: .batteryChemistry) ?? "liion"
        maxMessagesPerContact = try c.decodeIfPresent(Int.self, forKey: .maxMessagesPerContact) ?? 500
        locationPrivacyRadius = try c.decodeIfPresent(Double.self, forKey: .locationPrivacyRadius) ?? 0
        shareOnMeshMap = try c.decodeIfPresent(Bool.self, forKey: .shareOnMeshMap) ?? true
        autoUpdateLocation = try c.decodeIfPresent(Bool.self, forKey: .autoUpdateLocation) ?? false
        locationUpdateInterval = try c.decodeIfPresent(Int.self, forKey: .locationUpdateInterval) ?? 300
        contactSortByLastSeen = try c.decodeIfPresent(Bool.self, forKey: .contactSortByLastSeen) ?? false
        channelsFirst = try c.decodeIfPresent(Bool.self, forKey: .channelsFirst) ?? false
        autoRetry = try c.decodeIfPresent(Bool.self, forKey: .autoRetry) ?? true
        autoResetPath = try c.decodeIfPresent(Bool.self, forKey: .autoResetPath) ?? true
        lastModified = try c.decodeIfPresent(Date.self, forKey: .lastModified) ?? Date()
    }
}

@MainActor
final class SyncedSettings {
    static let shared = SyncedSettings()

    private let iCloudStore = NSUbiquitousKeyValueStore.default
    private let defaults = UserDefaults.standard
    private static let kvsKey = "appSettings"

    /// Keys synced to iCloud. Must match SyncedSettingsPayload fields.
    private static let syncedKeys: [String] = [
        "appTheme", "batteryChemistry", "maxMessagesPerContact",
        "locationPrivacyRadius", "shareOnMeshMap", "autoUpdateLocation",
        "locationUpdateInterval", "contactSortByLastSeen", "channelsFirst",
        "autoRetry", "autoResetPath"
    ]

    private var isApplyingCloud = false
    private var cancellables = Set<AnyCancellable>()
    private var pushDebounceTask: Task<Void, Never>?

    // MARK: - Init

    private init() {
        migrateIfNeeded()
        observeUserDefaults()
        observeiCloudChanges()
    }

    // MARK: - Migration (first launch after update)

    private func migrateIfNeeded() {
        guard !defaults.bool(forKey: "settingsSyncMigrated") else {
            if iCloudSyncEnabled { applyCloudValues() }
            return
        }
        pushToCloud()
        defaults.set(true, forKey: "settingsSyncMigrated")
    }

    // MARK: - Observe UserDefaults (@AppStorage writes here)

    private func observeUserDefaults() {
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, !self.isApplyingCloud else { return }
                self.schedulePush()
            }
            .store(in: &cancellables)
    }

    private func schedulePush() {
        pushDebounceTask?.cancel()
        pushDebounceTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s debounce
            guard !Task.isCancelled else { return }
            self.pushToCloud()
        }
    }

    // MARK: - Observe iCloud Changes

    private func observeiCloudChanges() {
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: iCloudStore, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard iCloudSyncEnabled else { return }
                self?.applyCloudValues()
            }
        }
    }

    // MARK: - Cloud → Local

    private func applyCloudValues() {
        guard let payload = iCloudStore.loadCodable(SyncedSettingsPayload.self, forKey: Self.kvsKey) else { return }

        isApplyingCloud = true
        defer { isApplyingCloud = false }

        setIfDifferent("appTheme", payload.appTheme)
        setIfDifferent("batteryChemistry", payload.batteryChemistry)
        setIntIfDifferent("maxMessagesPerContact", payload.maxMessagesPerContact)
        setDoubleIfDifferent("locationPrivacyRadius", payload.locationPrivacyRadius)
        setBoolIfDifferent("shareOnMeshMap", payload.shareOnMeshMap)
        setBoolIfDifferent("autoUpdateLocation", payload.autoUpdateLocation)
        setIntIfDifferent("locationUpdateInterval", payload.locationUpdateInterval)
        setBoolIfDifferent("contactSortByLastSeen", payload.contactSortByLastSeen)
        setBoolIfDifferent("channelsFirst", payload.channelsFirst)
        setBoolIfDifferent("autoRetry", payload.autoRetry)
        setBoolIfDifferent("autoResetPath", payload.autoResetPath)
    }

    // MARK: - Local → Cloud

    private func pushToCloud() {
        guard iCloudSyncEnabled else { return }
        let payload = SyncedSettingsPayload(
            appTheme: defaults.string(forKey: "appTheme") ?? "system",
            batteryChemistry: defaults.string(forKey: "batteryChemistry") ?? "lipo",
            maxMessagesPerContact: defaults.object(forKey: "maxMessagesPerContact") != nil
                ? defaults.integer(forKey: "maxMessagesPerContact") : 500,
            locationPrivacyRadius: defaults.double(forKey: "locationPrivacyRadius"),
            shareOnMeshMap: defaults.bool(forKey: "shareOnMeshMap"),
            autoUpdateLocation: defaults.bool(forKey: "autoUpdateLocation"),
            locationUpdateInterval: defaults.object(forKey: "locationUpdateInterval") != nil
                ? defaults.integer(forKey: "locationUpdateInterval") : 900,
            contactSortByLastSeen: defaults.object(forKey: "contactSortByLastSeen") != nil
                ? defaults.bool(forKey: "contactSortByLastSeen") : true,
            channelsFirst: defaults.bool(forKey: "channelsFirst"),
            autoRetry: defaults.bool(forKey: "autoRetry"),
            autoResetPath: defaults.bool(forKey: "autoResetPath"),
            lastModified: Date()
        )
        iCloudStore.saveCodable(payload, forKey: Self.kvsKey)
    }

    // MARK: - Helpers (only write to UserDefaults if value actually changed)

    private func setIfDifferent(_ key: String, _ value: String) {
        if defaults.string(forKey: key) != value {
            defaults.set(value, forKey: key)
        }
    }

    private func setIntIfDifferent(_ key: String, _ value: Int) {
        if defaults.integer(forKey: key) != value {
            defaults.set(value, forKey: key)
        }
    }

    private func setDoubleIfDifferent(_ key: String, _ value: Double) {
        if defaults.double(forKey: key) != value {
            defaults.set(value, forKey: key)
        }
    }

    private func setBoolIfDifferent(_ key: String, _ value: Bool) {
        if defaults.bool(forKey: key) != value {
            defaults.set(value, forKey: key)
        }
    }
}
