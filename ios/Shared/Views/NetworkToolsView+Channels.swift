//
//  NetworkToolsView+Channels.swift
//  PommeCore
//
//  Channel management: join hashtag, create private, join private channels.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import CryptoKit
import MeshCoreKit

// MARK: - Channel Management View

enum ChannelAction: String, CaseIterable, Identifiable {
    case hashtag = "Join Hashtag Channel"
    case createPrivate = "Create Private Channel"
    case joinPrivate = "Join Private Channel"

    var id: String { rawValue }

    var navigationTitle: String {
        switch self {
        case .hashtag: return String(localized: "Join Hashtag Channel")
        case .createPrivate: return String(localized: "Create Private Channel")
        case .joinPrivate: return String(localized: "Join Private Channel")
        }
    }
}

struct ChannelManagementView: View {
    let action: ChannelAction
    @Environment(ChannelStore.self) private var channelStore
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(\.dismiss) private var dismiss
    #if !os(watchOS)
    @State private var channelToShare: MeshChannel?
    #endif
    @State private var channelToRename: MeshChannel?
    @State private var renameText = ""

    @State private var channelName = ""
    @State private var secretHex = ""
    @State private var errorMessage: String?

    /// Public channel secret (well-known PSK)
    private static let publicChannelSecret = Data([
        0x8b, 0x33, 0x87, 0xe9, 0xc5, 0xcd, 0xea, 0x6a,
        0xc9, 0xe5, 0xed, 0xba, 0xa1, 0x15, 0xcd, 0x72
    ])

    var body: some View {
        List {
            Section {
                HStack {
                    Image(systemName: action == .hashtag ? "number" : "lock.fill")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    TextField(namePlaceholder, text: $channelName)
                        .foregroundStyle(MeshTheme.textPrimary)
                        #if !os(watchOS)
                        .textFieldStyle(MeshTextFieldStyle())
                        #endif
                }
                .listRowBackground(MeshTheme.surface)

                if action == .joinPrivate {
                    HStack {
                        Image(systemName: "lock")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        TextField("Secret (hex)", text: $secretHex)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .font(.system(.body, design: .monospaced))
                            #if !os(watchOS)
                            .textFieldStyle(MeshTextFieldStyle())
                            #endif
                    }
                    .listRowBackground(MeshTheme.surface)
                }

                if let error = errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(MeshTheme.surface)
                }

                Button {
                    joinChannel()
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(MeshTheme.accent)
                        Text(actionButtonLabel)
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(channelName.trimmingCharacters(in: .whitespaces).isEmpty)
                .listRowBackground(MeshTheme.surface)
            } footer: {
                Text(footerText)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .font(.caption2)
            }

            if !channelStore.channels.filter({ $0.index != 0 }).isEmpty {
                Section {
                    ForEach(channelStore.channels.filter { $0.index != 0 }) { channel in
                        HStack {
                            Image(systemName: channel.channelType.iconName)
                                .foregroundStyle(MeshTheme.accent)
                                .frame(width: 24)
                            Text("\(channel.channelType.displayPrefix)\(channel.name)")
                                .foregroundStyle(MeshTheme.textPrimary)
                            Spacer()
                            Text("Slot \(channel.index)")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                            #if !os(watchOS)
                            Button {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    channelToShare = channel
                                }
                            } label: {
                                Image(systemName: "qrcode")
                                    .foregroundStyle(MeshTheme.accent)
                            }
                            .buttonStyle(.plain)
                            #endif
                            Button {
                                removeChannel(channel)
                            } label: {
                                Image(systemName: "trash")
                                    .foregroundStyle(MeshTheme.disconnected)
                            }
                            .buttonStyle(.plain)
                        }
                        .listRowBackground(MeshTheme.surface)
                        .contextMenu {
                            Button {
                                channelToRename = channel
                                renameText = channel.name
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            #if !os(watchOS)
                            Button {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    channelToShare = channel
                                }
                            } label: {
                                Label("Share QR Code", systemImage: "qrcode")
                            }
                            #endif
                            Divider()
                            Button(role: .destructive) {
                                removeChannel(channel)
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                    }
                } header: {
                    Text("Active Channels")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
        }
        .meshListStyle()
        .navigationTitle(action.navigationTitle)
        #if !os(watchOS)
        .sheet(item: $channelToShare) { channel in
            ShareChannelSheet(channel: channel)
                #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
                #endif
        }
        #endif
        .alert("Rename Channel", isPresented: Binding(
            get: { channelToRename != nil },
            set: { if !$0 { channelToRename = nil } }
        )) {
            TextField("Channel name", text: $renameText)
            Button("Cancel", role: .cancel) { channelToRename = nil }
            Button("Rename") {
                if let ch = channelToRename, !renameText.isEmpty {
                    channelStore.setChannel(index: ch.index, name: renameText, secret: ch.secret)
                }
                channelToRename = nil
            }
        } message: {
            Text("Enter a new name for this channel.")
        }
    }

    private var namePlaceholder: String {
        switch action {
        case .hashtag: return "#channel-name"
        case .createPrivate: return String(localized: "Channel name")
        case .joinPrivate: return String(localized: "Channel name")
        }
    }

    private var footerText: String {
        switch action {
        case .hashtag:
            return String(localized: "Hashtag channels derive their encryption key from the channel name. Anyone who knows the name can join.")
        case .createPrivate:
            return String(localized: "Creates a channel with a random 128-bit encryption key. Share the key with others to let them join.")
        case .joinPrivate:
            return String(localized: "Enter the channel name and the shared hex secret to join an existing private channel.")
        }
    }

    private var actionButtonLabel: String {
        switch action {
        case .hashtag:
            let name = channelName.trimmingCharacters(in: .whitespaces)
            let display = name.hasPrefix("#") ? name : "#\(name)"
            return name.isEmpty ? String(localized: "Join") : String(format: String(localized: "Join %@"), display)
        case .createPrivate:
            return String(localized: "Create Channel")
        case .joinPrivate:
            return String(localized: "Join Channel")
        }
    }

    private func joinChannel() {
        let name = channelName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        errorMessage = nil

        // Find first empty slot (skip slot 0 = public channel)
        let maxCh = Int(deviceConfig.maxChannels)
        let usedIndices = Set(channelStore.channels.map { $0.index })
        guard let freeSlot = (1..<maxCh).first(where: { !usedIndices.contains(UInt8($0)) }) else {
            errorMessage = "No free channel slots available."
            return
        }

        let secret: Data
        switch action {
        case .hashtag:
            // Derive secret from channel name by hashing
            let hashName = name.hasPrefix("#") ? name : "#\(name)"
            secret = deriveHashChannelSecret(hashName)
            let displayName = hashName
            channelStore.setChannel(index: UInt8(freeSlot), name: displayName, secret: secret)

        case .createPrivate:
            // Generate random 16-byte (128-bit) secret
            var randomBytes = [UInt8](repeating: 0, count: 16)
            _ = SecRandomCopyBytes(kSecRandomDefault, 16, &randomBytes)
            secret = Data(randomBytes)
            channelStore.setChannel(index: UInt8(freeSlot), name: name, secret: secret)

        case .joinPrivate:
            let hex = secretHex.trimmingCharacters(in: .whitespaces)
            guard let parsed = Data(hexString: hex), parsed.count == 16 else {
                errorMessage = "Secret must be exactly 16 bytes (32 hex characters)."
                return
            }
            secret = parsed
            channelStore.setChannel(index: UInt8(freeSlot), name: name, secret: secret)
        }

        channelName = ""
        secretHex = ""
    }

    private func removeChannel(_ channel: MeshChannel) {
        channelStore.setChannel(index: channel.index, name: "", secret: nil)
    }

    /// Derive a channel secret from a hashtag name by hashing (SHA-256).
    private func deriveHashChannelSecret(_ name: String) -> Data {
        guard let nameData = name.data(using: .utf8) else { return Data(repeating: 0, count: 16) }
        let digest = SHA256.hash(data: nameData)
        return Data(digest.prefix(16))  // 128-bit PSK from first 16 bytes of SHA-256
    }
}

// MARK: - Hex String Data Extension

private extension Data {
    init?(hexString: String) {
        let hex = hexString.replacingOccurrences(of: " ", with: "")
        guard hex.count % 2 == 0 else { return nil }
        var data = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else { return nil }
            data.append(byte)
            index = nextIndex
        }
        self = data
    }
}
