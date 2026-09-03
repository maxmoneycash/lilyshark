//
//  ContactListView.swift
//  PommeCore
//
//  Sidebar contact/channel list, connection status, context menus, and edit mode.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

struct ContactListView: View {
    @Environment(ContactStore.self) var contactStore
    @Environment(ChannelStore.self) var channelStore
    @Environment(MessageStoreManager.self) var messageStoreManager
    @Environment(ConnectionManager.self) var connectionManager
    @Environment(RemoteSessionManager.self) var remoteSessionManager
    @Environment(DeviceConfig.self) var deviceConfig
    @Environment(NavigationStore.self) var navigationStore
    @Binding var showScanner: Bool
    var showDiscover: Binding<Bool>? = nil
    var showSettings: Binding<Bool>? = nil
    var showRemoteManagement: Binding<Bool>? = nil
    var showAdvertSent: Binding<Bool>? = nil

    @State var showDistressBeacon = false
    @State var showAdvertOptions = false
    @State var lastAdvertFlood = false
    @State var contactToDelete: Contact?
    @State var showDeleteConfirm = false
    @State var showImportSheet = false
    @State var importURLText = ""
    @State var showShareConfirmation = false
    @State var showResetConfirmation = false
    @State var detailContact: Contact?
    @State var channelSheetAction: ChannelAction?
    // showDeviceInfo removed — connection bar now navigates to Settings
    #if !os(watchOS)
    @State var channelToShareSidebar: MeshChannel?
    @State var channelToRenameSidebar: MeshChannel?
    @State var channelRenameText = ""
    @State var showChannelRemoveConfirm = false
    @State var channelToRemove: MeshChannel?
    @State var showShareAllChannels = false
    #endif
    @State var showNicknameSheet = false
    #if os(iOS)
    @State var showQRScanner = false
    #endif
    #if !os(watchOS)
    @State var showMyContactCode = false
    #endif
    @State var nicknameContact: Contact?
    @State var nicknameText = ""
    @State var isSelecting = false
    @State var selectedContacts: Set<Data> = [] // publicKeyPrefix
    @State var showBulkDeleteConfirm = false
    @State var pathEditorContact: Contact?
    @State var showExportCopied = false
    @State var isExporting = false
    @State var showNewGroupSheet = false
    @State var groupContactForNew: Contact?
    @State var showRenameGroupSheet = false
    @State var renameGroupTarget: ContactStore.ContactGroup?
    @State var renameGroupName = ""
    @State var renameGroupEmoji = ""
    #if !os(watchOS)
    @State var shareContact: Contact?
    #endif
    /// Single timer for all contact rows — ticks every 30s to refresh relative "last seen" text.
    @State var refreshTick = Date()
    let refreshTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()
    @State var contactsExpanded = true
    @State var channelsExpanded = true
    @AppStorage("contactSortByLastSeen") var sortByLastSeen = true
    @AppStorage("channelsFirst") var channelsFirst = false
    #if os(iOS)
    @Environment(\.horizontalSizeClass) var horizontalSizeClass
    @State var navigateToMap = false
    @State var navigateToTools = false
    #endif
    /// Local selection state decoupled from ViewModel to avoid
    /// "Publishing changes from within view updates" when List writes to selection.
    @State var localSelection: SidebarSelection? = nil

    /// Public Channel virtual contact key (channel 0).
    let publicChannelKey = Data([0x00 as UInt8])

    #if os(macOS) || targetEnvironment(macCatalyst)
    var isUSBCLIConnected: Bool {
        connectionManager.isUSBCLIMode && remoteSessionManager.isUSBCLIConnected
    }
    #endif

    var body: some View {
        mainListWithGroupSheets
        .navigationTitle("PommeCore")
        // navigationDestination is only needed on iOS (not macOS/Catalyst) because on
        // macOS the NavigationSplitView's detail: block drives the detail column exclusively.
        // Leaving navigationDestination active on macOS creates a conflicting navigation
        // stack: once the map NavigationLink pushes via navigationDestination, setting
        // sidebarSelection = .settings has no visible effect (the pushed map view wins).
        #if os(iOS) && !targetEnvironment(macCatalyst)
        .navigationDestination(for: SidebarSelection.self) { selection in
            sidebarDestinationView(for: selection)
        }
        .navigationDestination(isPresented: $navigateToMap) {
            if #available(iOS 17.0, *) {
                MeshMapView()
            } else {
                Text("Map requires iOS 17+")
            }
        }
        .navigationDestination(isPresented: $navigateToTools) {
            ToolsView()
        }
        #endif
        // Sync local selection → ViewModel (deferred to avoid publishing during view update)
        .onChange(of: localSelection) { _, newValue in
            guard newValue != navigationStore.sidebarSelection else { return }
            DispatchQueue.main.async {
                navigationStore.sidebarSelection = newValue
            }
        }
        // Sync ViewModel → local selection (for programmatic navigation from other code)
        .onChange(of: navigationStore.sidebarSelection) { _, newValue in
            if localSelection != newValue {
                localSelection = newValue
            }
        }
        #if !os(watchOS)
        .onChange(of: navigationStore.sidebarSelection) { _, selection in
            // Mark contact as read when selected — deferred past view update
            if case .contact(let key) = selection,
               let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) {
                DispatchQueue.main.async {
                    Task { @MainActor in
                        messageStoreManager.markAsRead(contact)
                    }
                }
            }
        }
        #endif
        #if os(watchOS)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    showScanner = true
                } label: {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(MeshTheme.accent)
                }
                .accessibilityLabel("Scan for devices")
            }
        }
        #elseif os(macOS) || targetEnvironment(macCatalyst)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    connectionManager.refreshAll(contactStore: contactStore)
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundStyle(MeshTheme.accent)
                }
                .disabled(connectionManager.connectionState != .ready)
                .help("Refresh contacts and channels")
                .accessibilityLabel("Refresh")
                .accessibilityHint("Sync contacts and channels from device")
            }
        }
        #else
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    connectionManager.sendAdvertise(type: 1)
                    showAdvertSent?.wrappedValue = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        showAdvertSent?.wrappedValue = false
                    }
                } label: {
                    Image(systemName: showAdvertSent?.wrappedValue == true
                          ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
                        .foregroundStyle(showAdvertSent?.wrappedValue == true ? .green : MeshTheme.accent)
                }
                .accessibilityLabel("Advertise")
                .disabled(connectionManager.connectionState != .ready)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        connectionManager.refreshAll(contactStore: contactStore)
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(connectionManager.connectionState != .ready)
                    Divider()
                    Button {
                        showDiscover?.wrappedValue = true
                    } label: {
                        Label("Discover Nodes", systemImage: "binoculars.fill")
                    }
                    Button {
                        navigateToMap = true
                    } label: {
                        Label("Mesh Map", systemImage: "map.fill")
                    }
                    Button {
                        navigateToTools = true
                    } label: {
                        Label("Tools", systemImage: "wrench.and.screwdriver")
                    }
                    Divider()
                    Button(role: .destructive) {
                        showDistressBeacon = true
                    } label: {
                        Label("Emergency Beacon", systemImage: "exclamationmark.triangle.fill")
                    }
                    .disabled(connectionManager.connectionState != .ready)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(MeshTheme.accent)
                }
                .accessibilityLabel("More")
            }
        }
        #endif
        .overlay { deleteAlertsOverlay }
        .alert("Contact Shared", isPresented: $showShareConfirmation) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Contact shared on mesh.")
        }
        .alert("Path Reset", isPresented: $showResetConfirmation) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Outbound path has been reset. A new path will be discovered on next communication.")
        }
        .sheet(item: $detailContact) { contact in
            ContactDetailSheet(contact: contact)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showDistressBeacon) {
            DistressBeaconView()
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 400, minHeight: 500)
            #endif
        }
        .onChange(of: remoteSessionManager.detailContactForTrace?.id) {
            if let contact = remoteSessionManager.detailContactForTrace {
                detailContact = contact
                remoteSessionManager.detailContactForTrace = nil
            }
        }
        .sheet(item: $pathEditorContact) { contact in
            ManualPathEditor(contact: contact)
        }
        .sheet(item: $channelSheetAction) { action in
            NavigationStack {
                ChannelManagementView(action: action)
                        .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { channelSheetAction = nil }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        #if !os(watchOS)
        .sheet(item: $channelToShareSidebar) { channel in
            ShareChannelSheet(channel: channel)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showShareAllChannels) {
            ShareAllChannelsSheet(channels: channelStore.channels)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .alert("Rename Channel", isPresented: Binding<Bool>(
            get: { channelToRenameSidebar != nil },
            set: { if !$0 { channelToRenameSidebar = nil } }
        )) {
            TextField("Channel name", text: $channelRenameText)
            Button("Cancel", role: .cancel) { channelToRenameSidebar = nil }
            Button("Rename") {
                if let ch = channelToRenameSidebar, !channelRenameText.isEmpty {
                    channelStore.setChannel(index: ch.index, name: channelRenameText, secret: ch.secret)
                }
                channelToRenameSidebar = nil
            }
        } message: {
            Text("Enter a new name for this channel.")
        }
        .alert("Remove Channel?", isPresented: $showChannelRemoveConfirm) {
            Button("Cancel", role: .cancel) { channelToRemove = nil }
            Button("Remove", role: .destructive) {
                if let ch = channelToRemove {
                    channelStore.setChannel(index: ch.index, name: "", secret: nil)
                }
                channelToRemove = nil
            }
        } message: {
            if let ch = channelToRemove {
                Text("Remove \"\(ch.name)\" from your channels?")
            }
        }
        .sheet(isPresented: $showMyContactCode) {
            MyContactCodeSheet()
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(item: $shareContact) { contact in
            ShareContactSheet(contact: contact)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        #endif
        .sheet(isPresented: $showNicknameSheet) {
            NavigationStack {
                Form {
                    Section {
                        HStack {
                        #if os(watchOS)
                            TextField("Nickname", text: $nicknameText)
                                .foregroundStyle(MeshTheme.textPrimary)
                                .onChange(of: nicknameText) { _, newValue in
                                    if newValue.count > 32 { nicknameText = String(newValue.prefix(32)) }
                                }
                        #else
                            TextField("Nickname", text: $nicknameText)
                                .foregroundStyle(MeshTheme.textPrimary)
                                .textFieldStyle(MeshTextFieldStyle())
                                .onChange(of: nicknameText) { _, newValue in
                                    if newValue.count > 32 { nicknameText = String(newValue.prefix(32)) }
                                }
                        #endif
                            Text("\(nicknameText.count)/32")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } header: {
                        Text("Custom Nickname")
                            .foregroundStyle(MeshTheme.textSecondary)
                    } footer: {
                        Text("This nickname is stored locally on your device. It doesn't change anything on the radio or the mesh network.")
                            .font(.caption2)
                    }

                    if let contact = nicknameContact {
                        Section {
                            LabelValueRow(label: "Original Name", value: contact.name)
                            HStack {
                                Text("Public Key")
                                    .foregroundStyle(MeshTheme.accent)
                                Spacer()
                                Text(Data(contact.publicKey.prefix(8)).hexCompact)
                                    .foregroundStyle(MeshTheme.textPrimary)
                                    .font(.caption)
                            }
                        } header: {
                            Text("Contact Info")
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                }
                .navigationTitle("Set Nickname")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showNicknameSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            if let contact = nicknameContact {
                                contactStore.setNickname(nicknameText.trimmingCharacters(in: .whitespaces), for: contact)
                            }
                            showNicknameSheet = false
                        }
                    }
                }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 300)
            #endif
        }
        .onChange(of: messageStoreManager.lastExportedURL) { _, url in
            if isExporting, let url, !url.isEmpty {
                copyToClipboard(url)
                messageStoreManager.lastExportedURL = nil
                isExporting = false
                showExportCopied = true
            }
        }
        .alert("Link Copied", isPresented: $showExportCopied) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("The contact's meshcore:// link has been copied to the clipboard.")
        }
    }

    // MARK: - Settings Navigation

    #if !os(watchOS)
    /// Opens Settings in the most platform-appropriate way:
    /// macOS/iPad (any size or orientation): selects Settings in the NavigationSplitView detail column.
    /// iPhone (compact): opens Settings as a sheet.
    ///
    /// Note: iPad mini landscape reports .compact horizontalSizeClass but is still a split-view
    /// layout. We detect iPad via UIDevice idiom to avoid opening a sheet on any iPad.
    func openSettings() {
        #if os(macOS) || targetEnvironment(macCatalyst)
        navigationStore.sidebarSelection = .settings
        #elseif os(iOS)
        // All iPad models should use sidebar, regardless of size class.
        // iPad mini reports .pad idiom, but horizontalSizeClass can be .compact
        // in portrait. Use idiom-based detection instead of size class.
        let isPad = UIDevice.current.userInterfaceIdiom == .pad

        if isPad {
            // All iPads (including iPad mini) use sidebar
            navigationStore.sidebarSelection = .settings
        } else {
            // iPhone: use sheet in portrait/compact, sidebar in landscape/regular
            if horizontalSizeClass == .regular {
                navigationStore.sidebarSelection = .settings
            } else {
                showSettings?.wrappedValue = true
            }
        }
        #endif
    }
    #endif

}

// MARK: - Main List (extracted to break type-checker chain)
private extension ContactListView {
    var mainListWithGroupSheets: some View {
        mainList
            .sheet(isPresented: $showNewGroupSheet) {
                GroupEditSheet(title: "New Group", initialName: "", initialEmoji: "") { name, emoji in
                    showNewGroupSheet = false
                    let contact = groupContactForNew
                    groupContactForNew = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        contactStore.addContactGroup(name: name, emoji: emoji)
                        if let contact,
                           let group = contactStore.contactGroups.last {
                            contactStore.addContactToGroup(contact, group: group)
                        }
                    }
                }
                .meshTheme()
            }
            .sheet(isPresented: $showRenameGroupSheet) {
                GroupEditSheet(title: "Rename Group", initialName: renameGroupName, initialEmoji: renameGroupEmoji) { name, emoji in
                    showRenameGroupSheet = false
                    let target = renameGroupTarget
                    renameGroupTarget = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        if let target {
                            contactStore.renameContactGroup(target, name: name, emoji: emoji)
                        }
                    }
                }
                .meshTheme()
            }
    }

    var mainList: some View {
        List(selection: $localSelection) {
            connectionSection
            if channelsFirst {
                channelsSection
            }
            if !contactStore.pendingNewContacts.isEmpty {
                pendingContactsSection
            }
            if !contactStore.contactGroups.isEmpty {
                groupsSection
            }
            contactsSection
            if !channelsFirst {
                channelsSection
            }
            #if os(macOS) || targetEnvironment(macCatalyst)
            if isUSBCLIConnected {
                Section {
                    NavigationLink(value: SidebarSelection.usbDevice) {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(MeshTheme.connected.opacity(0.15))
                                    .frame(width: 40, height: 40)
                                Image(systemName: "cable.connector")
                                    .foregroundStyle(MeshTheme.connected)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(remoteSessionManager.usbDeviceContact?.name ?? "USB Device")
                                    .font(.body)
                                    .foregroundStyle(MeshTheme.textPrimary)
                                Text("USB Serial \u{2022} Admin")
                                    .font(.caption)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .listRowBackground(MeshTheme.surface)

                    NavigationLink(value: SidebarSelection.usbTerminal) {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(MeshTheme.accent.opacity(0.15))
                                    .frame(width: 40, height: 40)
                                Image(systemName: "terminal")
                                    .foregroundStyle(MeshTheme.accent)
                            }
                            Text("USB Terminal")
                                .font(.body)
                                .foregroundStyle(MeshTheme.accent)
                        }
                        .contentShape(Rectangle())
                    }
                    .listRowBackground(MeshTheme.surface)

                    Button(role: .destructive) {
                        remoteSessionManager.reset()
                        connectionManager.disconnectUSB()
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(MeshTheme.disconnected.opacity(0.15))
                                    .frame(width: 40, height: 40)
                                Image(systemName: "cable.connector.slash")
                                    .foregroundStyle(MeshTheme.disconnected)
                            }
                            Text("Disconnect USB")
                                .font(.body)
                                .foregroundStyle(MeshTheme.disconnected)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(MeshTheme.surface)
                } header: {
                    Text("USB Device")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            } else if connectionManager.usbManager.isConnected && connectionManager.usbManager.detectedMode == .cli {
                Section {
                    HStack(spacing: 12) {
                        ProgressView()
                            .tint(MeshTheme.accent)
                        Text("Connecting to USB device...")
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            }
            #endif
        }
        #if os(iOS)
        .listStyle(.sidebar)
        #else
        .meshListStyle()
        #endif
        .onReceive(refreshTimer) { refreshTick = $0 }
        .refreshable {
            guard connectionManager.connectionState == .ready else { return }
            connectionManager.refreshAll(contactStore: contactStore)
        }
    }
}

// MARK: - Delete Alerts (extracted to break type-checker chain)
private extension ContactListView {
    @ViewBuilder
    var deleteAlertsOverlay: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .alert("Remove Contact?", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) { contactToDelete = nil }
                Button("Remove", role: .destructive) {
                    if let contact = contactToDelete {
                        contactStore.removeContact(contact)
                    }
                    contactToDelete = nil
                }
            } message: {
                if let contact = contactToDelete {
                    Text("Are you sure you want to remove \(contactStore.displayName(for: contact))? This will delete all messages with this contact.")
                }
            }
            .confirmationDialog("Delete \(selectedContacts.count) Contact\(selectedContacts.count == 1 ? "" : "s")?", isPresented: $showBulkDeleteConfirm) {
                Button("Delete", role: .destructive) {
                    for key in selectedContacts {
                        if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) {
                            contactStore.removeContact(contact)
                        }
                    }
                    selectedContacts.removeAll()
                    isSelecting = false
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will remove the selected contacts from the device. This cannot be undone.")
            }
    }
}

// MARK: - Group Edit Sheet

struct GroupEditSheet: View {
    let title: LocalizedStringKey
    let initialName: String
    let initialEmoji: String
    let onSave: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var emoji = ""

    private let emojiOptions = ["📡", "🏠", "🏔️", "🌲", "🏙️", "⛺", "🚗", "🛠️", "🔒", "⭐", "🔥", "💬", "📍", "🌊", "🎯"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Group name", text: $name)
                        .listRowBackground(MeshTheme.surface)
                } header: {
                    Text("Name")
                }

                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 12) {
                        ForEach(emojiOptions, id: \.self) { option in
                            Button {
                                emoji = emoji == option ? "" : option
                            } label: {
                                Text(option)
                                    .font(.title2)
                                    .frame(width: 36, height: 36)
                                    .background(emoji == option ? MeshTheme.accent.opacity(0.3) : Color.clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .listRowBackground(MeshTheme.surface)

                    HStack {
                        Text("Custom:")
                            .foregroundStyle(MeshTheme.textSecondary)
                        TextField("Emoji", text: $emoji)
                            .frame(width: 50)
                    }
                    .listRowBackground(MeshTheme.surface)
                } header: {
                    Text("Icon")
                }

                if !emoji.isEmpty {
                    Section {
                        HStack {
                            Text("\(emoji) \(name.isEmpty ? "Group Name" : name)")
                                .foregroundStyle(MeshTheme.textPrimary)
                        }
                        .listRowBackground(MeshTheme.surface)
                    } header: {
                        Text("Preview")
                    }
                }
            }
            .formStyle(.grouped)
            .meshTheme()
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        onSave(trimmed, emoji)
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        #if os(macOS) || targetEnvironment(macCatalyst)
        .frame(minWidth: 350, idealWidth: 400, minHeight: 350, idealHeight: 450)
        #endif
        .onAppear {
            name = initialName
            emoji = initialEmoji
        }
    }
}
