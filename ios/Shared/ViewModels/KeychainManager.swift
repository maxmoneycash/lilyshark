//
//  KeychainManager.swift
//  PommeCore
//
//  Keychain read/write for passwords, channel secrets, and encryption keys.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Security
import Foundation
import MeshCoreKit

/// Manages Keychain storage for PommeCore device login credentials.
/// Passwords are stored per-device (keyed by public key) and protected with
/// kSecAttrAccessibleWhenUnlockedThisDeviceOnly (no iCloud sync). Channel secrets
/// use kSecAttrAccessibleAfterFirstUnlock to allow background channel decryption.
///
/// Uses the data protection keychain (kSecUseDataProtectionKeychain) so macOS
/// does not prompt for login keychain access on every rebuild.
/// All items for the service are bulk-loaded into an in-memory cache on first
/// access — at most one keychain read per app session.
struct KeychainManager {

    /// Whether iCloud Keychain sync is enabled (per-device setting).
    static var iCloudSyncEnabled: Bool {
        UserDefaults.standard.object(forKey: "iCloudSyncEnabled") == nil ? true : UserDefaults.standard.bool(forKey: "iCloudSyncEnabled")
    }

    private static let service = "com.mbedworth.meshcore.logins"

    /// In-memory cache: account key → password bytes (mutable for zeroing).
    /// Once `cacheLoaded` is true, any key NOT in `cache` has no saved password.
    private static var cache: [String: ContiguousArray<UInt8>] = [:]
    private static var cacheLoaded = false
    private static let cacheLock = NSLock()

    /// Zero a cache entry before removing it.
    private static func zeroCacheEntry(forKey key: String) {
        if var bytes = cache[key] {
            for i in bytes.indices { bytes[i] = 0 }
        }
        cache.removeValue(forKey: key)
    }

    private static func accountKey(publicKey: Data, type: String) -> String {
        publicKey.hexCompact + "." + type
    }

    /// Base query attributes for searching/deleting — finds items regardless of sync state.
    private static var baseAttributes: [String: Any] {
        var attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
        ]
        #if os(macOS)
        attrs[kSecUseDataProtectionKeychain as String] = true
        #endif
        return attrs
    }

    /// Load ALL items for our service from the keychain in one query.
    private static func ensureCacheLoaded() {
        if cacheLoaded { return }

        var query = baseAttributes
        query[kSecReturnAttributes as String] = true
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitAll

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let items = result as? [[String: Any]] {
            for item in items {
                if let account = item[kSecAttrAccount as String] as? String,
                   let data = item[kSecValueData as String] as? Data {
                    cache[account] = ContiguousArray(data)
                }
            }
        }
        cacheLoaded = true
    }

    /// Save a password for a device identified by its public key.
    @discardableResult
    static func savePassword(_ password: String, forDevice publicKey: Data, type: String = "admin") -> Bool {
        let account = accountKey(publicKey: publicKey, type: type)

        // Delete any existing entry first
        var deleteQuery = baseAttributes
        deleteQuery[kSecAttrAccount as String] = account
        SecItemDelete(deleteQuery as CFDictionary)

        // Add the new entry
        guard let passwordData = password.data(using: .utf8) else { return false }
        var addQuery = baseAttributes
        addQuery[kSecAttrAccount as String] = account
        addQuery[kSecValueData as String] = passwordData
        // Device login passwords are never synced — they're specific to a physical radio
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        addQuery[kSecAttrSynchronizable as String] = false

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
            cacheLock.lock()
            cache[account] = ContiguousArray(passwordData)
            cacheLock.unlock()
        }
        return status == errSecSuccess
    }

    /// Retrieve a saved password for a device.
    static func getPassword(forDevice publicKey: Data, type: String = "admin") -> String? {
        let account = accountKey(publicKey: publicKey, type: type)

        cacheLock.lock()
        ensureCacheLoaded()
        let bytes = cache[account]
        cacheLock.unlock()

        guard let bytes else { return nil }
        return String(bytes: bytes, encoding: .utf8)
    }

    /// Delete a saved password.
    @discardableResult
    static func deletePassword(forDevice publicKey: Data, type: String = "admin") -> Bool {
        let account = accountKey(publicKey: publicKey, type: type)

        var query = baseAttributes
        query[kSecAttrAccount as String] = account

        let status = SecItemDelete(query as CFDictionary)

        cacheLock.lock()
        zeroCacheEntry(forKey: account)
        cacheLock.unlock()

        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Check if a password exists without retrieving it.
    static func hasPassword(forDevice publicKey: Data, type: String = "admin") -> Bool {
        getPassword(forDevice: publicKey, type: type) != nil
    }

    /// Get any saved password (tries admin first, then guest).
    static func getSavedPassword(forDevice publicKey: Data) -> String? {
        getPassword(forDevice: publicKey, type: "admin")
            ?? getPassword(forDevice: publicKey, type: "guest")
    }

    /// Delete all saved passwords for a device.
    static func deleteAllPasswords(forDevice publicKey: Data) {
        deletePassword(forDevice: publicKey, type: "admin")
        deletePassword(forDevice: publicKey, type: "guest")
    }

    // MARK: - Channel Secrets (iCloud Keychain sync)

    private static let channelService = "com.mbedworth.meshcore.channels"

    /// Legacy channel secret account key — keyed by name only (no radio isolation).
    private static func channelAccount(_ name: String) -> String {
        "channel.secret.\(name.lowercased())"
    }

    /// Per-radio channel secret account key — isolated by radio public key prefix.
    private static func channelAccount(_ name: String, radioPrefix: String) -> String {
        "channel.secret.\(radioPrefix).\(name.lowercased())"
    }

    /// Save a channel secret to Keychain (syncs via iCloud when enabled).
    @discardableResult
    static func saveChannelSecret(_ secret: Data, forChannelName name: String) -> Bool {
        let account = channelAccount(name)

        // Delete any existing (search with Any to find regardless of sync state)
        var deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
        ]
        #if os(macOS)
        deleteQuery[kSecUseDataProtectionKeychain as String] = true
        #endif
        SecItemDelete(deleteQuery as CFDictionary)

        var addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: account,
            kSecValueData as String: secret,
            kSecAttrSynchronizable as String: Self.iCloudSyncEnabled,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        #if os(macOS)
        addQuery[kSecUseDataProtectionKeychain as String] = true
        #endif

        return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
    }

    /// Retrieve a channel secret from Keychain.
    static func getChannelSecret(forChannelName name: String) -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: channelAccount(name),
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return data
    }

    /// Delete a channel secret from Keychain.
    @discardableResult
    static func deleteChannelSecret(forChannelName name: String) -> Bool {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: channelAccount(name),
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Per-Radio Channel Secrets

    /// Save a channel secret scoped to a specific radio.
    @discardableResult
    static func saveChannelSecret(_ secret: Data, forChannelName name: String, radioPrefix: String) -> Bool {
        let account = channelAccount(name, radioPrefix: radioPrefix)

        var deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
        ]
        #if os(macOS)
        deleteQuery[kSecUseDataProtectionKeychain as String] = true
        #endif
        SecItemDelete(deleteQuery as CFDictionary)

        var addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: account,
            kSecValueData as String: secret,
            kSecAttrSynchronizable as String: Self.iCloudSyncEnabled,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        #if os(macOS)
        addQuery[kSecUseDataProtectionKeychain as String] = true
        #endif

        return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
    }

    /// Retrieve a channel secret scoped to a specific radio, with fallback to legacy unscoped key.
    static func getChannelSecret(forChannelName name: String, radioPrefix: String) -> Data? {
        // Try scoped key first
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: channelAccount(name, radioPrefix: radioPrefix),
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif

        var result: AnyObject?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data {
            return data
        }

        // Fall back to legacy unscoped key
        return getChannelSecret(forChannelName: name)
    }

    /// Delete a channel secret scoped to a specific radio.
    @discardableResult
    static func deleteChannelSecret(forChannelName name: String, radioPrefix: String) -> Bool {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: channelService,
            kSecAttrAccount as String: channelAccount(name, radioPrefix: radioPrefix),
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
