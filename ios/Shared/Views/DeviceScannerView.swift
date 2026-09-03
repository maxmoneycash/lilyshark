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
                if connectionManager.discoveredPeripherals.isEmpty {
                    if connectionManager.isScanning {
                        HStack(spacing: 12) {
                            ProgressView()
                                .tint(MeshTheme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Searching for MeshCore devices...")
                                    .foregroundStyle(MeshTheme.scanning)
                                if connectionManager.scanRetryCount < 3 && connectionManager.scanRetryCount > 0 {
                                    Text("Retry \(3 - connectionManager.scanRetryCount) of 3")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                            }
                        }
                        .listRowBackground(MeshTheme.surface)
                    } else {
                        Button {
                            connectionManager.scanRetryCount = 3
                            connectionManager.startScanning()
                            startScanCycle()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "antenna.radiowaves.left.and.right.slash")
                                    .foregroundStyle(MeshTheme.textSecondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("No devices found")
                                        .foregroundStyle(MeshTheme.accent)
                                    Text("Tap to scan again")
                                        .font(.caption)
                                        .foregroundStyle(MeshTheme.accent)
                                }
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(MeshTheme.surface)
                    }
                } else {
                    // Show scanning indicator above the device list
                    if connectionManager.isScanning {
                        HStack(spacing: 8) {
                            ProgressView()
                                .scaleEffect(0.7)
                                .tint(MeshTheme.accent)
                            Text("Scanning...")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.scanning)
                        }
                        .listRowBackground(MeshTheme.surface)
                    }

                    ForEach(connectionManager.discoveredPeripherals) { peripheral in
                        Button {
                            connectionManager.connect(to: peripheral)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(MeshTheme.accent.opacity(0.12))
                                        .frame(width: 40, height: 40)
                                    Image(systemName: "radio")
                                        .foregroundStyle(MeshTheme.accent)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(peripheral.name)
                                        .font(.body)
                                        .foregroundStyle(MeshTheme.accent)
                                    Text("\(peripheral.rssi) dBm")
                                        .font(.caption)
                                        .foregroundStyle(MeshTheme.textSecondary)
                                }
                                Spacer()
                                signalBars(rssi: peripheral.rssi)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(MeshTheme.surface)
                    }
                }
            } header: {
                Text("Nearby Devices")
                    .foregroundStyle(MeshTheme.textSecondary)
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
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(MeshTheme.surface)
                        .swipeActions {
                            Button(role: .destructive) {
                                removeWiFiConnection(saved)
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                    }

                    // Manual entry
                    HStack(spacing: 8) {
                        Image(systemName: "wifi")
                            .foregroundStyle(MeshTheme.accent)
                        TextField("IP Address", text: $wifiHost)
                            .foregroundStyle(MeshTheme.textPrimary)
                            #if !os(watchOS)
                            .textFieldStyle(.roundedBorder)
                            #endif
                        Text(":")
                            .foregroundStyle(MeshTheme.textSecondary)
                        TextField("Port", text: $wifiPort)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .frame(width: 60)
                            #if !os(watchOS)
                            .textFieldStyle(.roundedBorder)
                            #endif
                        Button("Connect") {
                            let port = UInt16(wifiPort) ?? 5000
                            connectionManager.connectWiFi(host: wifiHost, port: port)
                            saveWiFiConnection(host: wifiHost, port: port)
                            dismiss()
                        }
                        .disabled(wifiHost.isEmpty)
                        .buttonStyle(.borderedProminent)
                        .tint(MeshTheme.interactiveGreen)
                    }
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
                                .buttonStyle(.borderedProminent)
                                .tint(MeshTheme.interactiveGreen)
                        }
                        .listRowBackground(MeshTheme.surface)
                    }

                    if connectionManager.usbAvailablePorts.isEmpty {
                        Text("No serial ports detected")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
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
                        .buttonStyle(.borderedProminent)
                        .tint(MeshTheme.interactiveGreen)
                        .disabled(manualSerialPort.isEmpty)
                    }
                    .listRowBackground(MeshTheme.surface)

                    Button {
                        connectionManager.usbManager.scanPorts()
                    } label: {
                        Label("Refresh Ports", systemImage: "arrow.clockwise")
                            .foregroundStyle(MeshTheme.accent)
                    }
                    .buttonStyle(.plain)
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
        .navigationTitle("Scanner")
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

    private func signalBars(rssi: Int) -> some View {
        let strength = signalStrength(rssi: rssi)
        let color = signalColor(strength: strength)
        let qualityLabel = switch strength {
        case 4: "Excellent"
        case 3: "Good"
        case 2: "Fair"
        case 1: "Weak"
        default: "No signal"
        }
        return HStack(spacing: 3) {
            HStack(spacing: 2) {
                ForEach(0..<4) { bar in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(bar < strength ? color : MeshTheme.surfaceLight)
                        .frame(width: 4, height: CGFloat(6 + bar * 4))
                }
            }
            .accessibilityHidden(true)
            Text("\(rssi) dBm")
                .font(.caption2)
                .foregroundStyle(color)
                .frame(width: 52, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Signal: \(qualityLabel), \(rssi) dBm")
    }

    private func signalStrength(rssi: Int) -> Int {
        switch rssi {
        case -65...0:        return 4  // excellent
        case -80...(-66):    return 3  // good
        case -90...(-81):    return 2  // fair
        case -100...(-91):   return 1  // weak
        default:             return 0  // no signal
        }
    }

    private func signalColor(strength: Int) -> Color {
        switch strength {
        case 4, 3:  return MeshTheme.connected
        case 2:     return .orange
        case 1:     return .red
        default:    return MeshTheme.textSecondary
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
