//
//  ContactListView+ContactActions.swift
//  PommeCore
//
//  Contact context menu, helper functions, and navigation destinations
//  split from ContactListView.swift.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif

// MARK: - Contact Actions & Helpers

extension ContactListView {

    var conversationQuery: String {
        conversationSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var isFilteringConversations: Bool {
        !conversationQuery.isEmpty || conversationFilter != .all
    }

    func isMeshtasticContact(_ contact: Contact) -> Bool {
        #if canImport(MeshtasticKit)
        MeshtasticIdentity.nodeNum(forSyntheticKey: contact.publicKey) != nil
        #else
        false
        #endif
    }

    func supportsMeshCoreCommands(for contact: Contact) -> Bool {
        !isMeshtasticContact(contact) && !connectionManager.isMeshtasticLinkActive
    }

    func canChangeContact(_ contact: Contact) -> Bool {
        isMeshtasticContact(contact) || (supportsMeshCoreCommands(for: contact) && connectionManager.connectionState == .ready)
    }

    var selectedContactsAreLocal: Bool {
        !selectedContacts.isEmpty && selectedContacts.allSatisfy { key in
            contactStore.contacts.first { $0.publicKeyPrefix == key }.map(isMeshtasticContact) ?? false
        }
    }

    var matchingContacts: [Contact] {
        contactStore.sortedContacts(byLastSeen: sortByLastSeen).filter { contact in
            switch conversationFilter {
            case .unread:
                guard messageStoreManager.unreadCount(for: contact) > 0 else { return false }
            case .favourites:
                guard contact.isFavourite else { return false }
            case .all: break
            }
            guard !conversationQuery.isEmpty else { return true }
            var names = [contactStore.displayName(for: contact), contact.name, contact.publicKey.hexCompact]
            #if canImport(MeshtasticKit)
            if let node = MeshtasticIdentity.nodeNum(forSyntheticKey: contact.publicKey) {
                names.append(String(format: "!%08x", node))
            }
            #endif
            names += contactStore.contactGroups.filter {
                $0.memberPubkeys.contains(contact.publicKey.hexCompact)
            }.map(\.name)
            return names.contains { $0.localizedStandardContains(conversationQuery) }
        }
    }

    func matchesChannel(index: UInt8, name: String) -> Bool {
        if conversationFilter == .favourites { return false }
        if conversationFilter == .unread,
           (messageStoreManager.unreadCounts[Data([index])] ?? 0) == 0 { return false }
        return conversationQuery.isEmpty || name.localizedStandardContains(conversationQuery)
    }

    var hasMatchingChannels: Bool {
        matchesChannel(index: 0, name: "Public Channel") || channelStore.channels.contains {
            $0.index != 0 && matchesChannel(index: $0.index, name: $0.name)
        }
    }

    func revealFilteredConversations() {
        // A bulk action must not apply to contacts hidden by a new filter.
        selectedContacts.removeAll()
        isSelecting = false
        guard isFilteringConversations else { return }
        contactsExpanded = true
        channelsExpanded = true
    }

    var conversationSearchEmptyState: some View {
        ContentUnavailableView {
            if !conversationQuery.isEmpty {
                Label("No matching conversations", systemImage: "magnifyingglass")
            } else if conversationFilter == .favourites {
                Label("No favourites yet", systemImage: "star")
            } else {
                Label("No unread conversations", systemImage: "tray")
            }
        } description: {
            if !conversationQuery.isEmpty {
                Text("Try another name or node ID, or show all conversations.")
            } else if conversationFilter == .favourites {
                Text("Swipe right on a contact or use its menu to add a favourite.")
            } else {
                Text("New unread messages will appear here.")
            }
        } actions: {
            Button("Show all conversations") {
                conversationSearch = ""
                conversationFilter = .all
            }
            .buttonStyle(.meshSecondary)
        }
        .listRowBackground(MeshTheme.surface)
    }

    @ViewBuilder
    func contactContextMenu(for contact: Contact) -> some View {
        // Nickname — always first, most used
        Button {
            nicknameContact = contact
            nicknameText = contactStore.nickname(for: contact) ?? ""
            showNicknameSheet = true
        } label: {
            contactStore.nickname(for: contact) != nil
                ? Label("Edit Nickname", systemImage: "pencil")
                : Label("Set Nickname", systemImage: "pencil")
        }

        if supportsMeshCoreCommands(for: contact) {
        Group {
        // Type-specific actions
        if contact.type == .repeater || contact.type == .room {
            Button {
                navigationStore.sidebarSelection = .contact(contact.publicKeyPrefix)
            } label: {
                Label("Remote Management", systemImage: "gearshape.2")
            }
        }

        if contact.type != .chat {
            Button {
                remoteSessionManager.requestStatus(for: contact)
            } label: {
                Label("Request Status", systemImage: "antenna.radiowaves.left.and.right")
            }
        }

        Button {
            remoteSessionManager.requestTelemetry(for: contact)
        } label: {
            Label("Request Telemetry", systemImage: "gauge.with.dots.needle.bottom.50percent")
        }

        if contact.type == .chat {
            Button {
                isExporting = true
                messageStoreManager.lastExportedURL = nil; connectionManager.exportContact(contact)
            } label: {
                Label("Share Contact", systemImage: "square.and.arrow.up")
            }
        }

        Button {
            pathEditorContact = contact
        } label: {
            Label("Edit Route", systemImage: "arrow.triangle.branch")
        }

        if contact.outPathLen > 0 && !contact.outPath.isEmpty {
            Button {
                remoteSessionManager.traceRoute(to: contact)
            } label: {
                Label("Trace Route", systemImage: "point.3.connected.trianglepath.dotted")
            }
        }
        }
        .disabled(connectionManager.connectionState != .ready)
        }

        Button {
            contactStore.toggleFavourite(for: contact)
        } label: {
            Label(
                contact.isFavourite ? "Remove from Favourites" : "Add to Favourites",
                systemImage: contact.isFavourite ? "star.slash" : "star"
            )
        }
        .disabled(!canChangeContact(contact))

        if contact.type == .chat {
            Menu {
                ForEach(contactStore.contactGroups) { group in
                    let isMember = group.memberPubkeys.contains(contact.publicKey.hexCompact)
                    Button {
                        if isMember {
                            contactStore.removeContactFromGroup(contact, group: group)
                        } else {
                            contactStore.addContactToGroup(contact, group: group)
                        }
                    } label: {
                        Label(group.name, systemImage: isMember ? "checkmark.circle.fill" : GroupIcon.symbolName(for: group.emoji))
                    }
                }
                if !contactStore.contactGroups.isEmpty { Divider() }
                Button {
                    groupContactForNew = contact
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        showNewGroupSheet = true
                    }
                } label: {
                    Label("New Group…", systemImage: "folder.badge.plus")
                }
            } label: {
                Label("Groups", systemImage: "folder")
            }
        }

        Button {
            detailContact = contact
        } label: {
            Label("Network Details", systemImage: "info.circle")
        }

        if supportsMeshCoreCommands(for: contact) {
        Button {
            contactStore.resetPath(for: contact)
            showResetConfirmation = true
        } label: {
            Label("Reset Path", systemImage: "arrow.counterclockwise")
        }
        .disabled(connectionManager.connectionState != .ready)
        }

        Button {
            contactStore.toggleContactMuted(contact)
        } label: {
            contactStore.isContactMuted(contact)
                ? Label("Unmute", systemImage: "bell")
                : Label("Mute", systemImage: "bell.slash")
        }

        Divider()

        Button(role: .destructive) {
            contactStore.blockContact(contact)
        } label: {
            Label("Block Contact", systemImage: "hand.raised")
        }

        Button(role: .destructive) {
            contactToDelete = contact
            // Defer alert so context menu dismissal completes first
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                showDeleteConfirm = true
            }
        } label: {
            Label(isMeshtasticContact(contact) ? "Remove Local Contact" : "Delete Contact", systemImage: "trash")
        }
        .disabled(!canChangeContact(contact))
    }

    func toggleSelection(_ contact: Contact) {
        if selectedContacts.contains(contact.publicKeyPrefix) {
            selectedContacts.remove(contact.publicKeyPrefix)
        } else {
            selectedContacts.insert(contact.publicKeyPrefix)
        }
    }

    func sortedGroupMembers(_ members: [Contact]) -> [Contact] {
        members.filter { !contactStore.isBlocked($0) }.sorted { a, b in
            if a.isFavourite != b.isFavourite {
                return a.isFavourite
            }
            if sortByLastSeen {
                return contactStore.lastActivityTimestamp(for: a) > contactStore.lastActivityTimestamp(for: b)
            }
            let nameA = contactStore.displayName(for: a).strippingEmoji
            let nameB = contactStore.displayName(for: b).strippingEmoji
            return nameA.localizedCaseInsensitiveCompare(nameB) == .orderedAscending
        }
    }

    func contactRow(_ contact: Contact) -> some View {
        ContactRowView(contact: contact, refreshTick: refreshTick)
    }

    /// Returns the appropriate detail view for a contact based on its type.
    @ViewBuilder
    func contactDestination(_ contact: Contact) -> some View {
        switch contact.type {
        case .room:
            RoomChatView(
                contact: contact,
                session: remoteSessionManager.remoteSession(for: contact)
            )
            .id(contact.publicKeyPrefix)
        case .repeater:
            RepeaterLoginView(
                contact: contact,
                session: remoteSessionManager.remoteSession(for: contact)
            )
            .id(contact.publicKeyPrefix)
        default:
            ChatView(contact: contact)
                .id(contact.publicKeyPrefix)
        }
    }

    #if !os(watchOS)
    /// Resolves a SidebarSelection to the appropriate detail view (used by navigationDestination on compact).
    @ViewBuilder
    func sidebarDestinationView(for selection: SidebarSelection) -> some View {
        switch selection {
        case .publicChannel:
            ChannelChatView(channelIndex: 0, channelName: "Public Channel")
                .id(0)
        case .channel(let index):
            if let channel = channelStore.channels.first(where: { $0.index == index }) {
                ChannelChatView(channelIndex: channel.index, channelName: channel.name)
                    .id(channel.index)
            } else {
                ChannelChatView(channelIndex: index, channelName: "Channel \(index)")
                    .id(index)
            }
        case .contact(let key):
            if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) {
                contactDestination(contact)
            } else {
                Text("Contact not found")
            }
        case .settings:
            SettingsView()
        case .map:
            if #available(iOS 17.0, macOS 14.0, *) {
                MeshMapView()
            } else {
                Text("Map requires iOS 17+ or macOS 14+")
            }
        case .tools:
            ToolsView()
        #if os(macOS) || targetEnvironment(macCatalyst)
        case .usbTerminal:
            USBTerminalView()
        case .usbDevice:
            if let contact = remoteSessionManager.usbDeviceContact, let session = remoteSessionManager.usbDeviceSession {
                RemoteManagementView(contact: contact, session: session)
                } else {
                Text("USB device not connected")
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        #endif
        }
    }
    #endif

    func contactIconName(for type: ContactType) -> String {
        switch type {
        case .chat: return "person.fill"
        case .repeater: return "antenna.radiowaves.left.and.right"
        case .room: return "server.rack"
        case .sensor: return "sensor.fill"
        case .unknown: return "person.fill"
        }
    }
}
