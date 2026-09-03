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

// MARK: - Contact Actions & Helpers

extension ContactListView {

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

        Button {
            contactStore.toggleFavourite(for: contact)
        } label: {
            Label(
                contact.isFavourite ? "Remove from Favourites" : "Add to Favourites",
                systemImage: contact.isFavourite ? "star.slash" : "star"
            )
        }

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
                        Label("\(group.emoji) \(group.name)", systemImage: isMember ? "checkmark.circle.fill" : "plus.circle")
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

        Button {
            contactStore.resetPath(for: contact)
            showResetConfirmation = true
        } label: {
            Label("Reset Path", systemImage: "arrow.counterclockwise")
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
            Label("Delete Contact", systemImage: "trash")
        }
    }

    func toggleSelection(_ contact: Contact) {
        if selectedContacts.contains(contact.publicKeyPrefix) {
            selectedContacts.remove(contact.publicKeyPrefix)
        } else {
            selectedContacts.insert(contact.publicKeyPrefix)
        }
    }

    func sortedGroupMembers(_ members: [Contact]) -> [Contact] {
        members.sorted { a, b in
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
        case .repeater:
            RepeaterLoginView(
                contact: contact,
                session: remoteSessionManager.remoteSession(for: contact)
            )
        default:
            ChatView(contact: contact)
                .onAppear { messageStoreManager.markAsRead(contact) }
        }
    }

    #if !os(watchOS)
    /// Resolves a SidebarSelection to the appropriate detail view (used by navigationDestination on compact).
    @ViewBuilder
    func sidebarDestinationView(for selection: SidebarSelection) -> some View {
        switch selection {
        case .publicChannel:
            ChannelChatView(channelIndex: 0, channelName: "Public Channel")
        case .channel(let index):
            if let channel = channelStore.channels.first(where: { $0.index == index }) {
                ChannelChatView(channelIndex: channel.index, channelName: channel.name)
            } else {
                ChannelChatView(channelIndex: index, channelName: "Channel \(index)")
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
