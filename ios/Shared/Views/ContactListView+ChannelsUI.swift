//
//  ContactListView+ChannelsUI.swift
//  PommeCore
//
//  Connection status, public channel, channels section, and channel rows
//  split from ContactListView.swift.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - Connection & Channels UI

extension ContactListView {

    @ViewBuilder
    var connectionSection: some View {
        Section {
            Button {
                if connectionManager.connectionState == .ready || connectionManager.connectionState == .connected {
                    #if os(macOS) || targetEnvironment(macCatalyst)
                    if isUSBCLIConnected {
                        navigationStore.sidebarSelection = .usbDevice
                    } else {
                        openSettings()
                    }
                    #elseif !os(watchOS)
                    openSettings()
                    #endif
                } else {
                    showScanner = true
                }
            } label: {
                HStack {
                    Image(systemName: connectionSymbol)
                        .font(.system(size: 10))
                        .foregroundStyle(connectionColor)
                        .shadow(color: connectionColor.opacity(0.6), radius: 4)
                        .accessibilityHidden(true)
                    Text(connectionLabel)
                        .font(.subheadline)
                        .foregroundStyle(connectionColor)
                    Spacer()
                    if let rawName = {
                        if !deviceConfig.deviceName.isEmpty { return deviceConfig.deviceName }
                        if let name = connectionManager.connectedDeviceName { return name }
                        #if os(macOS) || targetEnvironment(macCatalyst)
                        if let name = remoteSessionManager.usbDeviceContact?.name, isUSBCLIConnected { return "USB: \(name)" }
                        #endif
                        return nil as String?
                    }() {
                        let shortName = rawName
                            .replacingOccurrences(of: "MeshCore-", with: "")
                            .replacingOccurrences(of: "meshcore-", with: "")
                        HStack(spacing: 4) {
                            Text(shortName)
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                            if deviceConfig.batteryPercent() > 0 {
                                let pct = deviceConfig.batteryPercent()
                                Text(String(format: "• %d%%", pct))
                                    .font(.caption2)
                                    .foregroundStyle(pct > 50 ? .green : pct > 20 ? .yellow : .red)
                            }
                        }
                    } else {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            .contextMenu {
                if connectionManager.connectionState == .ready || connectionManager.connectionState == .connected {
                    #if os(macOS) || targetEnvironment(macCatalyst)
                    if isUSBCLIConnected {
                        Button(role: .destructive) { remoteSessionManager.reset(); connectionManager.disconnectUSB() } label: {
                            Label("Disconnect USB", systemImage: "cable.connector.slash")
                        }
                    } else {
                        Button { showMyContactCode = true } label: {
                            Label("My Contact Code", systemImage: "qrcode")
                        }
                        if !deviceConfig.publicKeyHex.isEmpty {
                            Button {
                                copyToClipboard(deviceConfig.publicKeyHex)
                            } label: {
                                Label("Copy Public Key", systemImage: "doc.on.doc")
                            }
                        }
                        Divider()
                        if connectionManager.usbManager.isConnected {
                            Button(role: .destructive) { connectionManager.disconnectUSB() } label: {
                                Label("Disconnect USB", systemImage: "cable.connector.slash")
                            }
                        } else {
                            Button(role: .destructive) { connectionManager.disconnect() } label: {
                                Label("Disconnect", systemImage: "xmark.circle")
                            }
                        }
                    }
                    #else
                    Button { showMyContactCode = true } label: {
                        Label("My Contact Code", systemImage: "qrcode")
                    }
                    if !deviceConfig.publicKeyHex.isEmpty {
                        Button {
                            copyToClipboard(deviceConfig.publicKeyHex)
                        } label: {
                            Label("Copy Public Key", systemImage: "doc.on.doc")
                        }
                    }
                    Divider()
                    Button(role: .destructive) { connectionManager.disconnect() } label: {
                        Label("Disconnect", systemImage: "xmark.circle")
                    }
                    #endif
                }
            }

            if let bleMsg = connectionManager.bleStatusMessage,
               connectionManager.connectionState == .disconnected {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(bleMsg)
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                .listRowBackground(MeshTheme.surface)
            }
        } header: {
            #if !os(watchOS)
            HStack {
                Text("Status")
                    .foregroundStyle(MeshTheme.textSecondary)
                Spacer()
                Button {
                    openSettings()
                } label: {
                    Image(systemName: "gearshape")
                        .foregroundStyle(MeshTheme.accent)
                }
                .accessibilityLabel("Settings")
                .buttonStyle(.plain)
            }
            #endif
        }
    }

    var publicChannelRow: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(MeshTheme.accent.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: "megaphone.fill")
                    .foregroundStyle(MeshTheme.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Public Channel")
                    .font(.body)
                    .foregroundStyle(MeshTheme.textPrimary)
                channelMessagePreview
            }
            Spacer()
            channelUnreadBadge
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    var channelMessagePreview: some View {
        let messages = messageStoreManager.messagesByContact[publicChannelKey] ?? []
        if let last = messages.last {
            Text(last.text)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .lineLimit(1)
        } else {
            Text("Mesh broadcast channel")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }

    @ViewBuilder
    var channelUnreadBadge: some View {
        let count = messageStoreManager.unreadCounts[publicChannelKey] ?? 0
        if count > 0 {
            Text("\(count)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(MeshTheme.interactiveGreen)
                .clipShape(Capsule())
        }
    }

    @ViewBuilder
    var channelsSection: some View {
        Section(isExpanded: $channelsExpanded) {
            // Public channel is always the first item
            #if os(watchOS)
            NavigationLink {
                ChannelChatView(channelIndex: 0, channelName: "Public Channel")
            } label: {
                publicChannelRow
            }
            .listRowBackground(MeshTheme.surface)
            #else
            NavigationLink(value: SidebarSelection.publicChannel) {
                publicChannelRow
            }
            .listRowBackground(
                navigationStore.showPublicChannel
                    ? MeshTheme.surfaceLight
                    : MeshTheme.surface
            )
            #endif

            ForEach(channelStore.channels.filter { $0.index != 0 }) { channel in
                #if os(watchOS)
                NavigationLink {
                    ChannelChatView(channelIndex: channel.index, channelName: channel.name)
                } label: {
                    channelRow(channel)
                }
                .listRowBackground(MeshTheme.surface)
                #else
                NavigationLink(value: SidebarSelection.channel(channel.index)) {
                    channelRow(channel)
                }
                .contextMenu {
                    Button {
                        channelToShareSidebar = channel
                    } label: {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }

                    Button {
                        channelToRenameSidebar = channel
                        channelRenameText = channel.name
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }

                    Divider()

                    Button(role: .destructive) {
                        channelToRemove = channel
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            showChannelRemoveConfirm = true
                        }
                    } label: {
                        Label("Remove Channel", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        channelToRemove = channel
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            showChannelRemoveConfirm = true
                        }
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
                .listRowBackground(
                    navigationStore.selectedChannelIndex == channel.index
                        ? MeshTheme.surfaceLight
                        : MeshTheme.surface
                )
                #endif
            }
        } header: {
            HStack {
                Text("Channels")
                    .foregroundStyle(MeshTheme.textSecondary)
                if channelStore.isSyncingChannels {
                    ProgressView()
                        .controlSize(.mini)
                }
                Spacer()
                #if !os(watchOS)
                Menu {
                    Button { channelSheetAction = .createPrivate } label: {
                        Label("Create Private Channel", systemImage: "lock.fill")
                    }
                    Button { channelSheetAction = .hashtag } label: {
                        Label("Join Hashtag Channel", systemImage: "number")
                    }
                    Button { channelSheetAction = .joinPrivate } label: {
                        Label("Join Private Channel", systemImage: "key.fill")
                    }
                    Button { showImportSheet = true } label: {
                        Label("Paste Channel Link", systemImage: "doc.on.clipboard")
                    }
                    if !channelStore.channels.isEmpty {
                        Divider()
                        Button { showShareAllChannels = true } label: {
                            Label("Share All Channels", systemImage: "square.and.arrow.up")
                        }
                    }
                } label: {
                    Image(systemName: "plus")
                        .foregroundStyle(MeshTheme.accent)
                }
                .accessibilityLabel("Add channel")
                .menuIndicator(.hidden)
                #endif
            }
        }
    }

    func channelRow(_ channel: MeshChannel) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(MeshTheme.accent.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: channel.channelType.iconName)
                    .foregroundStyle(MeshTheme.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("\(channel.channelType.displayPrefix)\(channel.name)")
                    .font(.body)
                    .foregroundStyle(MeshTheme.textPrimary)
                let messages = messageStoreManager.messagesByContact[Data([channel.index])] ?? []
                if let last = messages.last {
                    Text(last.text)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .lineLimit(1)
                } else {
                    (channel.channelType == .privateChannel ? Text("Private channel") : Text("Group channel"))
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            Spacer()
            let count = messageStoreManager.unreadCounts[Data([channel.index])] ?? 0
            if count > 0 {
                Text("\(count)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(MeshTheme.interactiveGreen)
                    .clipShape(Capsule())
            }
        }
        .contentShape(Rectangle())
    }

    var connectionColor: Color {
        switch connectionManager.connectionState {
        case .ready: MeshTheme.connected
        case .connected, .connecting: MeshTheme.connecting
        case .scanning: MeshTheme.scanning
        case .disconnected: MeshTheme.disconnected
        }
    }

    var connectionSymbol: String {
        connectionManager.connectionState == .disconnected ? "circle" : "circle.fill"
    }

    var connectionLabel: String {
        switch connectionManager.connectionState {
        case .ready: String(localized: "Connected")
        case .connected: String(localized: "Discovering services...")
        case .connecting: String(localized: "Connecting...")
        case .scanning: String(localized: "Scanning...")
        case .disconnected: String(localized: "Disconnected")
        }
    }
}
