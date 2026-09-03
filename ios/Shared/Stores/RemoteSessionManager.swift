//
//  RemoteSessionManager.swift
//  PommeCore
//
//  Remote CLI sessions, USB CLI management, network tools, and telemetry.
//
//  Created by Michael P. Bedworth on 3/20/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import Combine
import os.log
import MeshCoreKit

/// Observable store for remote management sessions, network tools (discover, trace, status, telemetry),
/// and USB CLI device management. Extracted from PommeCoreViewModel.
@MainActor @Observable
final class RemoteSessionManager {
    private static let logger = Logger(subsystem: "com.pommecore", category: "RemoteSession")

    // MARK: - Public State: Remote Sessions

    /// Active remote management sessions keyed by contact public key prefix.
    private(set) var remoteSessions: [Data: RemoteDeviceSession] = [:]

    /// Whether any remote management session is currently logged in.
    var hasActiveManagementSession: Bool {
        remoteSessions.values.contains { session in
            if case .loggedIn = session.loginState { return true }
            return false
        }
    }

    /// The first active admin session (BLE or WiFi remote admin). Used to route CLI commands.
    var activeAdminSession: RemoteDeviceSession? {
        remoteSessions.values.first { session in
            if case .loggedIn = session.loginState { return true }
            return false
        }
    }

    // MARK: - Public State: USB CLI (macOS)

    #if os(macOS) || targetEnvironment(macCatalyst)
    var usbCLIOutput: [USBTerminalLine] = []
    /// Session for managing a USB CLI-connected device (repeater/room/sensor).
    var usbDeviceSession: RemoteDeviceSession?
    /// Synthetic contact for the USB-connected CLI device.
    var usbDeviceContact: Contact?
    /// Keepalive timer — sends `clock` every 30s to prevent firmware USB CLI idle timeout.
    private var usbKeepaliveTask: Task<Void, Never>?
    #endif

    // MARK: - Public State: Network Tools

    var discoveredNodes: [DiscoveredNode] = []
    var isDiscovering = false
    var discoverFallbackMessage: String?
    var lastTraceResult: TraceResult?

    // MARK: - Ping State

    struct PingResult: Identifiable {
        let id = UUID()
        let seq: Int
        let latencyMs: Double?  // nil = timeout
        let hops: Int
        let timestamp: Date
    }

    var pingResults: [PingResult] = []
    var isPinging = false
    var pingCount: Int = 0
    var pingTotal: Int = 0
    private var pingSendTime: Date?
    private var pingContact: Contact?
    private var pingTask: Task<Void, Never>?

    var pingStats: (sent: Int, received: Int, avgMs: Double, minMs: Double, maxMs: Double)? {
        guard !pingResults.isEmpty else { return nil }
        let received = pingResults.filter { $0.latencyMs != nil }
        let latencies = received.compactMap(\.latencyMs)
        guard !latencies.isEmpty else { return (pingResults.count, 0, 0, 0, 0) }
        let avg = latencies.reduce(0, +) / Double(latencies.count)
        return (pingResults.count, received.count, avg, latencies.min() ?? 0, latencies.max() ?? 0)
    }

    var telemetryByContact: [Data: [TelemetryReading]] = [:]
    var statusByContact: [Data: RemoteStatusInfo] = [:]
    /// Increments when status/telemetry updates arrive — forces SwiftUI to re-read statusByContact.
    var statusUpdateCounter = 0
    var advertPathByContact: [Data: AdvertPathInfo] = [:]
    var pathDiscoveryByContact: [Data: PathDiscoveryResult] = [:]
    var allowedRepeatFreqRanges: [FrequencyRange] = []
    private var pendingBinaryRequests: [UInt32: (Data) -> Void] = [:]
    private(set) var pendingTraceTag: UInt32?
    var detailContactForTrace: Contact?
    private(set) var pendingAdvertPathKey: Data?
    private(set) var pendingStatusKey: Data?
    private(set) var pendingTelemetryKey: Data?
    private(set) var pendingPathDiscoveryKey: Data?

    // MARK: - Dependencies (set by coordinator)

    /// Closure to send a command frame to the device.
    var sendCommand: ((Data, String) -> Void)?

    /// Closure to get contacts for key prefix lookup.
    var contactsProvider: (() -> [Contact])?

    /// Closure to get device config.
    var deviceConfigProvider: (() -> DeviceConfig)?

    /// Closure to sync next message (for CLI responses arriving via message queue).
    var syncNextMessage: (() -> Void)?

    /// Closure to show an error message.
    var showError: ((String) -> Void)?

    /// Closure to get display name for a contact.
    var displayNameProvider: ((Contact) -> String)?

    /// Closure to post an event notification.
    var postEventNotification: ((String, String, String) -> Void)?

    // MARK: - Private State

    private var sessionCancellables: [Data: AnyCancellable] = [:]
    private var discoverUnsupported = false
    private var pendingTraceContact: Contact?
    private var loginTimeoutTask: Task<Void, Never>?
    /// Password stored as mutable bytes for explicit zeroing after use.
    private var pendingLoginPasswordBytes: ContiguousArray<UInt8>?
    private var pendingLoginRememberPassword = false

    /// Zero and clear the pending login password.
    private func clearPendingPassword() {
        if var bytes = pendingLoginPasswordBytes {
            for i in bytes.indices { bytes[i] = 0 }
            pendingLoginPasswordBytes = nil
        }
    }
    private var traceTimeoutTask: Task<Void, Never>?
    private var statusTimeoutTask: Task<Void, Never>?
    private var telemetryTimeoutTask: Task<Void, Never>?
    private var pathTimeoutTask: Task<Void, Never>?
    private var discoverTimeoutTask: Task<Void, Never>?

    /// objectWillChange bridge for ObservableObject views (during migration).
    var onStateChanged: (() -> Void)?

    // MARK: - Init

    init() {}

    // MARK: - Reset

    func reset() {
        fetchTask?.cancel()
        fetchTask = nil
        loginTimeoutTask?.cancel()
        loginTimeoutTask = nil
        traceTimeoutTask?.cancel()
        statusTimeoutTask?.cancel()
        telemetryTimeoutTask?.cancel()
        pathTimeoutTask?.cancel()
        discoverTimeoutTask?.cancel()
        discoveredNodes = []
        isDiscovering = false
        discoverUnsupported = false
        discoverFallbackMessage = nil
        lastTraceResult = nil
        pendingTraceTag = nil
        pendingTraceContact = nil
        pendingStatusKey = nil
        pendingAdvertPathKey = nil
        pendingTelemetryKey = nil
        allowedRepeatFreqRanges = []
        #if os(macOS) || targetEnvironment(macCatalyst)
        usbKeepaliveTask?.cancel()
        usbKeepaliveTask = nil
        usbDeviceSession = nil
        usbDeviceContact = nil
        usbCLIOutput.removeAll()
        usbSessionCancellable.removeAll()
        #endif
    }

    /// Reset login sessions on disconnect.
    func resetLoginSessions() {
        for (_, session) in remoteSessions {
            switch session.loginState {
            case .loggingIn:
                session.loginState = .loginFailed(message: "Device disconnected during login.")
            case .loggedIn:
                session.loginState = .notLoggedIn
            default:
                break
            }
        }
        loginTimeoutTask?.cancel()
        loginTimeoutTask = nil
        clearPendingPassword()
        pendingLoginRememberPassword = false
    }

    // MARK: - Session Management

    /// Get or create a remote management session for a contact.
    func remoteSession(for contact: Contact) -> RemoteDeviceSession {
        #if os(macOS) || targetEnvironment(macCatalyst)
        if let usbContact = usbDeviceContact, contact.publicKey == usbContact.publicKey,
           let session = usbDeviceSession {
            return session
        }
        #endif
        let key = contact.publicKeyPrefix
        if let existing = remoteSessions[key] {
            return existing
        }
        let session = RemoteDeviceSession(contact: contact)
        remoteSessions[key] = session
        // Forward session changes so views update
        sessionCancellables[key] = session.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.onStateChanged?()
                }
            }
        return session
    }

    /// Login to a remote device (repeater/room server).
    func loginToRemoteDevice(_ contact: Contact, password: String, remember: Bool = true) {
        let session = remoteSession(for: contact)
        if case .loggingIn = session.loginState { return }
        session.loginState = .loggingIn
        pendingLoginPasswordBytes = ContiguousArray(password.utf8)
        pendingLoginRememberPassword = remember
        let frame = MeshCoreProtocol.buildSendLogin(
            recipientPublicKey: contact.publicKey,
            password: password
        )
        sendCommand?(frame, "SEND_LOGIN")
    }

    /// Cancel a pending login attempt.
    func cancelLogin(for contact: Contact) {
        let session = remoteSession(for: contact)
        if case .loggingIn = session.loginState {
            session.loginState = .notLoggedIn
            loginTimeoutTask?.cancel()
            loginTimeoutTask = nil
            clearPendingPassword()
            pendingLoginRememberPassword = false
        }
    }

    /// Returns true if a CLI command requires write/admin permission.
    private func isWriteCLICommand(_ cmd: String) -> Bool {
        let lower = cmd.lowercased().trimmingCharacters(in: .whitespaces)
        return lower.hasPrefix("set ") || lower == "reboot" || lower.hasPrefix("powersaving ")
            || lower == "start ota" || lower.hasPrefix("start ")
    }

    /// Minimum interval between remote CLI commands to prevent mesh airtime abuse.
    private static let cliMinIntervalSeconds: TimeInterval = 0.3
    private var lastRemoteCLITime: Date?

    /// Returns true if a remote CLI command should be rate-limited (called too soon after the previous one).
    private func isRateLimited() -> Bool {
        let now = Date()
        if let last = lastRemoteCLITime, now.timeIntervalSince(last) < Self.cliMinIntervalSeconds {
            return true
        }
        lastRemoteCLITime = now
        return false
    }

    /// Send a CLI command to a remote device.
    func sendCLICommand(_ command: String, to contact: Contact) {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        #if os(macOS) || targetEnvironment(macCatalyst)
        if let usbContact = usbDeviceContact, contact.publicKey == usbContact.publicKey,
           let session = usbDeviceSession,
           let sendUSBCLI = sendUSBCLI {
            // Drop command if one is already pending — firmware locks up from queued commands.
            if session.hasPendingCLICommands {
                DebugLogger.shared.log("USB CLI: dropped '\(trimmed)' — previous command still pending", level: .warning)
                Self.logger.warning("USB CLI: dropped '\(trimmed)' — previous command still pending")
                return
            }
            session.commandSent(trimmed)
            sendUSBCLI(trimmed)
            usbCLIOutput.append(USBTerminalLine(text: "> \(trimmed)", isCommand: true))
            DebugLogger.shared.log("USB CLI TX: \(trimmed)", level: .tx)
            return
        }
        #endif

        let session = remoteSession(for: contact)

        // Enforce login state and write permissions before sending remote CLI commands.
        switch session.loginState {
        case .loggedIn(let permission):
            if isWriteCLICommand(trimmed) && !permission.canEdit {
                let msg = "CLI BLOCKED: '\(trimmed)' requires write permission (current: \(permission.displayName))"
                Self.logger.warning("\(msg)")
                DebugLogger.shared.log(msg, level: .warning)
                return
            }
        case .notLoggedIn, .loggingIn, .loginFailed:
            let msg = "CLI BLOCKED: '\(trimmed)' — not logged in to \(contact.name)"
            Self.logger.warning("\(msg)")
            DebugLogger.shared.log(msg, level: .warning)
            return
        }

        if isRateLimited() {
            let msg = "CLI RATE LIMITED: '\(trimmed)' dropped — too many commands"
            Self.logger.warning("\(msg)")
            DebugLogger.shared.log(msg, level: .warning)
            return
        }

        let cmdIndex = session.commandSent(trimmed)

        if trimmed.hasPrefix("gps") {
            Self.logger.info("REMOTE GPS: Sending '\(trimmed)' to \(contact.name)")
        }

        let frame = MeshCoreProtocol.buildSendCLICommand(
            command: trimmed,
            recipientKeyHash: contact.publicKeyPrefix
        )
        sendCommand?(frame, "CLI_CMD")

        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard let self else { return }
            self.syncNextMessage?()

            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled else { return }
            session.timeoutCommand(at: cmdIndex)

            let recentHistory = session.cliHistory.suffix(3)
            if recentHistory.count >= 3,
               recentHistory.allSatisfy({ $0.response == "(no response)" }),
               case .loggedIn = session.loginState {
                session.loginState = .loginFailed(
                    message: "Session may have expired \u{2014} please login again."
                )
                session.cliHistory = []
                session.settings = [:]
                session.hasLoadedFullSettings = false
                session.isFetchingSettings = false
                session.isWaitingForResponse = false
            }
        }
    }

    /// Send a CLI command directly to a known session, bypassing the session lookup and rate limiter.
    /// Use when the caller already holds a verified logged-in session (e.g. OTA flow).
    func sendCLICommand(_ command: String, on session: RemoteDeviceSession) {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        guard case .loggedIn(let permission) = session.loginState else {
            let msg = "CLI BLOCKED (direct): '\(trimmed)' — session not logged in for \(session.contact.name)"
            Self.logger.warning("\(msg)")
            DebugLogger.shared.log(msg, level: .warning)
            return
        }

        if isWriteCLICommand(trimmed) && !permission.canEdit {
            let msg = "CLI BLOCKED (direct): '\(trimmed)' requires write permission (current: \(permission.displayName))"
            Self.logger.warning("\(msg)")
            DebugLogger.shared.log(msg, level: .warning)
            return
        }

        let cmdIndex = session.commandSent(trimmed)
        let frame = MeshCoreProtocol.buildSendCLICommand(
            command: trimmed,
            recipientKeyHash: session.contact.publicKeyPrefix
        )
        sendCommand?(frame, "CLI_CMD")
        DebugLogger.shared.log("CLI TX: \(trimmed) → \(session.contact.name)", level: .tx)
        Self.logger.info("CLI TX (direct): '\(trimmed)' → \(session.contact.name)")

        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard let self else { return }
            self.syncNextMessage?()

            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled else { return }
            session.timeoutCommand(at: cmdIndex)
        }
    }

    /// Log out from a remote device session.
    func logoutFromRemoteDevice(_ contact: Contact) {
        let session = remoteSession(for: contact)
        for i in session.cliHistory.indices where !session.cliHistory[i].isComplete {
            session.cliHistory[i].response = "(session ended)"
        }
        session.loginState = .notLoggedIn
        session.cliHistory = []
        session.settings = [:]
        session.isFetchingSettings = false
        session.hasLoadedFullSettings = false
        session.isWaitingForResponse = false
        session.fetchReceivedCount = 0
        session.fetchTotalCount = 0
    }

    /// Fetch all settings from a remote device sequentially.
    /// Active fetch task — stored so it can be cancelled when user navigates away.
    private var fetchTask: Task<Void, Never>?

    func fetchRemoteSettings(for contact: Contact) {
        let session = remoteSession(for: contact)
        guard !session.isFetchingSettings else {
            Self.logger.info("REMOTE MGMT: Settings fetch already in progress, skipping duplicate for \(contact.name)")
            return
        }

        // Cancel any previous fetch (e.g. for a different device)
        fetchTask?.cancel()

        session.isFetchingSettings = true
        session.fetchReceivedCount = 0

        let commands = [
            "ver", "clock",
            "get radio", "get tx", "get repeat",
            "get dutycycle", "get af", "get rxdelay", "get txdelay", "get direct.txdelay",
            "get flood.max", "get flood.max.unscoped", "get int.thresh", "get agc.reset.interval",
            "get name", "get lat", "get lon", "get owner.info",
            "get advert.interval", "get flood.advert.interval", "get multi.acks",
            "get allow.read.only",
            "get adc.multiplier",
            "get loop.detect", "get path.hash.mode",
            "get role", "get public.key", "get guest.password",
            "powersaving", "gps", "gps advert",
        ]

        session.fetchTotalCount = commands.count
        Self.logger.info("REMOTE MGMT: Fetching \(commands.count) settings for \(contact.name) (sequential, cancellable)")

        fetchTask = Task { [weak self] in
            for (index, command) in commands.enumerated() {
                guard let self, !Task.isCancelled else {
                    Self.logger.info("REMOTE MGMT: Fetch cancelled at \(index)/\(commands.count)")
                    session.isFetchingSettings = false
                    return
                }
                await self.fetchRemoteSetting(command: command, contact: contact, session: session)
                session.fetchReceivedCount = index + 1
            }
            guard !Task.isCancelled else {
                session.isFetchingSettings = false
                return
            }
            session.isFetchingSettings = false
            session.hasLoadedFullSettings = true
            Self.logger.info("REMOTE MGMT: Finished fetching settings for \(contact.name), received \(session.fetchReceivedCount)/\(commands.count)")

            // Auto-sync clock after fetch completes (clock value was fetched as part of the
            // settings). Must happen after fetch, not during, to avoid response interleaving.
            #if os(macOS) || targetEnvironment(macCatalyst)
            if let self, self.usbDeviceContact != nil, contact.publicKey == self.usbDeviceContact?.publicKey {
                if let clockResponse = session.settings["clock"] {
                    let todayFmt = DateFormatter()
                    todayFmt.dateFormat = "d/M/yyyy"
                    todayFmt.timeZone = TimeZone(identifier: "UTC")
                    let todayStr = todayFmt.string(from: Date())
                    if !clockResponse.contains(todayStr) {
                        let now = Int(Date().timeIntervalSince1970)
                        let timeCmd = "time \(now)"
                        await self.fetchRemoteSetting(command: timeCmd, contact: contact, session: session)
                        // Re-read clock to confirm
                        await self.fetchRemoteSetting(command: "clock", contact: contact, session: session)
                        DebugLogger.shared.log("CLOCK: auto-synced USB CLI device time to \(now)", level: .info)
                    } else {
                        DebugLogger.shared.log("CLOCK: device has today's date, skipping sync", level: .info)
                    }
                }
            }
            #endif
        }
    }

    /// Cancel any in-progress settings fetch. Called from onDisappear in RemoteManagementView.
    func cancelFetch() {
        if let task = fetchTask, !task.isCancelled {
            task.cancel()
            Self.logger.info("REMOTE MGMT: Fetch cancelled by user")
        }
        fetchTask = nil
    }

    /// CLI commands grouped by UI section for on-demand loading.
    static let sectionCommands: [String: [String]] = [
        "info": ["ver", "clock", "get name", "get role", "get public.key"],
        "radio": ["get radio", "get tx", "get repeat"],
        "timing": ["get dutycycle", "get af", "get rxdelay", "get txdelay", "get direct.txdelay",
                    "get flood.max", "get flood.max.unscoped", "get int.thresh", "get agc.reset.interval"],
        "routing": ["get loop.detect", "get path.hash.mode", "region default"],
        "advertising": ["get name", "get lat", "get lon", "get owner.info",
                        "get advert.interval", "get flood.advert.interval", "get multi.acks"],
        "gps": ["gps", "gps advert"],
        "security": ["get allow.read.only", "get guest.password", "get adc.multiplier"],
        "maintenance": ["powersaving"],
    ]

    /// Fetch commands for a specific section. Fire-and-forget.
    func fetchSection(_ section: String, for contact: Contact, skipIfFetched: Bool = true) {
        Task { [weak self] in await self?.fetchSectionAsync(section, for: contact, skipIfFetched: skipIfFetched) }
    }

    /// Fetch commands for a specific section, awaitable.
    /// If the section has cached values, they're already in session.settings from init.
    /// This always fetches fresh values to verify/update the cache.
    /// Pass `skipIfFetched: true` (default) to skip sections already fetched this session.
    func fetchSectionAsync(_ section: String, for contact: Contact, skipIfFetched: Bool = true) async {
        let session = remoteSession(for: contact)
        if skipIfFetched && session.fetchedSections.contains(section) { return }

        // Wait if another section is currently fetching
        while session.fetchingSection != nil {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }

        guard let commands = Self.sectionCommands[section] else { return }

        session.flushPendingCommands()
        session.fetchingSection = section
        Self.logger.info("REMOTE MGMT: Fetching section '\(section)' (\(commands.count) commands) for \(contact.name)")

        for command in commands {
            guard !Task.isCancelled else {
                session.fetchingSection = nil
                return
            }
            await fetchRemoteSetting(command: command, contact: contact, session: session)
        }

        session.fetchedSections.insert(section)
        session.fetchingSection = nil
        // Flush settings cache to disk after each section completes
        session.flushCacheNow()
        Self.logger.info("REMOTE MGMT: Section '\(section)' loaded for \(contact.name)")
    }

    /// Fetch only volatile keys that change automatically (clock, etc).
    /// Used when cache exists to avoid re-fetching stable settings.
    private func fetchVolatileKeys(for contact: Contact, session: RemoteDeviceSession) async {
        let volatileCommands = ["clock", "ver"]
        Self.logger.info("REMOTE MGMT: Fetching \(volatileCommands.count) volatile keys for \(contact.name) (cache hit)")

        for command in volatileCommands {
            guard !Task.isCancelled else { return }
            await fetchRemoteSetting(command: command, contact: contact, session: session)
        }
    }

    /// Send a single CLI command and wait for its response.
    private func fetchRemoteSetting(command: String, contact: Contact, session: RemoteDeviceSession) async {
        let cmdIndex: Int

        #if os(macOS) || targetEnvironment(macCatalyst)
        if let usbContact = usbDeviceContact, contact.publicKey == usbContact.publicKey,
           let sendUSBCLI = sendUSBCLI {
            // Use queued send — the queue provides 500ms pacing between commands
            // which the firmware requires to avoid lockup.
            cmdIndex = session.commandSent(command)
            sendUSBCLI(command)
            usbCLIOutput.append(USBTerminalLine(text: "> \(command)", isCommand: true))
        } else {
            cmdIndex = session.commandSent(command)
            let frame = MeshCoreProtocol.buildSendCLICommand(
                command: command,
                recipientKeyHash: contact.publicKeyPrefix
            )
            sendCommand?(frame, "CLI_FETCH")
            // Wait for radio to process before pulling response
            try? await Task.sleep(nanoseconds: 500_000_000)
            syncNextMessage?()
        }
        #else
        cmdIndex = session.commandSent(command)
        let frame = MeshCoreProtocol.buildSendCLICommand(
            command: command,
            recipientKeyHash: contact.publicKeyPrefix
        )
        sendCommand?(frame, "CLI_FETCH")
        // Wait for radio to process before pulling response
        try? await Task.sleep(nanoseconds: 500_000_000)
        syncNextMessage?()
        #endif

        // Strict 1-request-1-answer: wait for response before sending next command
        let received = await session.waitForResponse(at: cmdIndex, timeout: 3.0)
        if !received {
            session.timeoutCommand(at: cmdIndex)
        }
        // Spacing between commands to prevent overrunning the radio
        try? await Task.sleep(nanoseconds: 500_000_000)
    }

    // MARK: - USB CLI

    #if os(macOS) || targetEnvironment(macCatalyst)
    /// Closure to send a raw CLI command through USB serial (queued).
    var sendUSBCLI: ((String) -> Void)?
    /// Closure to send a raw CLI command directly, bypassing the queue (for settings fetch).
    var sendUSBCLIDirect: ((String) -> Void)?
    /// Closure to send a keepalive byte without triggering a CLI command.
    var sendUSBKeepalive: (() -> Void)?

    /// Whether the USB device is CLI-connected and has a management session.
    var isUSBCLIConnected: Bool {
        usbDeviceSession != nil
    }

    /// Handle USB CLI line received.
    func handleUSBCLILine(_ line: String) {
        usbCLIOutput.append(USBTerminalLine(text: line, isCommand: false))
        if let session = usbDeviceSession {
            session.responseReceived(line)
        }
    }

    /// Called when USB CLI mode is detected — sets up management session.
    func onUSBCLIReady(portName: String, sendCLI: @escaping (String) -> Void) {
        let usbPubKey = Data(repeating: 0xFE, count: 32)
        let contact = Contact(
            publicKey: usbPubKey,
            name: portName,
            type: .repeater,
            flags: 0,
            outPathLen: 0,
            outPath: Data(),
            lastAdvert: Date().epochUInt32,
            latitude: 0,
            longitude: 0
        )
        usbDeviceContact = contact

        let session = RemoteDeviceSession(contact: contact)
        session.loginState = .loggedIn(permission: .admin)
        usbDeviceSession = session
        // Forward session changes
        session.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.onStateChanged?()
                }
            }
            .store(in: &usbSessionCancellable)

        DebugLogger.shared.log("USB CLI: management session created with admin access", level: .info)

        // Clock sync is handled by the settings fetch — "ver" and "clock" are the first
        // two commands. Doing it separately here caused response interleaving with the
        // fetch, corrupting settings. The fetch's waitForResponse ensures proper sequencing.

        usbKeepaliveTask?.cancel()
        usbKeepaliveTask = nil
    }

    private var usbSessionCancellable = Set<AnyCancellable>()

    /// Send a raw CLI command and add to output log.
    func sendUSBCLICommand(_ command: String, via sendCLI: (String) -> Void) {
        sendCLI(command)
        usbCLIOutput.append(USBTerminalLine(text: "> \(command)", isCommand: true))
    }
    #endif

    // MARK: - Response Handlers (called by frame dispatch)

    /// Handle RESP_CODE_SENT — track login timeout.
    func handleSentResponse(expectedACK: UInt32, suggestedTimeoutMs: UInt32) {
        let hasLoginPending = remoteSessions.values.contains(where: {
            if case .loggingIn = $0.loginState { return true }
            return false
        })
        if hasLoginPending {
            let timeoutMs = UInt64(suggestedTimeoutMs) + 3000
            loginTimeoutTask?.cancel()
            loginTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: timeoutMs * 1_000_000)
                guard !Task.isCancelled, let self else { return }
                for (_, session) in self.remoteSessions {
                    if case .loggingIn = session.loginState {
                        session.loginState = .loginFailed(
                            message: "Login timed out \u{2014} the device did not respond. Check your password and make sure the device is in range."
                        )
                        break
                    }
                }
            }
        }
    }

    /// Handle login success. Returns the contact key prefix if matched, for activity tracking.
    @discardableResult
    func handleLoginSuccess(permissionLevel: Int) -> Data? {
        loginTimeoutTask?.cancel()
        loginTimeoutTask = nil
        let contacts = contactsProvider?() ?? []
        let permission = RemotePermission(rawValue: permissionLevel) ?? .guest
        for (key, session) in remoteSessions {
            if case .loggingIn = session.loginState {
                session.loginState = .loggedIn(permission: permission)

                if pendingLoginRememberPassword, let bytes = pendingLoginPasswordBytes,
                   let contact = contacts.first(where: { $0.publicKeyPrefix == key }),
                   let password = String(bytes: bytes, encoding: .utf8) {
                    let type = permission.isAdmin ? "admin" : "guest"
                    KeychainManager.savePassword(password, forDevice: contact.publicKey, type: type)
                }
                clearPendingPassword()
                pendingLoginRememberPassword = false

                syncNextMessage?()
                if let contact = contacts.first(where: { $0.publicKeyPrefix == key }) {
                    Self.logger.info("REMOTE MGMT: Login success for \(contact.name), fetching Phase 1 settings")
                    Task { [weak self] in
                        guard let self else { return }
                        // Phase 1: auto-fetch essentials sequentially (1-request-1-answer)
                        let session = self.remoteSession(for: contact)
                        let hasCachedData = !session.settings.isEmpty

                        if hasCachedData {
                            // Cache exists — wait for StatusResponse (battery/uptime) before CLI
                            // STATUS_REQ was sent on login; give LoRa time to round-trip
                            let contactKey = contact.publicKeyPrefix
                            for _ in 0..<16 {
                                try? await Task.sleep(nanoseconds: 500_000_000) // 500ms intervals
                                if self.statusByContact[contactKey] != nil { break }
                            }
                            // Then fetch volatile keys (clock)
                            await self.fetchVolatileKeys(for: contact, session: session)
                        } else {
                            // No cache — wait briefly then fetch Phase 1 visible sections
                            try? await Task.sleep(nanoseconds: 1_500_000_000)
                            await self.fetchSectionAsync("info", for: contact)
                            await self.fetchSectionAsync("radio", for: contact)
                        }
                    }
                }
                return key
            }
        }
        return nil
    }

    /// Handle login failure.
    func handleLoginFail() {
        loginTimeoutTask?.cancel()
        loginTimeoutTask = nil
        let contacts = contactsProvider?() ?? []
        for (key, session) in remoteSessions {
            if case .loggingIn = session.loginState {
                session.loginState = .loginFailed(message: "Login failed \u{2014} incorrect password.")
                if let contact = contacts.first(where: { $0.publicKeyPrefix == key }) {
                    KeychainManager.deleteAllPasswords(forDevice: contact.publicKey)
                }
                clearPendingPassword()
                pendingLoginRememberPassword = false
                return
            }
        }
    }

    /// Called to update a contact's activity timestamp when we receive proof of life.
    var touchContact: ((Data) -> Void)?

    /// Handle incoming message — route CLI responses to session.
    /// Returns true if the message was consumed by a remote session.
    func routeIncomingMessage(_ message: Message) -> Bool {
        let contactKey = message.contactKeyHash

        guard let session = remoteSessions[contactKey], !message.isOutgoing else { return false }
        guard case .loggedIn = session.loginState else { return false }
        touchContact?(contactKey)

        if message.txtType == 1 {
            Self.logger.info("CLI response (txtType=1) → management: '\(message.text)'")
            let responseText = message.text.hasPrefix("> ")
                ? String(message.text.dropFirst(2))
                : message.text
            if let pending = session.oldestPendingCommand, pending.hasPrefix("gps") {
                Self.logger.info("REMOTE GPS: Response: '\(responseText)'")
            }
            session.responseReceived(responseText)
            return true
        }
        if session.hasPendingCLICommands || session.isFetchingSettings {
            Self.logger.info("Routing to CLI (pending commands): '\(message.text)'")
            let responseText = message.text.hasPrefix("> ")
                ? String(message.text.dropFirst(2))
                : message.text
            session.responseReceived(responseText)
            return true
        }
        if session.contact.type == .room {
            Self.logger.info("Room chat message: '\(message.text)'")
            return false
        }
        Self.logger.info("Discarding non-CLI message from repeater")
        return true
    }

    /// Handle error response for login/discover/path.
    /// Returns true if the error was handled.
    func handleErrorResponse(code: UInt8, description: String) -> Bool {
        // Stop login spinner
        for (_, session) in remoteSessions {
            if case .loggingIn = session.loginState {
                loginTimeoutTask?.cancel()
                loginTimeoutTask = nil
                session.loginState = .loginFailed(message: description)
                return true
            }
        }

        // Path request unsupported fallback
        if let key = pendingAdvertPathKey {
            pendingAdvertPathKey = nil
            let contacts = contactsProvider?() ?? []
            if let contact = contacts.first(where: { $0.publicKeyPrefix == key }) {
                buildFallbackPath(for: contact)
                return true
            }
        }

        // Discover unsupported fallback
        if isDiscovering && code == 1 && description.lowercased().contains("unsupported") {
            discoverUnsupported = true
            startDiscoverFallback()
            return true
        }

        return false
    }

    // MARK: - Discover

    func startDiscover() {
        discoveredNodes = []
        isDiscovering = true
        discoverFallbackMessage = nil

        if discoverUnsupported {
            startDiscoverFallback()
        } else {
            let frame = MeshCoreProtocol.buildSendDiscover()
            sendCommand?(frame, "DISCOVER_REQ")

            discoverTimeoutTask?.cancel()
            discoverTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled, let self, self.isDiscovering else { return }
                self.isDiscovering = false
            }
        }
    }

    func stopDiscover() {
        discoverTimeoutTask?.cancel()
        isDiscovering = false
        DebugLogger.shared.log("DISCOVER: stopped by user", level: .info)
    }

    private func startDiscoverFallback() {
        discoverFallbackMessage = "Using advertisement-based discovery (firmware does not support active discover scan)"
        sendCommand?(MeshCoreProtocol.buildSendSelfAdvert(advertType: 1), "FLOOD_ADVERT_DISCOVER")

        discoverTimeoutTask?.cancel()
        discoverTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard !Task.isCancelled, let self, self.isDiscovering else { return }
            self.isDiscovering = false
        }
    }

    /// Convert a Contact from an advert push into a DiscoveredNode.
    func addAdvertAsDiscoveredNode(_ contact: Contact) {
        let selfKeyHex = deviceConfigProvider?().publicKeyHex ?? ""
        let contactKeyHex = contact.publicKeyPrefix.hexCompact
        if !selfKeyHex.isEmpty && selfKeyHex.hasPrefix(contactKeyHex) { return }

        let node = DiscoveredNode(
            publicKey: Data(contact.publicKeyPrefix),
            name: contact.name,
            type: contact.type,
            snr: 0,
            rssi: 0,
            pathLen: UInt8(clamping: contact.outPathLen),
            latitude: contact.latitude,
            longitude: contact.longitude
        )
        if let idx = discoveredNodes.firstIndex(where: { $0.publicKey == node.publicKey }) {
            discoveredNodes[idx] = node
        } else {
            discoveredNodes.append(node)
        }
    }

    /// Handle PUSH_CODE_CONTROL_DATA — parse discover responses.
    func handleControlData(snr: Int8, rssi: Int8, pathLen: UInt8, payload: Data) {
        guard payload.count >= 2 else { return }
        let subType = payload[0]
        guard subType == 0x81 else {
            Self.logger.debug("Control data sub_type=0x\(String(format: "%02x", subType)) — not a discover response")
            return
        }

        var offset = 1
        let keyLen = min(32, payload.count - offset)
        guard keyLen >= 6 else { return }
        let publicKey = Data(payload[offset..<offset+keyLen])
        offset += keyLen

        let contactType: ContactType
        if offset < payload.count {
            contactType = ContactType(rawValue: payload[offset]) ?? .unknown
            offset += 1
        } else {
            contactType = .unknown
        }

        let name: String
        if offset + 32 <= payload.count {
            let nameSlice = payload[offset..<offset+32]
            if let nullIdx = nameSlice.firstIndex(of: 0x00) {
                name = String(data: Data(payload[offset..<nullIdx]), encoding: .utf8) ?? ""
            } else {
                name = String(data: Data(nameSlice), encoding: .utf8) ?? ""
            }
            offset += 32
        } else if offset < payload.count {
            name = String(data: Data(payload[offset...]), encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) ?? ""
            offset = payload.count
        } else {
            name = ""
        }

        var latitude: Double = 0
        var longitude: Double = 0
        if offset + 8 <= payload.count {
            var latRaw: Int32 = 0
            _ = withUnsafeMutableBytes(of: &latRaw) { dest in
                payload.copyBytes(to: dest, from: offset..<offset+4)
            }
            latitude = Double(Int32(littleEndian: latRaw)) / 1_000_000.0
            offset += 4
            var lonRaw: Int32 = 0
            _ = withUnsafeMutableBytes(of: &lonRaw) { dest in
                payload.copyBytes(to: dest, from: offset..<offset+4)
            }
            longitude = Double(Int32(littleEndian: lonRaw)) / 1_000_000.0
            offset += 4
        }

        let selfKeyHex = deviceConfigProvider?().publicKeyHex ?? ""
        let nodeKeyHex = Data(publicKey.prefix(6)).hexCompact
        if !selfKeyHex.isEmpty && selfKeyHex.hasPrefix(nodeKeyHex) {
            Self.logger.debug("Discover: filtered self-advert (\(name))")
            return
        }

        if name.isEmpty && snr == 0 && rssi == 0 {
            Self.logger.debug("Discover: filtered zero-signal unnamed node")
            return
        }

        let node = DiscoveredNode(
            publicKey: publicKey,
            name: name,
            type: contactType,
            snr: snr,
            rssi: rssi,
            pathLen: pathLen,
            latitude: latitude,
            longitude: longitude
        )

        if let idx = discoveredNodes.firstIndex(where: { $0.publicKey == publicKey }) {
            discoveredNodes[idx] = node
        } else {
            discoveredNodes.append(node)
        }

        Self.logger.info("Discovered: '\(name)' type=\(contactType.rawValue) snr=\(snr) rssi=\(rssi)")
    }

    // MARK: - Trace Route

    func traceRoute(to contact: Contact) {
        guard contact.outPathLen > 0, !contact.outPath.isEmpty else {
            showError?(contact.outPathLen == 0
                ? "This contact is a direct neighbor — no route to trace."
                : "No path known for this contact — cannot trace route.")
            return
        }
        let tag = UInt32.random(in: 0..<UInt32.max)
        pendingTraceTag = tag
        pendingTraceContact = contact
        lastTraceResult = nil
        let actualPathLen = Int(contact.outPathLen)
        let pathData = contact.outPath.prefix(actualPathLen)
        let frame = MeshCoreProtocol.buildSendTracePath(outPath: Data(pathData), tag: tag)
        sendCommand?(frame, "TRACE_PATH")

        traceTimeoutTask?.cancel()
        traceTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled, let self, self.pendingTraceTag == tag else { return }
            self.pendingTraceTag = nil
            if self.lastTraceResult == nil {
                self.showError?("Trace route timed out — the path may not be reachable.")
            }
        }
    }

    func handleTraceData(_ result: TraceResult) {
        traceTimeoutTask?.cancel()
        lastTraceResult = result
        pendingTraceTag = nil
        if let contact = pendingTraceContact {
            detailContactForTrace = contact
        }
        pendingTraceContact = nil

        // If ping is in progress, record the result
        if isPinging, let sendTime = pingSendTime {
            let latency = Date().timeIntervalSince(sendTime) * 1000
            pingResults.append(PingResult(seq: pingCount, latencyMs: latency, hops: result.hops.count, timestamp: Date()))
            pingSendTime = nil
            continueMultiPing()
        }
    }

    // MARK: - Ping

    /// Single ping — sends a trace and measures round-trip time.
    func ping(contact: Contact) {
        startPing(contact: contact, count: 1)
    }

    /// Multi-ping — sends N pings with 3s spacing, collects stats.
    func multiPing(contact: Contact, count: Int) {
        startPing(contact: contact, count: count)
    }

    func cancelPing() {
        pingTask?.cancel()
        isPinging = false
        pingSendTime = nil
    }

    private func startPing(contact: Contact, count: Int) {
        guard contact.outPathLen > 0, !contact.outPath.isEmpty else {
            showError?("Cannot ping — no route known. Try a direct neighbor with Status Request instead.")
            return
        }
        pingResults = []
        pingCount = 0
        pingTotal = count
        pingContact = contact
        isPinging = true
        sendSinglePing()
    }

    private func sendSinglePing() {
        guard let contact = pingContact, pingCount < pingTotal else {
            isPinging = false
            return
        }
        pingCount += 1
        pingSendTime = Date()

        let tag = UInt32.random(in: 0..<UInt32.max)
        pendingTraceTag = tag
        pendingTraceContact = contact
        lastTraceResult = nil
        let actualPathLen = Int(contact.outPathLen)
        let pathData = contact.outPath.prefix(actualPathLen)
        let frame = MeshCoreProtocol.buildSendTracePath(outPath: Data(pathData), tag: tag)
        sendCommand?(frame, "PING(\(pingCount)/\(pingTotal))")

        // Timeout for this ping
        traceTimeoutTask?.cancel()
        traceTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled, let self, self.isPinging, self.pingSendTime != nil else { return }
            self.pingResults.append(PingResult(seq: self.pingCount, latencyMs: nil, hops: 0, timestamp: Date()))
            self.pingSendTime = nil
            self.pendingTraceTag = nil
            self.continueMultiPing()
        }
    }

    private func continueMultiPing() {
        guard isPinging, pingCount < pingTotal else {
            isPinging = false
            return
        }
        // 3-second delay between pings
        pingTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            self?.sendSinglePing()
        }
    }

    // MARK: - Status & Telemetry

    func requestStatus(for contact: Contact, silent: Bool = false) {
        switch contact.type {
        case .chat:
            Self.logger.info("Status request to chat contact — may not respond")
        case .repeater:
            Self.logger.info("Requesting status from repeater \(contact.name)")
        case .room:
            Self.logger.info("Requesting status from room server \(contact.name)")
        default:
            Self.logger.info("Requesting status from \(contact.name)")
        }

        let key = contact.publicKeyPrefix
        pendingStatusKey = key
        let frame = MeshCoreProtocol.buildSendStatusReq(recipientPublicKey: contact.publicKey)
        sendCommand?(frame, "STATUS_REQ")

        statusTimeoutTask?.cancel()
        guard !silent else { return }
        statusTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled, let self, self.pendingStatusKey == key else { return }
            self.pendingStatusKey = nil
            if self.statusByContact[key] == nil {
                self.showError?(contact.type == .chat
                    ? "No status response — status requests are only supported by repeaters, room servers, and sensors."
                    : "No status response — the device may be out of range or powered off.")
            }
        }
    }

    func requestTelemetry(for contact: Contact) {
        DebugLogger.shared.log("TELEMETRY REQ: requesting from \(contact.name)", level: .tx)
        let key = contact.publicKeyPrefix
        pendingTelemetryKey = key
        let frame = MeshCoreProtocol.buildSendTelemetryReq(recipientPublicKey: contact.publicKey)
        sendCommand?(frame, "TELEMETRY_REQ")

        telemetryTimeoutTask?.cancel()
        telemetryTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled, let self, self.pendingTelemetryKey == key else { return }
            self.pendingTelemetryKey = nil
            if self.telemetryByContact[key] == nil {
                switch contact.type {
                case .chat:
                    self.showError?("No telemetry response — telemetry is typically only available from sensor nodes.")
                case .room:
                    self.showError?("No telemetry response — room servers don't typically support telemetry.")
                default:
                    self.showError?("No telemetry response — the node may not support telemetry or is out of range.")
                }
            }
        }
    }

    func handleStatusResponse(_ info: RemoteStatusInfo) {
        statusTimeoutTask?.cancel()
        if let key = pendingStatusKey {
            statusByContact[key] = info
            pendingStatusKey = nil
            statusUpdateCounter += 1
            onStateChanged?()
        }
    }

    func handleTelemetryResponse(senderKey: Data, readings: [TelemetryReading]) {
        telemetryTimeoutTask?.cancel()
        telemetryByContact[senderKey] = readings
        if pendingTelemetryKey == senderKey { pendingTelemetryKey = nil }
    }

    // MARK: - Advert Path

    func requestAdvertPath(for contact: Contact) {
        pendingAdvertPathKey = contact.publicKeyPrefix
        let frame = MeshCoreProtocol.buildGetAdvertPath(publicKey: contact.publicKey)
        sendCommand?(frame, "GET_ADVERT_PATH")

        let key = contact.publicKeyPrefix
        pathTimeoutTask?.cancel()
        pathTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            guard !Task.isCancelled, let self, self.pendingAdvertPathKey == key else { return }
            self.pendingAdvertPathKey = nil
            if self.advertPathByContact[key] == nil {
                self.buildFallbackPath(for: contact)
            }
        }
    }

    private func buildFallbackPath(for contact: Contact) {
        let key = contact.publicKeyPrefix
        if contact.outPathLen > 0, !contact.outPath.isEmpty {
            var hops: [Data] = []
            var offset = 0
            while offset + 6 <= contact.outPath.count {
                hops.append(Data(contact.outPath[offset..<offset+6]))
                offset += 6
            }
            let info = AdvertPathInfo(
                recvTimestamp: contact.lastAdvert,
                pathLen: UInt8(hops.count),
                pathHashes: hops
            )
            advertPathByContact[key] = info
        } else if contact.outPathLen == 0 {
            let info = AdvertPathInfo(recvTimestamp: contact.lastAdvert, pathLen: 0, pathHashes: [])
            advertPathByContact[key] = info
        } else {
            showError?("No path data available for this contact.")
        }
    }

    func handleAdvertPathResponse(_ info: AdvertPathInfo) {
        pathTimeoutTask?.cancel()
        if let key = pendingAdvertPathKey {
            advertPathByContact[key] = info
            pendingAdvertPathKey = nil
        }
    }

    // MARK: - Path Discovery (0x8D)

    func discoverPath(for contact: Contact) {
        pendingPathDiscoveryKey = contact.publicKeyPrefix
        sendCommand?(MeshCoreProtocol.buildSendPathDiscoveryReq(publicKey: contact.publicKey), "PATH_DISCOVERY")

        let key = contact.publicKeyPrefix
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard !Task.isCancelled, let self, self.pendingPathDiscoveryKey == key else { return }
            self.pendingPathDiscoveryKey = nil
        }
    }

    func handlePathDiscovery(_ result: PathDiscoveryResult) {
        pathDiscoveryByContact[result.pubKeyPrefix] = result
        pendingPathDiscoveryKey = nil
    }

    // MARK: - Allowed Repeat Frequencies

    func requestAllowedRepeatFreq() {
        sendCommand?(MeshCoreProtocol.buildGetAllowedRepeatFreq(), "GET_ALLOWED_REPEAT_FREQ")
    }

    func handleAllowedRepeatFreq(_ ranges: [FrequencyRange]) {
        allowedRepeatFreqRanges = ranges
    }

    func handleBinaryResponse(tag: UInt32, payload: Data) {
        guard let handler = pendingBinaryRequests.removeValue(forKey: tag) else {
            Self.logger.debug("BinaryResponse: no handler registered for tag=\(tag)")
            return
        }
        handler(payload)
    }

    func registerBinaryResponseHandler(tag: UInt32, handler: @escaping (Data) -> Void) {
        pendingBinaryRequests[tag] = handler
    }

    /// Request status from a remote device (simple forward).
    func requestRemoteStatus(_ contact: Contact) {
        let frame = MeshCoreProtocol.buildSendStatusReq(
            recipientPublicKey: contact.publicKey
        )
        sendCommand?(frame, "STATUS_REQ")
    }
}
