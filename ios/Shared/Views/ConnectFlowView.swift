//
//  ConnectFlowView.swift
//  Lilyshark
//
//  Connecting a deck, as one guided screen instead of a settings list.
//
//  The first connection is the moment someone decides whether this app is
//  worth keeping, so it is built as four honest steps rather than a form:
//
//    1. Search. A radar with the phone at its centre. Radios appear on it as
//       they are heard, nearer the middle the stronger their signal, and as
//       big cards underneath with one Connect button each. Help appears on
//       its own if nothing turns up, starting with the most common real cause:
//       the radio is already connected to another app on this phone, and a
//       connected radio stops advertising.
//    2. Connect. The chosen radio moves to the centre and four steps tick off
//       from the connection's actual state: link, radio service, the deck's
//       own settings, and the nodes it has heard, counted as they arrive.
//    3. Arrive. "You're on the mesh", with what the deck reported and two
//       things worth doing first: say hello on the public channel, or see who
//       is around.
//    4. Fail well. If the link drops or never becomes ready, say so, say what
//       usually fixes it, and offer to search again.
//
//  A Lilyshark deck does not ask for a Bluetooth PIN (src/device/tdeck_ble.cpp
//  enables no BLE security), so there is no pairing step to explain. If a
//  future firmware adds one, iOS shows its own pairing prompt over this screen.
//
//  Wi-Fi and USB radios still use DeviceScannerView, reached from "Other ways
//  to connect".
//

#if os(iOS)
import SwiftUI
import CoreBluetooth
import MeshCoreKit
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif

struct ConnectFlowView: View {
    enum Finish {
        case done
        case sayHello
        case showMap
        case otherConnection
        case demo
    }

    var onFinish: (Finish) -> Void

    @Environment(ConnectionManager.self) private var connection
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ContactStore.self) private var contactStore
    @Environment(ChannelStore.self) private var channelStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    private enum Phase: Equatable {
        case searching
        case connecting
        case connected
        case failed
    }

    @State private var phase: Phase = .searching
    @State private var chosen: Candidate?
    @State private var showsHelp = false
    @State private var scanCycle: Task<Void, Never>?
    @State private var helpTimer: Task<Void, Never>?
    @State private var connectTimeout: Task<Void, Never>?
    @State private var settleTask: Task<Void, Never>?
    @State private var sawLink = false

    var body: some View {
        withFeedback
            .onAppear(perform: begin)
            .onDisappear(perform: stopAll)
            .onChange(of: connection.connectionState) { _, state in
                follow(state)
            }
            .onChange(of: deviceConfig.isLoading) { _, _ in
                follow(connection.connectionState)
            }
            #if DEBUG && targetEnvironment(simulator)
            // Screenshot QA without taps: connect to the preview deck as soon
            // as it appears (`--lilyshark-simulator-preview --lilyshark-auto-connect`).
            .onChange(of: candidateIDs) { _, _ in
                guard ProcessInfo.processInfo.arguments.contains("--lilyshark-auto-connect"),
                      phase == .searching, let first = candidates.first else { return }
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(2))
                    if phase == .searching { connect(first) }
                }
            }
            #endif
    }

    private var candidateIDs: [UUID] { candidates.map(\.id) }

    // Split from body, with every closure typed, so each piece type-checks
    // quickly: `.connected` also names a BLEConnectionState case, and CI's
    // slower runner timed out resolving the untyped version.
    private var withFeedback: some View {
        animated
            .sensoryFeedback(.success, trigger: phase, condition: Self.arrived)
            .sensoryFeedback(.error, trigger: phase, condition: Self.failedNow)
            .sensoryFeedback(.selection, trigger: candidateIDs.count, condition: Self.grew)
    }

    private var animated: some View {
        screen
            .meshAnimation(ChatGlass.snap, value: phase)
            .meshAnimation(ChatGlass.snap, value: candidateIDs)
    }

    private static func arrived(_ old: Phase, _ new: Phase) -> Bool { new == Phase.connected }
    private static func failedNow(_ old: Phase, _ new: Phase) -> Bool { new == Phase.failed }
    private static func grew(_ old: Int, _ new: Int) -> Bool { new > old }

    private var screen: some View {
        ZStack(alignment: .top) {
            MeshTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: Design.Space.loose) {
                    radar
                        .frame(height: 300)
                        .padding(.top, Design.Space.section)
                    content
                        .frame(maxWidth: 520)
                        .padding(.horizontal, Design.Space.loose)
                }
                .padding(.bottom, Design.Space.section)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .overlay(alignment: .topTrailing) {
            Button {
                onFinish(.done)
            } label: {
                GlassCircleLabel(systemImage: "xmark", size: Design.minimumTouchTarget)
            }
            .buttonStyle(.pressable)
            .padding(.trailing, Design.Space.regular)
            .padding(.top, Design.Space.tight)
            .accessibilityLabel(phase == .connected ? "Done" : "Close")
        }
    }

    // MARK: - Phases

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .searching: searching
        case .connecting: connecting
        case .connected: connected
        case .failed: failed
        }
    }

    private var searching: some View {
        VStack(spacing: Design.Space.loose) {
            header(
                title: candidates.isEmpty ? "Looking for your T-Deck" : "Tap your deck to connect",
                detail: bluetoothProblem ?? (candidates.isEmpty
                    ? "Turn it on and hold it near your phone."
                    : "Radios nearer the middle of the circle have a stronger signal.")
            )
            if let action = bluetoothAction {
                Button(action: action.run) {
                    Label(action.title, systemImage: action.symbol)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshPrimary)
            }
            ForEach(candidates) { candidate in
                candidateCard(candidate)
                    .transition(.asymmetric(insertion: .scale(scale: 0.92).combined(with: .opacity), removal: .opacity))
            }
            if !connection.isScanning && candidates.isEmpty && bluetoothProblem == nil {
                Button {
                    restartScan()
                } label: {
                    Label("Search again", systemImage: "arrow.clockwise")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshPrimary)
            }
            if showsHelp || (!connection.isScanning && candidates.isEmpty) {
                searchHelp
                    .transition(.opacity)
            }
            secondaryLinks
        }
    }

    private var connecting: some View {
        VStack(spacing: Design.Space.loose) {
            header(
                title: "Connecting to \(chosen?.name ?? connection.connectedDeviceName ?? "your deck")",
                detail: "Keep the deck close until this finishes."
            )
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    stepRow(step, isLast: index == steps.count - 1)
                }
            }
            .padding(Design.Space.regular)
            .chatGlass(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }

    private var connected: some View {
        VStack(spacing: Design.Space.loose) {
            header(
                title: "You're on the mesh",
                detail: "\(deckName) is connected. Messages you send go out over its radio."
            )
            stats
            if !heardNodes.isEmpty {
                heardCluster
            }
            VStack(spacing: Design.Space.snug) {
                Button { onFinish(.sayHello) } label: {
                    Label("Say hello on \(publicChannelName)", systemImage: "bubble.left.and.bubble.right.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshPrimary)
                Button { onFinish(.showMap) } label: {
                    Label("See who's around", systemImage: "map")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshSecondary)
                Button("Done") { onFinish(.done) }
                    .font(.body.weight(.semibold))
                    .buttonStyle(.meshPlain)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
    }

    private var failed: some View {
        VStack(spacing: Design.Space.loose) {
            header(
                title: "Couldn't finish connecting",
                detail: "\(chosen?.name ?? "The radio") stopped answering before the connection was ready."
            )
            tipList(failureTips)
            Button {
                restartScan()
            } label: {
                Label("Search again", systemImage: "arrow.clockwise")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .touchable()
            }
            .buttonStyle(.meshPrimary)
            secondaryLinks
        }
    }

    private var failureTips: [(symbol: String, title: String, detail: String)] {
        var tips: [(symbol: String, title: String, detail: String)] = [
            ("iphone.radiowaves.left.and.right", "Close other mesh apps", "A radio connected to the Meshtastic or MeshCore app on this phone can't connect here at the same time."),
        ]
        if chosen?.kind == .meshCore {
            tips.append(("lock", "Check the PIN", "If iOS asked for a code, use the one on the radio's screen. MeshCore radios without a screen usually use 123456."))
        }
        tips += [
            ("arrow.triangle.2.circlepath", "Restart the radio", "Turn it off and on, wait for it to start, then search again."),
            ("figure.walk", "Move closer", "Bluetooth reaches a few metres indoors. The mesh radio reaches much further."),
        ]
        return tips
    }

    // MARK: - Pieces

    private func header(title: String, detail: String) -> some View {
        VStack(spacing: Design.Space.tight) {
            Text(title)
                .font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
                .foregroundStyle(MeshTheme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(detail)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity)
        .id(title)
        .transition(.opacity)
    }

    private func candidateCard(_ candidate: Candidate) -> some View {
        Button {
            connect(candidate)
        } label: {
            HStack(spacing: Design.Space.regular) {
                candidate.orb(size: 52)
                VStack(alignment: .leading, spacing: Design.Space.hairline) {
                    Text(candidate.name)
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                    Text("\(candidate.proximity) · \(candidate.kindLabel)")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text("Connect")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Design.Space.regular)
                    .frame(minHeight: 36)
                    .background(MeshTheme.accent, in: Capsule())
            }
            .padding(Design.Space.regular)
            .contentShape(Rectangle())
            .chatGlass(RoundedRectangle(cornerRadius: 24, style: .continuous), interactive: true)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Connect to \(candidate.name), \(candidate.kindLabel), \(candidate.proximity)")
    }

    private var searchHelp: some View {
        VStack(alignment: .leading, spacing: Design.Space.snug) {
            Text("Not seeing it?")
                .font(.headline)
                .foregroundStyle(MeshTheme.textPrimary)
            tipList([
                ("iphone.radiowaves.left.and.right", "Close other mesh apps", "A radio connected to the Meshtastic or MeshCore app on this phone stops showing up for other apps."),
                ("power", "Check the deck is on", "Its screen should be awake. A deck that has just started needs a few seconds."),
                ("arrow.triangle.2.circlepath", "Restart the deck", "Then come back to this screen. It keeps searching."),
            ])
        }
    }

    private func tipList(_ tips: [(symbol: String, title: String, detail: String)]) -> some View {
        VStack(alignment: .leading, spacing: Design.Space.regular) {
            ForEach(tips, id: \.title) { tip in
                HStack(alignment: .top, spacing: Design.Space.snug) {
                    Image(systemName: tip.symbol)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 28)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tip.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(MeshTheme.textPrimary)
                        Text(tip.detail)
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(Design.Space.regular)
        .frame(maxWidth: .infinity, alignment: .leading)
        .chatGlass(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var secondaryLinks: some View {
        VStack(spacing: Design.Space.tight) {
            Button("No deck yet? Explore the demo") { onFinish(.demo) }
            Button("Put Lilyshark on a T-Deck") {
                if let url = URL(string: "https://lilyshark.com/flash") { openURL(url) }
            }
            Button("Other ways to connect") { onFinish(.otherConnection) }
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.meshPlain)
        .foregroundStyle(MeshTheme.accent)
        .frame(maxWidth: .infinity)
    }

    // MARK: Connecting steps

    private struct Step {
        let title: String
        let detail: String?
        let done: Bool
        let active: Bool
    }

    private var steps: [Step] {
        let state = connection.connectionState
        let linked = state == .connected || state == .ready
        let ready = state == .ready
        let deckRead = ready && !deviceConfig.isLoading && (!deviceConfig.deviceName.isEmpty || !deviceConfig.loadedSections.isEmpty)
        let heard = contactStore.contacts.count
        return [
            // The firmware chimes and shows PHONE CONNECTED OVER BLUETOOTH on
            // the link (sim_main.cpp), so the two screens agree out loud.
            Step(title: "Reaching the deck",
                 detail: linked && chosen?.kind != .meshCore ? String(localized: "Your deck chimes and shows Phone connected") : nil,
                 done: linked, active: !linked),
            Step(title: "Opening its radio service", detail: nil, done: ready, active: linked && !ready),
            Step(title: "Reading its settings", detail: deviceConfig.deviceName.isEmpty ? nil : deviceConfig.deviceName,
                 done: deckRead, active: ready && !deckRead),
            Step(title: "Listening to the mesh",
                 detail: heard == 0 ? nil : heard == 1
                    ? String(localized: "1 node heard so far")
                    : String(localized: "\(heard) nodes heard so far"),
                 done: false, active: deckRead),
        ]
    }

    private func stepRow(_ step: Step, isLast: Bool) -> some View {
        HStack(alignment: .top, spacing: Design.Space.snug) {
            ZStack {
                Circle()
                    .fill(step.done ? MeshTheme.accent : MeshTheme.surfaceLight)
                    .frame(width: 26, height: 26)
                if step.done {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .transition(.scale.combined(with: .opacity))
                } else if step.active {
                    ProgressView()
                        .controlSize(.small)
                        .tint(MeshTheme.accent)
                }
            }
            .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                    .font(.body.weight(step.active ? .semibold : .regular))
                    .foregroundStyle(step.done || step.active ? MeshTheme.textPrimary : MeshTheme.textSecondary)
                if let detail = step.detail {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .contentTransition(.numericText())
                }
            }
            .padding(.bottom, isLast ? 0 : Design.Space.regular)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(step.done ? "Done" : step.active ? "In progress" : "Waiting")
    }

    // MARK: Arrival

    private var deckName: String {
        if !deviceConfig.deviceName.isEmpty { return deviceConfig.deviceName }
        return connection.connectedDeviceName ?? chosen?.name ?? String(localized: "Your deck")
    }

    private var publicChannelName: String {
        guard let channel = channelStore.channels.first(where: { $0.index == 0 }), !channel.name.isEmpty else {
            return String(localized: "the public channel")
        }
        return channel.name
    }

    private var heardNodes: [Contact] {
        Array(contactStore.contacts.prefix(6))
    }

    private var stats: some View {
        let nodes = contactStore.contacts.count
        let channels = channelStore.channels.count
        return HStack(spacing: Design.Space.tight) {
            statChip(value: "\(nodes)", label: nodes == 1 ? "node heard" : "nodes heard")
            statChip(value: "\(channels)", label: channels == 1 ? "channel" : "channels")
            if let battery = batteryText {
                statChip(value: battery, label: "battery")
            }
        }
    }

    private var batteryText: String? {
        switch deviceConfig.batteryReading() {
        case .reported(let percent), .estimated(let percent): "\(percent)%"
        case .externalPower: String(localized: "Plugged in")
        case .unknown: nil
        }
    }

    private func statChip(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(MeshTheme.textPrimary)
                .contentTransition(.numericText())
            Text(label)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Design.Space.snug)
        .chatGlass(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var heardCluster: some View {
        VStack(spacing: Design.Space.tight) {
            HStack(spacing: -12) {
                ForEach(heardNodes) { contact in
                    NodeOrb(seed: contact.publicKey, title: contactStore.displayName(for: contact), size: 44)
                }
            }
            Text(heardSummary)
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(heardSummary)
    }

    private var heardSummary: String {
        let names = heardNodes.prefix(2).map { contactStore.displayName(for: $0) }
        let others = contactStore.contacts.count - names.count
        switch (names.count, others) {
        case (0, _): return ""
        case (1, 0): return String(localized: "Your deck has heard \(names[0]).")
        case (2, 0): return String(localized: "Your deck has heard \(names[0]) and \(names[1]).")
        default: return String(localized: "Your deck has heard \(names.joined(separator: ", ")) and \(others) more.")
        }
    }

    // MARK: - Radar

    private var radar: some View {
        RadarView(
            candidates: phase == .searching ? candidates : [],
            focus: phase == .searching ? nil : focusOrb,
            isSweeping: phase == .searching && connection.isScanning,
            isSettled: phase == .connected,
            onTap: connect
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(phase == .searching ? "Radios found nearby" : deckName)
    }

    private var focusOrb: NodeOrb {
        if let chosen { return chosen.orb(size: 88) }
        return NodeOrb(seed: Data(deckName.utf8), title: deckName, symbol: Candidate.deckSymbol, size: 88)
    }

    // MARK: - Bluetooth state

    private var bluetoothProblem: String? {
        switch CBCentralManager.authorization {
        case .denied, .restricted:
            return String(localized: "Lilyshark needs Bluetooth to talk to your deck. Allow it in Settings.")
        default:
            break
        }
        #if targetEnvironment(simulator)
        if candidates.isEmpty, let message = connection.bleStatusMessage { return message }
        return nil
        #else
        if !connection.bleManager.isPoweredOn, let message = connection.bleStatusMessage { return message }
        return nil
        #endif
    }

    private var bluetoothAction: (title: String, symbol: String, run: () -> Void)? {
        switch CBCentralManager.authorization {
        case .denied, .restricted:
            return ("Open Settings", "gearshape", {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            })
        default:
            return nil
        }
    }

    // MARK: - Candidates

    private var candidates: [Candidate] {
        var found: [Candidate] = []
        #if targetEnvironment(simulator)
        found += connection.simulatorNearbyDecks.map {
            Candidate(id: $0.id, name: $0.name, rssi: $0.rssi, kind: .simulatorDeck)
        }
        #endif
        #if canImport(MeshtasticKit)
        found += connection.discoveredMeshtasticDevices.map {
            Candidate(id: $0.id, name: $0.name, rssi: $0.rssi, kind: .deck)
        }
        #endif
        found += connection.discoveredPeripherals.map {
            Candidate(id: $0.id, name: $0.name, rssi: $0.rssi, kind: .meshCore)
        }
        return found.sorted { $0.signal > $1.signal }
    }

    // MARK: - Actions

    private func begin() {
        switch connection.connectionState {
        case .ready:
            phase = .connected
            return
        case .connecting, .connected:
            phase = .connecting
            sawLink = true
            return
        default:
            break
        }
        restartScan()
    }

    private func restartScan() {
        stopTimers()
        chosen = nil
        sawLink = false
        phase = .searching
        showsHelp = false
        connection.scanRetryCount = 3
        connection.startScanning()
        scanCycle = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                guard !Task.isCancelled else { return }
                connection.handleScanTimeout()
            }
        }
        helpTimer = Task { @MainActor in
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled, candidates.isEmpty else { return }
            showsHelp = true
        }
    }

    private func connect(_ candidate: Candidate) {
        stopTimers()
        chosen = candidate
        sawLink = false
        phase = .connecting
        switch candidate.kind {
        case .deck:
            #if canImport(MeshtasticKit)
            if let device = connection.discoveredMeshtasticDevices.first(where: { $0.id == candidate.id }) {
                connection.connectMeshtastic(to: device)
            }
            #endif
        case .meshCore:
            if let peripheral = connection.discoveredPeripherals.first(where: { $0.id == candidate.id }) {
                connection.connect(to: peripheral)
            }
        case .simulatorDeck:
            #if targetEnvironment(simulator)
            connection.completeSimulatorDeckPreview(named: candidate.name)
            #endif
        }
        // A deck has no PIN, so 45 seconds is generous. A MeshCore radio may
        // put up the system PIN prompt mid-connection; give a person time to
        // read it off the radio and type it, as Meshtastic's app does.
        let limit: Duration = candidate.kind == .meshCore ? .seconds(90) : .seconds(45)
        connectTimeout = Task { @MainActor in
            try? await Task.sleep(for: limit)
            guard !Task.isCancelled, phase == .connecting, connection.connectionState != .ready else { return }
            phase = .failed
        }
    }

    /// Move between phases on what the connection actually reports.
    private func follow(_ state: BLEConnectionState) {
        switch phase {
        case .connecting:
            if state == .connecting || state == .connected || state == .ready { sawLink = true }
            if state == .disconnected && sawLink {
                connectTimeout?.cancel()
                phase = .failed
                return
            }
            guard state == .ready, !deviceConfig.isLoading else { return }
            connectTimeout?.cancel()
            // Let the first node reports land before the arrival screen
            // counts them, so it does not open on "0 nodes heard".
            settleTask?.cancel()
            settleTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(reduceMotion ? 0.8 : 1.6))
                guard !Task.isCancelled, connection.connectionState == .ready else { return }
                phase = .connected
            }
        case .searching:
            // Another path (auto-reconnect to the last deck) got there first.
            if state == .connecting || state == .connected {
                phase = .connecting
                sawLink = true
            } else if state == .ready {
                phase = .connected
            }
        case .connected:
            if state == .disconnected { phase = .failed }
        case .failed:
            break
        }
    }

    private func stopTimers() {
        scanCycle?.cancel()
        helpTimer?.cancel()
        connectTimeout?.cancel()
        settleTask?.cancel()
    }

    private func stopAll() {
        stopTimers()
        if phase == .searching { connection.stopScanning() }
    }
}

// MARK: - Candidate

/// One radio heard during the search, whichever central found it.
private struct Candidate: Identifiable, Equatable {
    enum Kind { case deck, meshCore, simulatorDeck }

    static let deckSymbol = "dot.radiowaves.left.and.right"

    let id: UUID
    let name: String
    let rssi: Int
    let kind: Kind

    /// CoreBluetooth reports 127 when it has no reading.
    var signal: Int { rssi == 127 ? -100 : rssi }

    var kindLabel: String {
        switch kind {
        case .deck, .simulatorDeck: String(localized: "Lilyshark deck")
        case .meshCore: String(localized: "MeshCore radio")
        }
    }

    var proximity: String {
        guard rssi != 127 else { return String(localized: "Signal not reported") }
        switch rssi {
        case (-60)...: return String(localized: "Right next to you")
        case -75 ... -61: return String(localized: "Nearby")
        default: return String(localized: "Weak signal, move closer")
        }
    }

    func orb(size: CGFloat) -> NodeOrb {
        NodeOrb(
            seed: Data(name.utf8),
            title: name,
            symbol: kind == .meshCore ? "antenna.radiowaves.left.and.right" : Self.deckSymbol,
            size: size
        )
    }
}

// MARK: - Radar

/// The phone at the centre of expanding rings, with each radio placed by its
/// signal: the stronger, the nearer the middle. Placement is by signal, not
/// by true distance or direction; Bluetooth gives neither.
private struct RadarView: View {
    let candidates: [Candidate]
    let focus: NodeOrb?
    let isSweeping: Bool
    let isSettled: Bool
    let onTap: (Candidate) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let radius = side / 2
            let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            ZStack {
                rings(radius: radius)
                    .position(center)
                if let focus {
                    focus
                        .scaleEffect(isSettled ? 1.08 : 1)
                        .position(center)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                } else {
                    Image(systemName: "iphone")
                        .font(.title.weight(.semibold))
                        .foregroundStyle(MeshTheme.textPrimary)
                        .frame(width: 72, height: 72)
                        .chatGlass(Circle())
                        .position(center)
                        .accessibilityLabel("Your phone")
                }
                ForEach(candidates) { candidate in
                    Button { onTap(candidate) } label: {
                        VStack(spacing: 4) {
                            candidate.orb(size: 50)
                            Text(candidate.name)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(MeshTheme.textPrimary)
                                .lineLimit(1)
                                .frame(maxWidth: 110)
                        }
                    }
                    .buttonStyle(.pressable)
                    .position(place(candidate, center: center, radius: radius))
                    .transition(.scale(scale: 0.3).combined(with: .opacity))
                    .accessibilityLabel("Connect to \(candidate.name)")
                }
            }
        }
        .meshAnimation(ChatGlass.snap, value: isSettled)
    }

    private func rings(radius: CGFloat) -> some View {
        ZStack {
            ForEach(1...3, id: \.self) { step in
                Circle()
                    .strokeBorder(MeshTheme.textSecondary.opacity(0.14), lineWidth: 1)
                    .frame(width: radius * 2 * CGFloat(step) / 3, height: radius * 2 * CGFloat(step) / 3)
            }
            if isSweeping && !reduceMotion {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    ZStack {
                        ForEach(0..<3, id: \.self) { wave in
                            let progress = ((t / 2.4) + Double(wave) / 3).truncatingRemainder(dividingBy: 1)
                            Circle()
                                .stroke(MeshTheme.brandPink.opacity(0.45 * (1 - progress)), lineWidth: 2)
                                .frame(width: radius * 2 * progress, height: radius * 2 * progress)
                        }
                    }
                }
            } else if isSettled {
                Circle()
                    .fill(MeshTheme.brandPink.opacity(0.10))
                    .frame(width: radius * 1.3, height: radius * 1.3)
            }
        }
        .frame(width: radius * 2, height: radius * 2)
        .accessibilityHidden(true)
    }

    private func place(_ candidate: Candidate, center: CGPoint, radius: CGFloat) -> CGPoint {
        // -40 dBm sits a third of the way out, -100 dBm at the rim.
        let strength = min(max(Double(candidate.signal + 100) / 60, 0), 1)
        let distance = radius * CGFloat(0.9 - 0.55 * strength)
        let angle = Self.angle(for: candidate.id)
        return CGPoint(x: center.x + distance * CGFloat(cos(angle)), y: center.y + distance * CGFloat(sin(angle)))
    }

    /// A stable direction per radio, so it does not jump between redraws.
    private static func angle(for id: UUID) -> Double {
        var hash: UInt32 = 2_166_136_261
        for byte in id.uuidString.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return Double(hash % 360) * .pi / 180
    }
}
#endif
