//
//  RemoteManagementView.swift
//  PommeCore
//
//  Remote admin settings for repeaters, rooms, and sensors via CLI over LoRa or USB.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import CoreLocation
import MeshCoreKit

/// Management view for repeater and room server contacts.
struct RemoteManagementView: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @ObservedObject var session: RemoteDeviceSession
    // Session persists until firmware timeout or reboot — no manual logout
    @State private var isEditingName = false
    @State private var editedName = ""
    @State private var showRebootAfterRename = false
    @State private var showPubkeyCopied = false
    @State private var showNameWizard = false

    @State private var showRemoteFirmwareUpdate = false

    // Collapsible section expand state — collapsed by default, fetch on expand
    @State private var expandedAdvertisingSection = false
    @State private var expandedTimingSection = false
    @State private var expandedRoutingSection = false
    @State private var expandedGPSSection = false
    @State private var expandedRoomSection = false
    @State private var expandedSecuritySection = false
    @State private var expandedMaintenanceSection = false

    /// Accent color — teal for room servers, amber for repeaters.
    private var remoteAccent: Color {
        contact.type == .room ? MeshTheme.remoteRoom : MeshTheme.remoteRepeater
    }

    var body: some View {
        List {
            if isLoggedIn {
                remoteBanner
                if !isUSBDevice {
                    disconnectSection
                }
                // Phase 1 loading indicator (only shows during initial fetch)
                if session.fetchingSection != nil && !session.fetchedSections.contains("radio") {
                    Section {
                        HStack(spacing: 12) {
                            ProgressView()
                                .tint(remoteAccent)
                            Text("Loading \(session.fetchingSection ?? "settings")...")
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        .listRowBackground(MeshTheme.surface)
                    }
                }
                // Permission-level banner for non-admin users
                if !isAdmin && isLoggedIn {
                    HStack(spacing: 8) {
                        Image(systemName: permission == .guest ? "person" : "eye")
                            .foregroundStyle(permissionBadgeColor)
                        (permission == .guest ? Text("Logged in as Guest \u{2014} no access to settings") : Text("Logged in as \(permission.displayName) \u{2014} read-only access"))
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .listRowBackground(MeshTheme.surface)
                }

                // === Phase 1: Always visible, auto-fetched on login ===
                infoSection
                if canRead {
                    radioSection
                }

                // === Collapsible sections: collapsed by default, fetch on expand ===
                if canRead {
                    lazySection("Advertising", expanded: $expandedAdvertisingSection, sectionKey: "advertising",
                                info: "Standard adverts are local (0-hop, 60–240 min). Flood adverts are relayed by all repeaters (min 3 hours). Minimum intervals enforced by firmware.") {
                        advertisingSection
                    }

                    lazySection("Timing & Performance", expanded: $expandedTimingSection, sectionKey: "timing",
                                info: "Advanced \u{2014} adjust timing parameters for mesh performance. Default values work well for most setups. Flood Max Hops supports 0\u{2013}64 (default 64). Flood Max (Unscoped) caps hops for floods with no region assigned (0\u{2013}64, default 64).") {
                        timingSection
                    }

                    if contact.type == .repeater {
                        lazySection("Routing", expanded: $expandedRoutingSection, sectionKey: "routing",
                                    info: "Loop detection rejects flood packets that appear to be in a loop (v1.14+). Path hash size controls ID/hash encoding in path headers \u{2014} higher values reduce collision risk but require v1.14+ firmware across the network.") {
                            routingSection
                        }
                    }

                    lazySection("GPS", expanded: $expandedGPSSection, sectionKey: "gps",
                                info: "Controls whether this device includes its location in mesh advertisements. \u{2018}GPS\u{2019} uses the hardware GPS module. \u{2018}Manual\u{2019} uses the latitude and longitude values configured in the advertising section above.") {
                        gpsSection
                    }

                    if contact.type == .room {
                        lazySection("Room Server", expanded: $expandedRoomSection, sectionKey: "security",
                                    info: "Allow read-only access for guests without a password. Set the guest password required to connect. Manage per-client permissions.") {
                            roomSection
                        }
                    }
                    if contact.type == .sensor && isAdmin { sensorSection }
                }
                if isAdmin {
                    lazySection("Security", expanded: $expandedSecuritySection, sectionKey: "security",
                                info: "ACL permissions: 0=Guest, 1=Read-only, 2=Read-write, 3=Admin") {
                        securitySection
                    }

                    lazySection("Maintenance", expanded: $expandedMaintenanceSection, sectionKey: "maintenance",
                                info: "Reboot restarts the device (~30 seconds). Clear Stats resets packet counters and airtime. Log dump requires USB serial connection.") {
                        maintenanceSection
                    }

                    #if os(macOS) || targetEnvironment(macCatalyst)
                    if isUSBDevice { serialOnlySection }
                    #endif
                    cliTerminalSection
                } else if canRead {
                    lazySection("Maintenance", expanded: $expandedMaintenanceSection, sectionKey: "maintenance",
                                info: "Reboot restarts the device (~30 seconds). Clear Stats resets packet counters and airtime. Log dump requires USB serial connection.") {
                        maintenanceSection
                    }
                }
            } else {
                loginSection
            }
        }
        .meshListStyle()
        .navigationTitle("Remote Management")
        // Phase 1 fetch is handled by handleLoginSuccess() in RemoteSessionManager
        // No backup trigger needed here — the login code handles it sequentially
        .onDisappear {
            // Cancel any in-progress settings fetch immediately
            remoteSessionManager.cancelFetch()
            // Session stays alive — firmware has no logout command and handles
            // session timeout automatically. Clearing local state here causes
            // a mismatch that makes buttons unresponsive.
        }
        #if !os(macOS) && !targetEnvironment(macCatalyst)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    let sections = visibleSections
                    session.fetchedSections.removeAll()
                    remoteSessionManager.requestStatus(for: contact)
                    Task {
                        for section in sections {
                            await remoteSessionManager.fetchSectionAsync(section, for: contact, skipIfFetched: false)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundStyle(MeshTheme.accent)
                }
                .accessibilityLabel("Reload settings")
                .disabled(session.fetchingSection != nil)
            }
        }
        #endif
        .sheet(isPresented: $showRemoteFirmwareUpdate) {
            FirmwareUpdateView(
                latestVersion: "",
                firmwareType: remoteFirmwareType,
                manufacturerHint: ""
            )
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 480, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showNameWizard) {
            NavigationStack {
                NodeSetupWizardView(remoteContext: RemoteWizardContext(
                    contact: contact,
                    publicKeyHex: session.settings["public.key"] ?? "",
                    sendCLI: { command in sendCLI(command) },
                    currentName: session.settings["name"],
                    onNameApplied: { newName in session.settings["name"] = newName },
                    currentFrequencyKHz: {
                        // Parse frequency from "radio" setting (e.g. "906.875,62.5,7,5")
                        guard let radio = session.settings["radio"],
                              let freqStr = radio.split(separator: ",").first,
                              let freqMHz = Double(freqStr) else { return nil }
                        return freqMHz * 1000  // MHz → kHz
                    }()
                ))
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { showNameWizard = false }
                    }
                }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 500)
            #endif
        }
    }

    @ViewBuilder
    private var remoteBanner: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: contact.type == .room ? "server.rack" : "antenna.radiowaves.left.and.right")
                        .foregroundStyle(remoteAccent)
                    Text(contactStore.displayName(for: contact))
                        .font(.headline)
                        .foregroundStyle(remoteAccent)
                    Spacer()
                    Text(permission.displayName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(permissionBadgeColor)
                        .clipShape(Capsule())
                }
                Text(isUSBDevice
                    ? "Managing via USB Serial \u{2014} direct connection, no latency."
                    : "Managing \(contactStore.displayName(for: contact)) via LoRa \u{2014} commands travel over the mesh and may take a few seconds.")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            .padding(.vertical, 4)
            .listRowBackground(remoteAccent.opacity(0.1))
        }
    }

    @ViewBuilder
    private var disconnectSection: some View {
        Section {
            // No manual logout — session ends on firmware timeout, reboot, or BLE disconnect
        }
    }

    private var isLoggedIn: Bool {
        if case .loggedIn = session.loginState { return true }
        return false
    }

    private var permission: RemotePermission {
        if case .loggedIn(let p) = session.loginState { return p }
        return .guest
    }

    private var isAdmin: Bool { permission.isAdmin }
    private var canEdit: Bool { permission.canEdit }
    private var canRead: Bool { permission.canRead }

    /// Returns sections currently visible (always-on + expanded), in screen order.
    /// Used by the toolbar refresh to re-fetch exactly what the user sees.
    private var visibleSections: [String] {
        var sections = ["info"]
        if canRead { sections.append("radio") }
        if expandedAdvertisingSection && canRead { sections.append("advertising") }
        if expandedTimingSection && canRead { sections.append("timing") }
        if expandedRoutingSection && canRead && contact.type == .repeater { sections.append("routing") }
        if expandedGPSSection && canRead { sections.append("gps") }
        if expandedRoomSection && canRead && contact.type == .room && !sections.contains("security") { sections.append("security") }
        if expandedSecuritySection && isAdmin && !sections.contains("security") { sections.append("security") }
        if expandedMaintenanceSection { sections.append("maintenance") }
        return sections
    }

    private var isUSBDevice: Bool {
        #if os(macOS) || targetEnvironment(macCatalyst)
        contact.publicKey == remoteSessionManager.usbDeviceContact?.publicKey
        #else
        false
        #endif
    }

    /// Header row for a Phase 2 collapsible section.
    @ViewBuilder
    private func lazySection<Content: View>(
        _ title: LocalizedStringKey,
        expanded: Binding<Bool>,
        sectionKey: String,
        info: LocalizedStringKey? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Section {
            if expanded.wrappedValue {
                content()
            }
        } header: {
            HStack(spacing: 0) {
                Button {
                    expanded.wrappedValue.toggle()
                    if expanded.wrappedValue {
                        remoteSessionManager.fetchSection(sectionKey, for: contact)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: expanded.wrappedValue ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .frame(width: 16)
                        Text(title)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(MeshTheme.accent)
                        if session.fetchedSections.contains(sectionKey) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.connected)
                        } else if session.hasCachedSettings(for: sectionKey) {
                            Image(systemName: "arrow.triangle.2.circlepath.circle")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                        }
                        Spacer()
                        if session.fetchingSection == sectionKey {
                            ProgressView()
                                .scaleEffect(0.7)
                        }
                    }
                    .contentShape(Rectangle())
                }
                #if os(macOS) || targetEnvironment(macCatalyst)
                .buttonStyle(.borderless)
                #else
                .buttonStyle(.plain)
                #endif
                if let info {
                    InfoButton(text: info)
                        .padding(.leading, 6)
                }
            }
            .textCase(nil)
        }
    }

    private var permissionBadgeColor: Color {
        switch permission {
        case .guest: return MeshTheme.textSecondary
        case .readOnly: return .yellow
        case .readWrite: return .blue
        case .admin: return MeshTheme.interactiveGreen
        }
    }

    private func sendCLI(_ command: String) {
        #if os(macOS) || targetEnvironment(macCatalyst)
        // For USB CLI devices, log the command being sent for debugging
        if isUSBDevice {
            DebugLogger.shared.log("REMOTE USB: sendCLI(\(command)) via remoteSessionManager", level: .tx)
        }
        #endif
        remoteSessionManager.sendCLICommand(command, to: contact)
    }

    private func getValue(_ key: String) -> String {
        session.settings[key] ?? "\u{2014}"
    }

    private func commitNameEdit() {
        let trimmed = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            isEditingName = false
            editedName = ""
            return
        }
        sendCLI("set name \(trimmed)")
        session.settings["name"] = trimmed
        isEditingName = false
        editedName = ""
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            showRebootAfterRename = true
        }
    }
}

// MARK: - Login Section

private extension RemoteManagementView {
    var loginSection: some View {
        LoginSection(contact: contact, session: session)
    }
}

struct LoginSection: View {
    let contact: Contact
    @ObservedObject var session: RemoteDeviceSession
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @State private var password = ""

    var body: some View {
        Section {
            HStack {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(statusColor)
                    .shadow(color: statusColor.opacity(0.5), radius: 3)
                Text("Login Status")
                    .foregroundStyle(MeshTheme.accent)
                Spacer()
                Text(statusLabel)
                    .foregroundStyle(statusColor)
            }
            .listRowBackground(MeshTheme.surface)

            if !isLoggedIn {
                HStack {
                    Image(systemName: "lock")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    #if os(watchOS)
                    SecureField("Password (leave blank if none)", text: $password)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .onSubmit {
                            remoteSessionManager.loginToRemoteDevice(contact, password: password)
                        }
                    #else
                    SecureField("Password (leave blank if none)", text: $password)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .textFieldStyle(MeshTextFieldStyle())
                        .submitLabel(.go)
                        .onSubmit {
                            guard !isLoggingIn else { return }
                            remoteSessionManager.loginToRemoteDevice(contact, password: password)
                        }
                        .onChange(of: password) { _, new in
                            if new.count > 15 { password = String(new.prefix(15)) }
                        }
                    #endif
                    InfoButton(text: "Passwords are case-sensitive, max 15 characters.")
                }
                .listRowBackground(MeshTheme.surface)

                if contact.type == .sensor {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        Text("Sensors require admin access. Guest login is not supported.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    .listRowBackground(MeshTheme.surface)
                }

                if isLoggingIn {
                    HStack {
                        ProgressView()
                            .scaleEffect(0.8)
                            .tint(MeshTheme.accent)
                        Text("Logging in...")
                            .foregroundStyle(MeshTheme.textSecondary)
                        Spacer()
                        Button("Cancel") {
                            remoteSessionManager.cancelLogin(for: contact)
                        }
                        .foregroundStyle(.red)
                    }
                    .listRowBackground(MeshTheme.surface)
                } else {
                    Button {
                        remoteSessionManager.loginToRemoteDevice(contact, password: password)
                    } label: {
                        HStack {
                            Image(systemName: "arrow.right.circle")
                                .foregroundStyle(MeshTheme.accent)
                                .frame(width: 24)
                            Text("Login")
                                .foregroundStyle(MeshTheme.accent)
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(MeshTheme.surface)
                }

                if case .loginFailed(let msg) = session.loginState {
                    HStack(alignment: .top) {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                        Text(msg)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            }
        } header: {
            Text("Connection")
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }

    private var isLoggedIn: Bool {
        if case .loggedIn = session.loginState { return true }
        return false
    }

    private var isLoggingIn: Bool {
        if case .loggingIn = session.loginState { return true }
        return false
    }

    private var statusColor: Color {
        switch session.loginState {
        case .loggedIn(let permission):
            switch permission {
            case .guest: MeshTheme.textSecondary
            case .readOnly: .yellow
            case .readWrite: .blue
            case .admin: MeshTheme.connected
            }
        case .loggingIn: MeshTheme.connecting
        case .loginFailed: MeshTheme.disconnected
        case .notLoggedIn: MeshTheme.textSecondary
        }
    }

    private var statusLabel: String {
        switch session.loginState {
        case .loggedIn(let permission): permission.displayName
        case .loggingIn: String(localized: "Logging in...")
        case .loginFailed: String(localized: "Failed")
        case .notLoggedIn: String(localized: "Not logged in")
        }
    }
}

// MARK: - Info Section

private extension RemoteManagementView {
    var infoSection: some View {
        Section {
            // Compact device info card
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    if isEditingName {
                        TextField("Device name", text: $editedName, onCommit: {
                            commitNameEdit()
                        })
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .textFieldStyle(.plain)
                        Button {
                            commitNameEdit()
                        } label: {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(MeshTheme.accent)
                        }
                        .buttonStyle(.plain)
                        Button {
                            isEditingName = false
                            editedName = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        .buttonStyle(.plain)
                    } else {
                        let currentName = getValue("name").isEmpty || getValue("name") == "\u{2014}" ? contact.name : getValue("name")
                        Text(currentName)
                            .font(.headline)
                            .foregroundStyle(MeshTheme.textPrimary)
                        if canEdit {
                            Image(systemName: "pencil")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                    Spacer()
                    Text(session.settings["role"] ?? (contact.type == .repeater ? "Repeater" : contact.type == .room ? "Room" : "Sensor"))
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                    if !isAdmin {
                        Text("\u{2022} \(permission.displayName)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    guard canEdit, !isEditingName else { return }
                    let currentName = getValue("name").isEmpty || getValue("name") == "\u{2014}" ? contact.name : getValue("name")
                    editedName = currentName
                    isEditingName = true
                }
                .alert("Reboot Required", isPresented: $showRebootAfterRename) {
                    Button("Reboot Now", role: .destructive) {
                        sendCLI("reboot")
                    }
                    Button("Later", role: .cancel) {}
                } message: {
                    Text("The device name has been updated. A reboot is required for the change to take effect.")
                }
                HStack(spacing: 12) {
                    if !getValue("ver").isEmpty {
                        Label(getValue("ver"), systemImage: "cpu")
                    }
                    contact.outPathLen == 0
                        ? Label("direct", systemImage: "arrow.triangle.branch")
                        : Label("\(Int(contact.outPathLen & 0x3F)) hops", systemImage: "arrow.triangle.branch")
                }
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)

                // Battery and uptime from status response (auto-requested on login)
                HStack(spacing: 12) {
                    if let status = remoteSessionManager.statusByContact[contact.publicKeyPrefix] {
                        if status.batteryMV > 0 {
                            Label(String(format: "%.2fV", Double(status.batteryMV) / 1000.0),
                                  systemImage: "battery.50")
                            .foregroundStyle(MeshTheme.accent)
                        }
                        let u = status.uptime
                        let d = u / 86400, h = (u % 86400) / 3600, m = (u % 3600) / 60
                        let uptimeStr = d > 0 ? "\(d)d \(h)h" : h > 0 ? "\(h)h \(m)m" : "\(m)m"
                        Label(uptimeStr, systemImage: "clock")
                    }
                    Spacer()
                }
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .id(remoteSessionManager.statusUpdateCounter)

                if let radio = session.settings["radio"], !radio.isEmpty {
                    let tx = session.settings["tx"] ?? ""
                    Text("\(radio)\(!tx.isEmpty ? " \u{2022} \(tx)dBm" : "")")
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                }

                if let pubkey = session.settings["public.key"], !pubkey.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: showPubkeyCopied ? "checkmark" : "key")
                            .font(.caption2)
                            .foregroundStyle(showPubkeyCopied ? MeshTheme.interactiveGreen : MeshTheme.textSecondary)
                        Text(showPubkeyCopied ? "Copied!" : String(pubkey.prefix(16)) + "...")
                            .font(.caption2)
                            .foregroundStyle(showPubkeyCopied ? MeshTheme.interactiveGreen : MeshTheme.textSecondary)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "doc.on.doc")
                            .font(.caption2)
                            .foregroundStyle(showPubkeyCopied ? MeshTheme.interactiveGreen : MeshTheme.accent)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        copyToClipboard(pubkey)
                        showFeedback($showPubkeyCopied)
                    }
                }
            }
            .listRowBackground(MeshTheme.surface)

            if canEdit {
                HStack {
                    Image(systemName: "wand.and.stars")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Name Wizard")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .contentShape(Rectangle())
                .onTapGesture { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showNameWizard = true } }
                .listRowBackground(MeshTheme.surface)
            }

            RemoteClockRow(session: session, sendCLI: sendCLI)

            if DeviceCapabilities.forContactType(contact.type).hasNeighbors {
                CLICommandButton(icon: "person.3", label: "Neighbors") {
                    sendCLI("neighbors")
                }

                if let neighborsText = session.settings["neighbors"], !neighborsText.isEmpty {
                    Text(neighborsText)
                        .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(MeshTheme.textPrimary)
                    .listRowBackground(MeshTheme.surface)
                }
            }

            CLICommandButton(icon: "arrow.clockwise", label: "Refresh Info") {
                sendCLI("ver")
                sendCLI("clock")
                sendCLI("get bootloader.ver")
            }
        } header: {
            SectionInfoHeader(
                title: "Device Info",
                info: "Basic device information. Tap ↺ to re-read version, battery, and clock from the device.",
                action: {
                    remoteSessionManager.requestStatus(for: contact)
                    session.fetchedSections.remove("info")
                    Task {
                        await remoteSessionManager.fetchSectionAsync("info", for: contact, skipIfFetched: false)
                    }
                }
            )
        }
    }
}

// MARK: - Config Section Wrappers

private extension RemoteManagementView {
    var radioSection: some View {
        RemoteRadioSection(contact: contact, session: session, sendCLI: sendCLI, canEdit: canEdit)
    }

    var timingSection: some View {
        RemoteTimingSection(contact: contact, session: session, sendCLI: sendCLI, canEdit: canEdit)
    }

    var routingSection: some View {
        RemoteRoutingSection(contact: contact, session: session, sendCLI: sendCLI, canEdit: canEdit)
    }

    var advertisingSection: some View {
        RemoteAdvertSection(contact: contact, session: session, sendCLI: sendCLI, canEdit: canEdit)
    }
}

// MARK: - Device Section Wrappers

private extension RemoteManagementView {
    var securitySection: some View {
        RemoteSecuritySection(contact: contact, session: session, sendCLI: sendCLI, permission: permission)
    }

    var gpsSection: some View {
        RemoteGPSSection(session: session, sendCLI: sendCLI, canEdit: canEdit)
    }
}

// MARK: - Management Section Wrappers

private extension RemoteManagementView {
    var roomSection: some View {
        RemoteRoomSection(session: session, sendCLI: sendCLI, canEdit: canEdit)
    }

    var sensorSection: some View {
        RemoteSensorSection(session: session, sendCLI: sendCLI)
    }

    var remoteFirmwareType: FirmwareOTAService.FirmwareType {
        switch contact.type {
        case .repeater: return .repeater
        case .room: return .room
        default: return .companion
        }
    }

    var maintenanceSection: some View {
        RemoteMaintenanceSection(
            session: session,
            sendCLI: sendCLI,
            permission: permission,
            onFirmwareUpdate: permission.isAdmin ? { showRemoteFirmwareUpdate = true } : nil
        )
    }

    var cliTerminalSection: some View {
        CLITerminalSection(contact: contact, session: session)
    }

    #if os(macOS) || targetEnvironment(macCatalyst)
    var serialOnlySection: some View {
        SerialOnlySection(sendCLI: sendCLI)
    }
    #endif
}
