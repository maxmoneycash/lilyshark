//
//  MessageStore.swift
//  MeshCoreKit
//
//  Per-radio message file I/O with AES-256-GCM encryption.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import os.log
import CryptoKit
import Security

/// File-based persistent store for chat messages.
/// Uses JSON encoding to a per-contact file in the app's documents directory.
/// Messages are stored in per-radio subdirectories to isolate data between radios.
public final class MessageStore {
    private static let logger = Logger(subsystem: "com.pommecore", category: "MessageStore")

    private static var rootDirectory: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("MeshCoreMessages", isDirectory: true)
    }

    private let directory: URL

    /// Legacy initializer — points at flat root directory. Used only for migration.
    public init() {
        directory = Self.rootDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Per-radio initializer — stores messages in a radio-specific subdirectory.
    /// - Parameter radioPrefix: First 12 hex chars of the radio's public key.
    public init(radioPrefix: String) {
        directory = Self.rootDirectory.appendingPathComponent(radioPrefix, isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Migrate flat message files into a per-radio subdirectory.
    /// Only runs if the subdirectory is empty and the root has flat `.json` files.
    /// The first radio to connect after upgrade "claims" the existing messages.
    @discardableResult
    public static func migrateToPerRadioStorage(radioPrefix: String) -> Bool {
        let root = rootDirectory
        let radioDir = root.appendingPathComponent(radioPrefix, isDirectory: true)

        // Skip if radio subdirectory already has files
        if let existing = try? FileManager.default.contentsOfDirectory(at: radioDir, includingPropertiesForKeys: nil),
           existing.contains(where: { $0.pathExtension == "json" }) {
            return false
        }

        // Find flat .json files at root level (not in subdirectories)
        guard let rootFiles = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey]) else {
            return false
        }
        let flatJsonFiles = rootFiles.filter { url in
            guard url.pathExtension == "json" else { return false }
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            return !isDir
        }
        guard !flatJsonFiles.isEmpty else { return false }

        // Create subdirectory and move files
        try? FileManager.default.createDirectory(at: radioDir, withIntermediateDirectories: true)
        var movedCount = 0
        for file in flatJsonFiles {
            let dest = radioDir.appendingPathComponent(file.lastPathComponent)
            do {
                try FileManager.default.moveItem(at: file, to: dest)
                movedCount += 1
            } catch {
                logger.error("Failed to migrate \(file.lastPathComponent): \(error.localizedDescription)")
            }
        }
        if movedCount > 0 {
            logger.info("Migrated \(movedCount) message files to radio subdirectory \(radioPrefix)")
        }
        return movedCount > 0
    }

    /// Returns 12-char hex subdirectory names under MeshCoreMessages/.
    public static func knownRadioPrefixes() -> [String] {
        let root = rootDirectory
        guard let contents = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey]) else {
            return []
        }
        return contents.compactMap { url in
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            guard isDir else { return nil }
            let name = url.lastPathComponent
            // 12-char hex string = 6 bytes of public key prefix
            guard name.count == 12, name.allSatisfy({ $0.isHexDigit }) else { return nil }
            return name
        }.sorted()
    }

    // MARK: - Encryption

    /// AES-256-GCM key for at-rest message encryption. Stored in device Keychain.
    /// Generated once per radio directory, retrieved on subsequent launches.
    private lazy var encryptionKey: SymmetricKey? = {
        let tag = "com.mbedworth.meshcore.msgkey.\(directory.lastPathComponent)"
        if let existing = Self.loadKeyFromKeychain(tag: tag) {
            return existing
        }
        let key = SymmetricKey(size: .bits256)
        if Self.saveKeyToKeychain(key, tag: tag) {
            return key
        }
        Self.logger.error("ENCRYPT: Failed to create/store encryption key")
        return nil
    }()

    private static func loadKeyFromKeychain(tag: String) -> SymmetricKey? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.mbedworth.meshcore.encryption",
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return SymmetricKey(data: data)
    }

    private static func saveKeyToKeychain(_ key: SymmetricKey, tag: String) -> Bool {
        let keyData = key.withUnsafeBytes { Data($0) }
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.mbedworth.meshcore.encryption",
            kSecAttrAccount as String: tag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    /// Encrypt data using AES-256-GCM. Returns nonce + ciphertext + tag.
    private func encrypt(_ plaintext: Data) -> Data? {
        guard let key = encryptionKey else { return nil }
        do {
            let sealed = try AES.GCM.seal(plaintext, using: key)
            return sealed.combined
        } catch {
            Self.logger.error("ENCRYPT: \(error.localizedDescription)")
            return nil
        }
    }

    /// Decrypt AES-256-GCM data. Input is nonce + ciphertext + tag.
    private func decrypt(_ combined: Data) -> Data? {
        guard let key = encryptionKey else { return nil }
        do {
            let box = try AES.GCM.SealedBox(combined: combined)
            return try AES.GCM.open(box, using: key)
        } catch {
            return nil // Not encrypted or wrong key — caller falls back to plaintext
        }
    }

    // MARK: - File Paths

    private func fileURL(for contactKeyHash: Data) -> URL {
        let hex = contactKeyHash.hexCompact
        return directory.appendingPathComponent("\(hex).json")
    }

    /// Load messages for a contact from disk. Tries encrypted first, falls back to plaintext.
    public func loadMessages(for contactKeyHash: Data) -> [Message] {
        let url = fileURL(for: contactKeyHash)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do {
            let raw = try Data(contentsOf: url)
            // Try decryption first
            if let decrypted = decrypt(raw),
               let messages = try? JSONDecoder().decode([Message].self, from: decrypted) {
                return messages
            }
            // Fall back to plaintext (pre-encryption files)
            return try JSONDecoder().decode([Message].self, from: raw)
        } catch {
            Self.logger.error("Failed to load messages: \(error.localizedDescription)")
            return []
        }
    }

    /// Whether encryption is unavailable (Keychain failure). Check this to warn user.
    public var isEncryptionUnavailable: Bool { encryptionKey == nil }

    /// Save messages for a contact to disk, encrypted with AES-256-GCM.
    /// Falls back to plaintext only if encryption key is unavailable, with a warning log.
    public func saveMessages(_ messages: [Message], for contactKeyHash: Data) {
        let url = fileURL(for: contactKeyHash)
        do {
            let json = try JSONEncoder().encode(messages)
            if let encrypted = encrypt(json) {
                try encrypted.write(to: url, options: .atomic)
            } else {
                Self.logger.warning("ENCRYPT: Saving messages WITHOUT encryption — Keychain key unavailable. Messages are stored in plaintext.")
                try json.write(to: url, options: .atomic)
            }
        } catch {
            Self.logger.error("Failed to save messages: \(error.localizedDescription)")
        }
    }

    /// Delete messages for a single contact from disk.
    public func deleteMessages(for contactKeyHash: Data) {
        let url = fileURL(for: contactKeyHash)
        try? FileManager.default.removeItem(at: url)
    }

    /// Delete all message files from disk.
    public func deleteAllMessages() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else { return }
        for file in files where file.pathExtension == "json" {
            try? FileManager.default.removeItem(at: file)
        }
    }

    /// Load all persisted messages grouped by contact key hash.
    public func loadAllMessages() -> [Data: [Message]] {
        var result: [Data: [Message]] = [:]
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else { return result }

        for file in files where file.pathExtension == "json" {
            let hex = file.deletingPathExtension().lastPathComponent
            guard let keyHash = Data(hexString: hex) else { continue }
            let messages = loadMessages(for: keyHash)
            if !messages.isEmpty {
                result[keyHash] = messages
            }
        }
        return result
    }
}

extension Data {
    public init?(hexString: String) {
        let hex = hexString.replacingOccurrences(of: " ", with: "")
        guard hex.count % 2 == 0 else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else { return nil }
            data.append(byte)
            index = nextIndex
        }
        self = data
    }

    /// Format bytes as hex string: "0A 1B 2C" (space-separated, uppercase).
    /// Use `maxBytes` to truncate long data with "..." suffix.
    public func hexFormatted(separator: String = " ", maxBytes: Int? = nil) -> String {
        let slice = maxBytes.map { self.prefix($0) } ?? self
        let hex = slice.map { String(format: "%02X", $0) }.joined(separator: separator)
        if let max = maxBytes, self.count > max { return hex + "..." }
        return hex
    }

    /// Format bytes as compact hex string with no separator: "0a1b2c".
    public var hexCompact: String {
        map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Epoch Conversion Utilities

extension UInt32 {
    /// Convert epoch seconds to Date.
    public var asDate: Date { Date(timeIntervalSince1970: TimeInterval(self)) }
}

extension Date {
    /// Convert to UInt32 epoch seconds.
    public var epochUInt32: UInt32 { UInt32(timeIntervalSince1970) }
}
