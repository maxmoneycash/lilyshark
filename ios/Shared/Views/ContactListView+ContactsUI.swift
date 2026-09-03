//
//  ContactListView+ContactsUI.swift
//  PommeCore
//
//  Pending contacts, groups section, contacts section header/body
//  split from ContactListView.swift.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - Contacts UI

extension ContactListView {

    /// Contacts not assigned to any group — shown in the main Contacts section.
    var ungroupedContacts: [Contact] {
        let grouped = Set(contactStore.contactGroups.flatMap(\.memberPubkeys))
        return contactStore.sortedContacts(byLastSeen: sortByLastSeen).filter {
            !grouped.contains($0.publicKey.hexCompact)
        }
    }

    @ViewBuilder
    var pendingContactsSection: some View {
        Section {
            ForEach(contactStore.pendingNewContacts) { contact in
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.orange.opacity(0.15))
                            .frame(width: 40, height: 40)
                        Image(systemName: contactIconName(for: contact.type))
                            .foregroundStyle(.orange)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(contact.name)
                            .font(.body)
                            .foregroundStyle(MeshTheme.textPrimary)
                        Text("New contact discovered")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    Spacer()
                    Button {
                        contactStore.acceptPendingContact(contact)
                    } label: {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(MeshTheme.connected)
                    }
                    .buttonStyle(.plain)
                    Button {
                        contactStore.rejectPendingContact(contact)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(MeshTheme.disconnected)
                    }
                    .buttonStyle(.plain)
                }
                .listRowBackground(MeshTheme.surface)
            }
        } header: {
            Text("Pending Contacts")
                .foregroundStyle(.orange)
        }
    }

    @ViewBuilder
    var groupsSection: some View {
        Section {
            ForEach(contactStore.contactGroups) { group in
                DisclosureGroup {
                    let members = sortedGroupMembers(contactStore.contactsInGroup(group))
                    if members.isEmpty {
                        Text("No contacts in this group")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .listRowBackground(MeshTheme.surface)
                    } else {
                        ForEach(members) { contact in
                            #if os(watchOS)
                            NavigationLink {
                                contactDestination(contact)
                                                } label: {
                                contactRow(contact)
                            }
                            .listRowBackground(MeshTheme.surface)
                            #else
                            NavigationLink(value: SidebarSelection.contact(contact.publicKeyPrefix)) {
                                contactRow(contact)
                            }
                            .listRowBackground(MeshTheme.surface)
                            #endif
                        }
                    }
                } label: {
                    HStack {
                        if !group.emoji.isEmpty {
                            Text(group.emoji)
                        }
                        Text(group.name)
                            .foregroundStyle(MeshTheme.textPrimary)
                        if group.notifyMode == .muted {
                            Image(systemName: "bell.slash")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        } else if group.notifyMode == .priority {
                            Image(systemName: "bell.badge")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                        }
                        Spacer()
                        Text("\(group.memberPubkeys.count)")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
                .listRowBackground(MeshTheme.surface)
                .contextMenu {
                    Button {
                        renameGroupTarget = group
                        renameGroupName = group.name
                        renameGroupEmoji = group.emoji
                        showRenameGroupSheet = true
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }

                    Menu {
                        ForEach(ContactStore.GroupNotifyMode.allCases, id: \.rawValue) { mode in
                            Button {
                                contactStore.setGroupNotifyMode(group, mode: mode)
                            } label: {
                                HStack {
                                    Text(mode.rawValue)
                                    if group.notifyMode == mode {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        Label("Notifications", systemImage: group.notifyMode == .muted ? "bell.slash" : group.notifyMode == .priority ? "bell.badge" : "bell")
                    }

                    Menu {
                        ForEach(ContactStore.GroupSound.allCases, id: \.rawValue) { sound in
                            Button {
                                contactStore.setGroupSound(group, sound: sound)
                            } label: {
                                HStack {
                                    Text(sound.rawValue)
                                    if group.sound == sound {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        Label("Sound", systemImage: "speaker.wave.2")
                    }

                    Divider()

                    Button {
                        contactStore.setGroupMembersMuted(group, muted: true)
                    } label: {
                        Label("Mute All Members", systemImage: "bell.slash")
                    }

                    Button {
                        contactStore.setGroupMembersMuted(group, muted: false)
                    } label: {
                        Label("Unmute All Members", systemImage: "bell")
                    }

                    Divider()

                    Button(role: .destructive) {
                        contactStore.deleteContactGroup(group)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        contactStore.deleteContactGroup(group)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        } header: {
            HStack {
                Text("Groups")
                    .foregroundStyle(MeshTheme.textSecondary)
                Spacer()
                Button {
                    groupContactForNew = nil
                    showNewGroupSheet = true
                } label: {
                    Image(systemName: "plus.circle")
                        .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.plain)
            }
        }
    }

    var contactsSectionHeader: some View {
        HStack {
            Text("Contacts")
                .foregroundStyle(MeshTheme.textSecondary)
            Spacer()
            Button {
                sortByLastSeen.toggle()
            } label: {
                Image(systemName: sortByLastSeen ? "clock" : "textformat.abc")
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(sortByLastSeen ? Text("Sort alphabetically") : Text("Sort by last seen"))
            Menu {
                Button { showImportSheet = true } label: {
                    Label("Paste Contact Link", systemImage: "doc.on.clipboard")
                }
                Button { connectionManager.sendAdvertise(type: 1) } label: {
                    Label("Send Flood Advert", systemImage: "antenna.radiowaves.left.and.right")
                }
            } label: {
                Image(systemName: "plus")
                    .foregroundStyle(MeshTheme.accent)
            }
            .accessibilityLabel("Add contact")
            .menuIndicator(.hidden)
            Button(String(localized: isSelecting ? "Done" : "Edit")) {
                isSelecting.toggle()
                if !isSelecting { selectedContacts.removeAll() }
            }
            .font(.caption)
            .foregroundStyle(MeshTheme.accent)
        }
    }

    var contactsSection: some View {
        Section(isExpanded: $contactsExpanded) {
            if ungroupedContacts.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "person.2.slash")
                        .font(.title)
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text("No Contacts Yet")
                        .font(.headline)
                    Text("Send an advertisement to announce your presence on the mesh. Other nodes will appear here as they respond.")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button {
                        connectionManager.sendAdvertise(type: 0)
                    } label: {
                        Label("Send Advertisement", systemImage: "antenna.radiowaves.left.and.right")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(MeshTheme.interactiveGreen)
                    .foregroundStyle(.black)
                    .controlSize(.small)
                }
                .padding(.vertical, 8)
                .listRowBackground(MeshTheme.surface)
            } else {
                ForEach(ungroupedContacts) { contact in
                    #if os(watchOS)
                    NavigationLink {
                        contactDestination(contact)
                                } label: {
                        contactRow(contact)
                    }
                    .listRowBackground(MeshTheme.surface)
                    #else
                    if isSelecting {
                        Button {
                            toggleSelection(contact)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: selectedContacts.contains(contact.publicKeyPrefix) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selectedContacts.contains(contact.publicKeyPrefix) ? MeshTheme.accent : MeshTheme.textSecondary)
                                contactRow(contact)
                            }
                        }
                        .buttonStyle(.plain)
                    } else {
                    NavigationLink(value: SidebarSelection.contact(contact.publicKeyPrefix)) {
                        contactRow(contact)
                    }
                    .contextMenu {
                        contactContextMenu(for: contact)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            contactToDelete = contact
                            // Defer alert so swipe dismissal animation completes first
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                showDeleteConfirm = true
                            }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            contactStore.toggleFavourite(for: contact)
                        } label: {
                            Label(
                                contact.isFavourite ? "Unfavourite" : "Favourite",
                                systemImage: contact.isFavourite ? "star.slash" : "star.fill"
                            )
                        }
                        .tint(.yellow)
                    }
                    .listRowBackground(
                        navigationStore.selectedContactKey == contact.publicKeyPrefix
                            && !navigationStore.showPublicChannel
                            ? MeshTheme.surfaceLight
                            : MeshTheme.surface
                    )
                    } // end else (not selecting)
                    #endif
                }
            }

            // Paste Link and Scan QR are in the contacts "+" header menu
            if isSelecting {
                HStack {
                    Button(selectedContacts.count == ungroupedContacts.count ? "Deselect All" : "Select All") {
                        if selectedContacts.count == ungroupedContacts.count {
                            selectedContacts.removeAll()
                        } else {
                            selectedContacts = Set(ungroupedContacts.map(\.publicKeyPrefix))
                        }
                    }
                    .font(.caption)
                    Spacer()
                    if !selectedContacts.isEmpty {
                        Button {
                            for key in selectedContacts {
                                if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) {
                                    messageStoreManager.lastExportedURL = nil; connectionManager.exportContact(contact)
                                }
                            }
                        } label: {
                            Text("Export (\(selectedContacts.count))")
                                .font(.caption.weight(.medium))
                        }
                        Button(role: .destructive) {
                            showBulkDeleteConfirm = true
                        } label: {
                            Text("Delete (\(selectedContacts.count))")
                                .font(.caption.weight(.medium))
                        }
                    }
                }
                .listRowBackground(MeshTheme.surface)
            }
        } header: {
            contactsSectionHeader
        }
        // Delete alerts live in deleteAlertsOverlay (deferred presentation avoids swipe/context menu conflicts).
        .alert("Import from Link", isPresented: $showImportSheet) {
            TextField("meshcore:// URL", text: $importURLText)
            Button("Cancel", role: .cancel) {}
            Button("Import") {
                let url = importURLText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !url.isEmpty {
                    if !channelStore.handleChannelURL(url), url.hasPrefix("meshcore://") {
                        connectionManager.importContact(url: url)
                        contactStore.requestContacts(fullSync: true)
                    }
                }
            }
        } message: {
            Text("Paste a meshcore:// link to import a contact or channel.")
        }
        #if os(iOS)
        .sheet(isPresented: $showQRScanner) {
            NavigationStack {
                QRScannerView { scannedURL in
                    showQRScanner = false
                    if !channelStore.handleChannelURL(scannedURL), scannedURL.hasPrefix("meshcore://") {
                        connectionManager.importContact(url: scannedURL)
                        contactStore.requestContacts(fullSync: true)
                    }
                }
                .navigationTitle("Scan QR Code")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showQRScanner = false }
                    }
                }
            }
            .meshTheme()
        }
        #endif
        .confirmationDialog(
            "Import Channel",
            isPresented: Bindable(channelStore).showChannelImportOptions,
            presenting: channelStore.pendingChannelImport
        ) { data in
            Button("Add Channel") {
                channelStore.importChannelAdd(data, maxChannels: deviceConfig.maxChannels)
                channelStore.pendingChannelImport = nil
            }
            Button("Replace All Channels", role: .destructive) {
                channelStore.importChannelReplaceAll(data)
                channelStore.pendingChannelImport = nil
            }
            Button("Cancel", role: .cancel) {
                channelStore.pendingChannelImport = nil
            }
        } message: { data in
            Text("Add \"\(data.name)\" to your channels, or replace all existing channels?")
        }
        .confirmationDialog(
            "Import \(channelStore.pendingMultiChannelImport?.channels.count ?? 0) Channels",
            isPresented: Bindable(channelStore).showMultiChannelImportOptions,
            presenting: channelStore.pendingMultiChannelImport
        ) { data in
            Button("Add to Existing Channels") {
                channelStore.importMultiChannelsAdd(data, maxChannels: deviceConfig.maxChannels)
                channelStore.pendingMultiChannelImport = nil
            }
            Button("Replace All Channels", role: .destructive) {
                channelStore.importMultiChannelsReplace(data, maxChannels: deviceConfig.maxChannels)
                channelStore.pendingMultiChannelImport = nil
            }
            Button("Cancel", role: .cancel) {
                channelStore.pendingMultiChannelImport = nil
            }
        } message: { data in
            Text("Import \(data.names)?\n\nAdd will keep your existing channels. Replace will remove all current channels first.")
        }
        .confirmationDialog("Send Advertisement", isPresented: $showAdvertOptions) {
            Button("Zero-Hop (nearby only)") {
                lastAdvertFlood = false
                connectionManager.sendAdvertise(type: 0)
                showAdvertSent?.wrappedValue = true
            }
            Button("Flood (entire mesh)") {
                lastAdvertFlood = true
                connectionManager.sendAdvertise(type: 1)
                showAdvertSent?.wrappedValue = true
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Zero-hop reaches nearby nodes only. Flood is relayed by repeaters across the entire mesh network.")
        }
    }
}
