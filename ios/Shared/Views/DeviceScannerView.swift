//
//  DeviceScannerView.swift
//  PommeCore
//
//  BLE/WiFi/USB device scanner with signal strength and saved connections.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif

struct DeviceScannerView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss

    /// Tracks the scan cycle timer while the view is visible.
    @State private var scanCycleTask: Task<Void, Never>?
    @State private var wifiHost = ""
    @State private var wifiPort = "5000"
    @AppStorage("savedWiFiConnections") private var savedWiFiData: Data = Data()
    #if targetEnvironment(simulator)
    @State private var pairingDeck: ConnectionManager.SimulatorNearbyDeck?
    #endif
    #if os(macOS) || targetEnvironment(macCatalyst)
    @State private var manualSerialPort = ""
    #endif

    var body: some View {
        List {
            Section {
                bluetoothScanStatus
                    .transition(.opacity)
                    .listRowBackground(MeshTheme.surface)
            } header: {
                Text("Bluetooth")
            } footer: {
                #if targetEnvironment(simulator)
                Text("Tap the T-Deck, then enter the PIN on its screen.")
                    .font(.footnote)
                #else
                Text("Lilyshark decks use Meshtastic to share the nodes they hear and the messages they carry. MeshCore radios also offer radio settings and management tools.")
                    .font(.footnote)
                #endif
            }

            #if targetEnvironment(simulator)
            if !connectionManager.simulatorNearbyDecks.isEmpty {
                Section("Lilyshark Decks · Meshtastic") {
                    ForEach(connectionManager.simulatorNearbyDecks) { deck in
                        Button {
                            pairingDeck = deck
                        } label: {
                            discoveredRadioRow(name: deck.name, protocolName: "Meshtastic", rssi: deck.rssi)
                        }
                        .buttonStyle(.meshPlain)
                        .accessibilityHint("Shows the Bluetooth pairing flow a phone uses with this deck")
                        .listRowBackground(MeshTheme.surface)
                    }
                }
            }
            #endif

            #if canImport(MeshtasticKit)
            // Each result stays with the central that discovered it.
            if !connectionManager.discoveredMeshtasticDevices.isEmpty {
                Section("Lilyshark Decks · Meshtastic") {
                    ForEach(connectionManager.discoveredMeshtasticDevices) { device in
                        Button {
                            connectionManager.connectMeshtastic(to: device)
                            dismiss()
                        } label: {
                            discoveredRadioRow(name: device.name, protocolName: "Meshtastic", rssi: device.rssi)
                        }
                        .buttonStyle(.meshPlain)
                        .accessibilityHint("Connect to this Meshtastic deck")
                        .listRowBackground(MeshTheme.surface)
                    }
                }
            }
            #endif

            if !connectionManager.discoveredPeripherals.isEmpty {
                Section("MeshCore Radios") {
                    ForEach(connectionManager.discoveredPeripherals) { peripheral in
                        Button {
                            connectionManager.connect(to: peripheral)
                            dismiss()
                        } label: {
                            discoveredRadioRow(name: peripheral.name, protocolName: "MeshCore", rssi: peripheral.rssi)
                        }
                        .buttonStyle(.meshPlain)
                        .accessibilityHint("Connect to this MeshCore radio")
                        .listRowBackground(MeshTheme.surface)
                    }
                }
            }

            Section {
                if connectionManager.wifiManager.isConnected {
                    HStack {
                        Image(systemName: "wifi")
                            .foregroundStyle(MeshTheme.connected)
                        Text(connectionManager.wifiManager.connectedHost ?? "Connected")
                            .foregroundStyle(MeshTheme.connected)
                        Spacer()
                        Button("Disconnect") {
                            connectionManager.disconnectWiFi()
                        }
                        .foregroundStyle(MeshTheme.disconnected)
                    }
                    .listRowBackground(MeshTheme.surface)
                } else {
                    // Saved connections
                    ForEach(savedWiFiConnections) { saved in
                        Button {
                            connectionManager.connectWiFi(host: saved.host, port: saved.port)
                            saveWiFiConnection(host: saved.host, port: saved.port)
                            dismiss()
                        } label: {
                            HStack {
                                Image(systemName: "wifi")
                                    .foregroundStyle(MeshTheme.accent)
                                VStack(alignment: .leading) {
                                    Text("WiFi Radio")
                                        .foregroundStyle(MeshTheme.accent)
                                    Text("\(saved.host):\(saved.port)")
                                        .font(.caption)
                                        .foregroundStyle(MeshTheme.textSecondary)
                                    Text("Last tried \(saved.lastConnected, style: .relative) ago")
                                        .font(.caption2)
                                        .foregroundStyle(MeshTheme.textSecondary)
                                }
                                Spacer()
                            }
                            .touchable()
                        }
                        .buttonStyle(.meshPlain)
                        .listRowBackground(MeshTheme.surface)
                        .swipeActions {
                            Button(role: .destructive) {
                                removeWiFiConnection(saved)
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                    }

                    TextField("Host or IP address", text: $wifiHost)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .accessibilityLabel("Wi-Fi host or IP address")
                        .listRowBackground(MeshTheme.surface)
                    LabeledContent("Port") {
                        TextField("5000", text: $wifiPort)
                            .multilineTextAlignment(.trailing)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .accessibilityLabel("Wi-Fi port")
                    }
                    .listRowBackground(MeshTheme.surface)
                    Button {
                        guard let port = UInt16(wifiPort), port > 0 else { return }
                        let host = wifiHost.trimmingCharacters(in: .whitespacesAndNewlines)
                        connectionManager.connectWiFi(host: host, port: port)
                        saveWiFiConnection(host: host, port: port)
                        dismiss()
                    } label: {
                        Label("Connect", systemImage: "wifi")
                            .frame(maxWidth: .infinity)
                            .touchable()
                    }
                    .disabled(wifiHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || UInt16(wifiPort).map { $0 == 0 } != false)
                    .accessibilityLabel("Connect with Wi-Fi")
                    .buttonStyle(.meshPrimary)
                    .tint(MeshTheme.interactiveGreen)
                    .listRowBackground(MeshTheme.surface)
                }
            } header: {
                Text("WiFi")
                    .foregroundStyle(MeshTheme.textSecondary)
            } footer: {
                Text("Connect to a MeshCore companion radio with Wi-Fi enabled on the same network (TCP, default port 5000).")
                    .font(.caption2)
            }

            #if os(macOS) || targetEnvironment(macCatalyst)
            // USB Serial section
            Section {
                if connectionManager.usbManager.isConnected {
                    HStack {
                        Image(systemName: "cable.connector")
                            .foregroundStyle(MeshTheme.connected)
                        Text(connectionManager.usbManager.connectedPort?.replacingOccurrences(of: "/dev/cu.", with: "") ?? "Connected")
                            .foregroundStyle(MeshTheme.connected)
                        Spacer()
                        Button("Disconnect") { connectionManager.disconnectUSB() }
                            .foregroundStyle(MeshTheme.disconnected)
                    }
                    .listRowBackground(MeshTheme.surface)
                } else {
                    ForEach(connectionManager.usbAvailablePorts, id: \.self) { port in
                        HStack {
                            Image(systemName: "cable.connector")
                                .foregroundStyle(MeshTheme.accent)
                            Text(port.replacingOccurrences(of: "/dev/cu.", with: ""))
                                .foregroundStyle(MeshTheme.accent)
                            Spacer()
                            Button("Connect") { connectionManager.connectUSB(port: port); dismiss() }
                                .buttonStyle(.meshPrimary)
                                .tint(MeshTheme.interactiveGreen)
                        }
                        .listRowBackground(MeshTheme.surface)
                    }

                    if connectionManager.usbAvailablePorts.isEmpty {
                        ContentUnavailableView {
                            Label("No Serial Ports Detected", systemImage: "cable.connector")
                        } description: {
                            Text("Connect your radio with a USB data cable, then refresh the ports. You can also enter a known port below.")
                        }
                            .listRowBackground(MeshTheme.surface)
                    }

                    // Manual port entry
                    HStack(spacing: 8) {
                        Image(systemName: "terminal")
                            .foregroundStyle(MeshTheme.accent)
                        TextField("/dev/cu.usbmodem...", text: $manualSerialPort)
                            .font(.system(.body, design: .monospaced))
                            .textFieldStyle(.roundedBorder)
                        Button("Connect") {
                            guard !manualSerialPort.isEmpty else { return }
                            connectionManager.connectUSB(port: manualSerialPort)
                            dismiss()
                        }
                        .buttonStyle(.meshPrimary)
                        .tint(MeshTheme.interactiveGreen)
                        .disabled(manualSerialPort.isEmpty)
                    }
                    .listRowBackground(MeshTheme.surface)

                    Button {
                        connectionManager.usbManager.scanPorts()
                    } label: {
                        Label("Refresh Ports", systemImage: "arrow.clockwise")
                            .foregroundStyle(MeshTheme.accent)
                            .touchable()
                    }
                    .buttonStyle(.meshPlain)
                    .listRowBackground(MeshTheme.surface)
                }
            } header: {
                Text("USB Serial")
                    .foregroundStyle(MeshTheme.textSecondary)
            } footer: {
                Text("Connect via USB. If not listed, run 'ls /dev/cu.*' in Terminal and enter the path manually.")
                    .font(.caption2)
            }
            .onAppear {
                connectionManager.usbManager.scanPorts()
            }
            #endif

            Section {
                NavigationLink {
                    HelpView()
                } label: {
                    Label("Connection Help", systemImage: "questionmark.circle")
                        .touchable()
                }
                .listRowBackground(MeshTheme.surface)
            }
        }
        .meshListStyle()
        .meshAnimation(Design.Motion.quick, value: hasBluetoothResults)
        .meshAnimation(Design.Motion.quick, value: connectionManager.isScanning)
        .navigationTitle("Connect a Radio")
        // Inline: a large title scrolls under the translucent bar and the
        // Done button rides on top of it, so the heading slid through the
        // button as the list moved.
        //
        // Not lilysharkSheet, because this view supplies no Done of its own:
        // the iOS presentation (PommeCoreApp 426) now carries the modifier,
        // and the watchOS one (PommeCoreApp 246) deliberately has no Done at
        // all. The guard matches the API -- navigationBarTitleDisplayMode is
        // @available(macOS, unavailable) and this file is in the macOS
        // target's sources, which nothing builds, so the compiler was never
        // going to say so.
        #if !os(macOS) && !os(tvOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            // Don't start BLE scanning if already connecting/connected via any transport
            guard connectionManager.connectionState == .disconnected else { return }
            connectionManager.startScanning()
            startScanCycle()
        }
        .onDisappear {
            scanCycleTask?.cancel()
            scanCycleTask = nil
            connectionManager.stopScanning()
        }
        #if targetEnvironment(simulator)
        .sheet(item: $pairingDeck) { deck in
            SimulatorBluetoothPairingView(deck: deck) {
                connectionManager.completeSimulatorDeckPreview(named: deck.name)
            }
            .meshTheme()
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(MeshTheme.background)
        }
        .onChange(of: connectionManager.connectionState) { _, state in
            if state == .ready || state == .connected {
                pairingDeck = nil
                dismiss()
            }
        }
        .meshAnimation(Design.Motion.quick, value: connectionManager.simulatorNearbyDecks.count)
        #endif
    }

    /// Runs a 15-second scan cycle. When the timer fires, tells the ConnectionManager
    /// to either retry (if no devices found) or keep scanning (if devices are visible).
    private func startScanCycle() {
        scanCycleTask?.cancel()
        scanCycleTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000) // 15s
                guard !Task.isCancelled else { break }
                await MainActor.run {
                    connectionManager.handleScanTimeout()
                }
            }
        }
    }

    private var hasBluetoothResults: Bool {
        #if targetEnvironment(simulator)
        if !connectionManager.simulatorNearbyDecks.isEmpty { return true }
        #endif
        #if canImport(MeshtasticKit)
        return !connectionManager.discoveredPeripherals.isEmpty || !connectionManager.discoveredMeshtasticDevices.isEmpty
        #else
        return !connectionManager.discoveredPeripherals.isEmpty
        #endif
    }

    @ViewBuilder
    private var bluetoothScanStatus: some View {
        if !connectionManager.bleManager.isPoweredOn {
            #if targetEnvironment(simulator)
            simulatorBluetoothStatus
            #else
            ContentUnavailableView {
                Label {
                    Text("Bluetooth unavailable")
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash")
                }
            } description: {
                Text(connectionManager.bleStatusMessage ?? "Waiting for Bluetooth. Turn it on and allow Lilyshark to find nearby radios.")
            }
            #endif
        } else if connectionManager.isScanning {
            HStack(alignment: .center, spacing: Design.Space.snug) {
                ProgressView()
                    .tint(MeshTheme.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Design.Space.hairline) {
                    Text(hasBluetoothResults ? "Looking for more radios" : "Looking for nearby radios")
                        .font(.headline)
                    Text("Waiting for a Bluetooth signal from a Lilyshark deck or MeshCore radio. Keep your radio powered on and nearby.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            .accessibilityElement(children: .combine)
        } else if !hasBluetoothResults {
            ContentUnavailableView {
                Label {
                    Text("No radios found")
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash")
                }
            } description: {
                Text("Keep your radio powered on and nearby, with Bluetooth enabled, then scan again. This scan only looks for Bluetooth devices.")
            } actions: {
                Button {
                    connectionManager.scanRetryCount = 3
                    connectionManager.startScanning()
                    startScanCycle()
                } label: {
                    Label("Scan Again", systemImage: "arrow.clockwise")
                        .touchable()
                }
                .buttonStyle(.meshPrimary)
                .tint(MeshTheme.interactiveGreen)
            }
        } else {
            Label("Choose a radio to connect", systemImage: "radio")
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }

    #if targetEnvironment(simulator)
    @ViewBuilder
    private var simulatorBluetoothStatus: some View {
        if connectionManager.isScanning && !hasBluetoothResults {
            HStack(alignment: .center, spacing: Design.Space.snug) {
                ProgressView()
                    .tint(MeshTheme.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Design.Space.hairline) {
                    Text("Looking for nearby radios")
                        .font(.headline)
                    Text("Keep the deck powered on and close.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            .accessibilityElement(children: .combine)
        } else if hasBluetoothResults {
            Label("Choose a radio", systemImage: "radio")
                .foregroundStyle(MeshTheme.textSecondary)
        } else {
            ContentUnavailableView {
                Label("No radios found", systemImage: "antenna.radiowaves.left.and.right.slash")
            } description: {
                Text("Keep the T-Deck powered on, then scan again.")
            } actions: {
                Button {
                    connectionManager.startScanning()
                    startScanCycle()
                } label: {
                    Label("Scan Again", systemImage: "arrow.clockwise")
                        .touchable()
                }
                .buttonStyle(.meshPrimary)
            }
        }
    }
    #endif

    private func discoveredRadioRow(name: String, protocolName: String, rssi: Int) -> some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Label(name, systemImage: "radio")
                .font(.headline)
                .foregroundStyle(MeshTheme.textPrimary)
            HStack(alignment: .firstTextBaseline, spacing: Design.Space.snug) {
                Text(protocolName)
                    .foregroundStyle(MeshTheme.textSecondary)
                Spacer(minLength: Design.Space.tight)
                signalBars(rssi: rssi)
            }
            .font(.subheadline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .touchable()
        .accessibilityElement(children: .combine)
    }

    private func signalBars(rssi: Int) -> some View {
        // CoreBluetooth's unavailable sentinel is separate from a reading.
        let isReported = rssi != 127
        let strength = signalStrength(rssi: rssi)
        let quality: String = switch strength {
        case 4: "Strong"
        case 3: "Good"
        case 2: "Fair"
        default: "Weak"
        }
        return HStack(spacing: Design.Space.hairline) {
            Image(systemName: isReported ? "cellularbars" : "questionmark.circle", variableValue: isReported ? Double(strength) / 4 : nil)
                .accessibilityHidden(true)
            Text(isReported ? "\(rssi) dBm" : "Not reported")
                .monospacedDigit()
        }
        .foregroundStyle(isReported ? signalColor(strength: strength) : MeshTheme.textSecondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isReported ? "Bluetooth signal: \(quality), \(rssi) dBm" : "Bluetooth signal not reported")
    }

    private func signalStrength(rssi: Int) -> Int {
        switch rssi {
        case (-65)...: return 4
        case -80 ... -66: return 3
        case -90 ... -81: return 2
        default: return 1
        }
    }

    private func signalColor(strength: Int) -> Color {
        switch strength {
        case 4, 3: MeshTheme.connected
        case 2: .orange
        default: MeshTheme.textSecondary
        }
    }

    // MARK: - Saved WiFi Connections

    private var savedWiFiConnections: [SavedWiFiConnection] {
        (try? JSONDecoder().decode([SavedWiFiConnection].self, from: savedWiFiData)) ?? []
    }

    private func saveWiFiConnection(host: String, port: UInt16) {
        var connections = savedWiFiConnections.filter { $0.host != host || $0.port != port }
        connections.insert(SavedWiFiConnection(id: UUID(), host: host, port: port, lastConnected: Date()), at: 0)
        if connections.count > 5 { connections = Array(connections.prefix(5)) }
        if let data = try? JSONEncoder().encode(connections) {
            savedWiFiData = data
        }
    }

    private func removeWiFiConnection(_ connection: SavedWiFiConnection) {
        var connections = savedWiFiConnections
        connections.removeAll { $0.id == connection.id }
        if let data = try? JSONEncoder().encode(connections) {
            savedWiFiData = data
        }
    }
}

struct SavedWiFiConnection: Codable, Identifiable {
    let id: UUID
    let host: String
    let port: UInt16
    let lastConnected: Date
}

#if targetEnvironment(simulator)
/// The iOS Bluetooth pairing sheet a phone shows when a T-Deck asks to pair.
private struct SimulatorBluetoothPairingView: View {
    let deck: ConnectionManager.SimulatorNearbyDeck
    var onPair: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var enteredPIN = ""
    @State private var pinError = false
    @State private var pairing = false
    @State private var shake = 0
    @FocusState private var pinFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Design.Space.loose) {
                    TDeckSceneView(
                        screenFileName: "pairing",
                        interactive: false,
                        pageOnVerticalDrag: false
                    )
                    .frame(height: 232)
                    .frame(maxWidth: .infinity)
                    .allowsHitTesting(false)
                    .accessibilityElement()
                    .accessibilityLabel("Deck showing pairing PIN \(deck.passkey)")

                    Text("“\(deck.name)” wants to pair with your iPhone. Enter the code on its screen.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, Design.Space.loose)
                .padding(.top, Design.Space.regular)
                .padding(.bottom, Design.Space.snug)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .background(MeshTheme.background)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                pinEntry
            }
            .navigationTitle("Bluetooth Pairing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(pairing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if pairing {
                        ProgressView()
                            .accessibilityLabel("Pairing")
                    } else {
                        Button("Pair") { pair() }
                            .fontWeight(.semibold)
                            .disabled(enteredPIN.count != 6)
                    }
                }
            }
            .interactiveDismissDisabled(pairing)
            .task {
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 250 : 700))
                pinFocused = true
            }
            .sensoryFeedback(.error, trigger: pinError) { _, error in error }
            .sensoryFeedback(.success, trigger: pairing) { _, isPairing in isPairing }
            .sensoryFeedback(.selection, trigger: enteredPIN.count)
        }
    }

    private var pinEntry: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text("Pairing code")
                .font(Design.Text.label)
                .foregroundStyle(MeshTheme.textSecondary)
            pinSlots
                .offset(x: reduceMotion ? 0 : shakeOffset)
                .meshAnimation(Design.Motion.quick, value: shake)
            if pinError {
                Text("That code does not match the PIN on the deck.")
                    .font(Design.Text.detail)
                    .foregroundStyle(MeshTheme.disconnected)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, Design.Space.loose)
        .padding(.top, Design.Space.snug)
        .padding(.bottom, Design.Space.tight)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private var shakeOffset: CGFloat {
        guard pinError, shake > 0 else { return 0 }
        return shake.isMultiple(of: 2) ? 8 : -8
    }

    private var pinSlots: some View {
        let digits = Array(enteredPIN)
        return HStack(spacing: Design.Space.tight) {
            ForEach(0..<6, id: \.self) { index in
                let filled = index < digits.count
                let active = pinFocused && index == digits.count && !pairing
                Text(filled ? String(digits[index]) : " ")
                    .font(.title3.monospacedDigit().weight(.semibold))
                    .foregroundStyle(MeshTheme.textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: Design.minimumTouchTarget)
                    .background(
                        MeshTheme.surface,
                        in: RoundedRectangle(cornerRadius: Design.Radius.control, style: .continuous)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: Design.Radius.control, style: .continuous)
                            .strokeBorder(
                                pinError
                                    ? MeshTheme.disconnected
                                    : (active ? MeshTheme.accent : Color.clear),
                                lineWidth: active || pinError ? 2 : 1
                            )
                    }
                    .contentTransition(.numericText())
                    .accessibilityHidden(true)
            }
        }
        .meshAnimation(Design.Motion.quick, value: enteredPIN)
        .meshAnimation(Design.Motion.quick, value: pinError)
        .overlay {
            TextField("", text: $enteredPIN)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .submitLabel(.go)
                .focused($pinFocused)
                .opacity(0.02)
                .accessibilityLabel("6-digit pairing code")
                .accessibilityValue(enteredPIN.isEmpty ? "None entered" : enteredPIN)
                .onChange(of: enteredPIN) { oldValue, value in
                    let clipped = String(value.filter(\.isNumber).prefix(6))
                    if clipped != value {
                        enteredPIN = clipped
                        return
                    }
                    if pinError, clipped != oldValue {
                        pinError = false
                    }
                    if clipped.count == 6, oldValue.count < 6 {
                        pair()
                    }
                }
                .onSubmit { pair() }
        }
        .contentShape(Rectangle())
        .onTapGesture { pinFocused = true }
    }

    private func pair() {
        guard !pairing else { return }
        guard enteredPIN.count == 6 else { return }
        guard enteredPIN == deck.passkey else {
            pinError = true
            enteredPIN = ""
            shake += 1
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(45))
                shake += 1
                try? await Task.sleep(for: .milliseconds(45))
                shake += 1
                try? await Task.sleep(for: .milliseconds(45))
                shake += 1
            }
            return
        }
        pairing = true
        onPair()
    }
}
#endif
