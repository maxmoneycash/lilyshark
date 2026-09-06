//
//  FrequencyScannerView.swift
//  PommeCore
//
//  Scans regional LoRa presets to detect mesh network activity.
//  Temporarily tunes the radio to each preset and listens for packets.
//
//  Created by Michael P. Bedworth on 04/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct FrequencyScannerView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ContactStore.self) private var contactStore
    @Environment(DeviceConfig.self) private var deviceConfig

    @State private var results: [ScanResult] = []
    @State private var scanTask: Task<Void, Never>?
    @State private var progress: Double = 0
    @State private var isScanning = false
    @State private var presetToApply: ScanResult?

    private var canScan: Bool {
        connectionManager.connectionState == .ready && !connectionManager.isMeshtasticLinkActive
            && deviceConfig.loadedSections.contains("selfInfo") && !deviceConfig.publicKeyHex.isEmpty
    }

    private var sortedResults: [ScanResult] {
        results.sorted {
            if $0.status == .detected && $1.status != .detected { return true }
            if $1.status == .detected && $0.status != .detected { return false }
            return false
        }
    }

    var body: some View {
        Form {
            if isScanning || !results.isEmpty {
                Section {
                    ProgressView(value: progress)
                        .tint(MeshTheme.accent)
                        .listRowBackground(MeshTheme.surface)
                }
            }

            Section {
                if results.isEmpty && !isScanning {
                    ContentUnavailableView(
                        "No scan observations",
                        systemImage: "antenna.radiowaves.left.and.right",
                        description: Text(canScan
                            ? "Scan requests each preset and watches for contact updates. Radio tuning is not confirmed, so results cannot prove a frequency is active or quiet."
                            : "Connect a MeshCore radio and wait for its current radio settings before scanning.")
                    )
                        .listRowBackground(MeshTheme.surface)
                } else {
                    ForEach(sortedResults) { result in
                        resultRow(result)
                    }
                }
            } header: {
                Text("Scan Results")
            } footer: {
                Text("Scanning requests temporary radio changes and may interrupt messages. Each preset is observed for 5 seconds. Counts are contact updates, not packet counts; tuning and restoration are not confirmed by this view.")
            }
        }
        .formStyle(.grouped)
        .meshTheme()
        .navigationTitle("Frequency Scanner")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if isScanning {
                    Button("Cancel", role: .cancel) { cancelScan() }
                } else {
                    Button("Scan") { startScan() }
                        .disabled(!canScan)
                }
            }
        }
        .alert("Apply Preset", isPresented: Binding(
            get: { presetToApply != nil },
            set: { if !$0 { presetToApply = nil } }
        )) {
            Button("Apply", role: .destructive) {
                if let r = presetToApply { applyPreset(r.preset) }
                presetToApply = nil
            }
            Button("Cancel", role: .cancel) { presetToApply = nil }
        } message: {
            if let r = presetToApply {
                Text("Switch your radio to \(r.preset.name)? This changes your frequency, SF, and bandwidth.")
            }
        }
        .onDisappear {
            cancelScan()
        }
    }

    // MARK: - Row

    private func resultRow(_ result: ScanResult) -> some View {
        let freq = String(format: "%.3f MHz", result.preset.frequencyKHz / 1000.0)
        let bwStr = result.preset.bandwidth >= 1
            ? "\(Int(result.preset.bandwidth))kHz"
            : "\(result.preset.bandwidth)kHz"
        return Button {
            presetToApply = result
        } label: {
          HStack(spacing: 12) {
            statusIcon(result.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(result.preset.name)
                    .font(.body)
                    .foregroundStyle(result.status == .detected ? MeshTheme.accent : MeshTheme.textPrimary)
                Text("\(freq) · SF\(result.preset.spreadingFactor) · \(bwStr)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                if result.status == .clear {
                    Text("No contact updates observed")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                } else if result.status == .interrupted {
                    Text("Observation interrupted")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                } else if result.status == .pending {
                    Text("Not scanned")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            Spacer()
            if result.packetsReceived > 0 {
                Text("\(result.packetsReceived) updates")
                    .font(.caption2)
                    .foregroundStyle(.green)
            }
          }
          .touchable()
        }
        .buttonStyle(.meshPlain)
        .disabled(result.status != .detected || isScanning || !canScan)
        .listRowBackground(result.status == .detected ? MeshTheme.accent.opacity(0.1) : MeshTheme.surface)
        .accessibilityElement(children: .combine)
        .accessibilityValue(result.status == .clear ? "No contact updates observed; radio tuning unconfirmed" : "Radio tuning unconfirmed")
    }

    @ViewBuilder
    private func statusIcon(_ status: ScanStatus) -> some View {
        switch status {
        case .pending:
            Image(systemName: "clock")
                .foregroundStyle(MeshTheme.textSecondary)
                .frame(width: 24)
        case .scanning:
            ProgressView()
                .controlSize(.small)
                .frame(width: 24)
        case .detected:
            Image(systemName: "antenna.radiowaves.left.and.right")
                .foregroundStyle(.green)
                .frame(width: 24)
        case .clear:
            Image(systemName: "xmark")
                .foregroundStyle(MeshTheme.textSecondary)
                .frame(width: 24)
        case .interrupted:
            Image(systemName: "pause.circle")
                .foregroundStyle(MeshTheme.textSecondary)
                .frame(width: 24)
        }
    }

    // MARK: - Scan Logic

    private func startScan() {
        guard canScan, !isScanning else { return }
        let originalRadioKey = deviceConfig.publicKeyHex
        let origFreq = deviceConfig.radioFrequency
        let origBW = deviceConfig.radioBandwidth
        let origSF = deviceConfig.radioSpreadingFactor
        let origCR = deviceConfig.radioCodingRate
        let origRepeat = deviceConfig.repeatMode

        let presets = radioPresets
        results = presets.map { ScanResult(preset: $0, status: .pending, packetsReceived: 0) }
        progress = 0
        isScanning = true

        scanTask = Task {
            for i in presets.indices {
                guard !Task.isCancelled, canScan, deviceConfig.publicKeyHex == originalRadioKey else { break }

                let preset = presets[i]
                results[i].status = .scanning

                connectionManager.setRadioParams(
                    frequency: UInt32(preset.frequencyKHz),
                    bandwidth: UInt32(preset.bandwidth * 1000),
                    spreadingFactor: preset.spreadingFactor,
                    codingRate: preset.codingRate,
                    repeatMode: origRepeat
                )

                // Snapshot contact state before dwell
                let snapAdverts = Dictionary(uniqueKeysWithValues:
                    contactStore.contacts.map { ($0.publicKeyPrefix, $0.lastAdvert) }
                )

                try? await Task.sleep(for: .seconds(5))

                guard !Task.isCancelled, canScan, deviceConfig.publicKeyHex == originalRadioKey else { break }

                // A new contact is one update, even if its advert also changed.
                // Contact updates are not a packet counter or proof of tuning.
                let updates = contactStore.contacts.filter { c in
                    snapAdverts[c.publicKeyPrefix] != c.lastAdvert
                }.count

                results[i].packetsReceived = updates
                results[i].status = updates > 0 ? .detected : .clear
                progress = Double(i + 1) / Double(presets.count)
            }

            // Restore original config
            if canScan, deviceConfig.publicKeyHex == originalRadioKey {
                connectionManager.setRadioParams(
                    frequency: origFreq,
                    bandwidth: origBW,
                    spreadingFactor: origSF,
                    codingRate: origCR,
                    repeatMode: origRepeat
                )
            }
            for index in results.indices where results[index].status == .scanning {
                results[index].status = .interrupted
            }
            isScanning = false
            scanTask = nil
        }
    }

    private func cancelScan() {
        guard isScanning else { return }
        scanTask?.cancel()
        // Keep Scan disabled until the task has requested restoration. Otherwise
        // a new scan can race the previous scan's cleanup.
    }

    private func applyPreset(_ preset: RadioPreset) {
        guard canScan, !isScanning else { return }
        connectionManager.setRadioParams(
            frequency: UInt32(preset.frequencyKHz),
            bandwidth: UInt32(preset.bandwidth * 1000),
            spreadingFactor: preset.spreadingFactor,
            codingRate: preset.codingRate,
            repeatMode: deviceConfig.repeatMode
        )
    }
}

// MARK: - Models

private struct ScanResult: Identifiable {
    let id = UUID()
    let preset: RadioPreset
    var status: ScanStatus
    var packetsReceived: Int
}

private enum ScanStatus { case pending, scanning, detected, clear, interrupted }
#endif
