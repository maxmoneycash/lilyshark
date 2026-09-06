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
                Text("Lilyshark decks use Meshtastic to share the nodes they hear and the messages they carry. MeshCore radios also offer radio settings and management tools.")
                    .font(.footnote)
            }

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
                                    Text(saved.lastConnected, style: .relative)
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
                        Label("Connect with Wi-Fi", systemImage: "wifi")
                            .frame(maxWidth: .infinity)
                            .touchable()
                    }
                    .disabled(wifiHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || UInt16(wifiPort).map { $0 == 0 } != false)
                    .buttonStyle(.meshPrimary)
                    .tint(MeshTheme.interactiveGreen)
                    .listRowBackground(MeshTheme.surface)
                }
            } header: {
                Text("WiFi")
                    .foregroundStyle(MeshTheme.textSecondary)
            } footer: {
                Text("Connect to a companion radio with WiFi enabled (TCP, default port 5000).")
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
        #if canImport(MeshtasticKit)
        !connectionManager.discoveredPeripherals.isEmpty || !connectionManager.discoveredMeshtasticDevices.isEmpty
        #else
        !connectionManager.discoveredPeripherals.isEmpty
        #endif
    }

    @ViewBuilder
    private var bluetoothScanStatus: some View {
        if !connectionManager.bleManager.isPoweredOn {
            ContentUnavailableView {
                Label("Bluetooth Unavailable", systemImage: "antenna.radiowaves.left.and.right.slash")
            } description: {
                Text(connectionManager.bleStatusMessage ?? "Waiting for Bluetooth. Turn it on and allow Lilyshark to find nearby radios.")
            }
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
                Label("No Nearby Radios Found", systemImage: "antenna.radiowaves.left.and.right.slash")
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
