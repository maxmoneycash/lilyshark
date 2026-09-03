//
//  AntennaSettingsView.swift
//  PommeCore
//
//  Antenna height and RF frequency settings for LoS analysis.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

struct AntennaSettingsView: View {
    @Environment(LineOfSightStore.self) private var store
    @Environment(DeviceConfig.self) private var deviceConfig

    var body: some View {
        @Bindable var store = store
        Section {
            HStack {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Point A Antenna")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.accent)
                    Stepper(value: $store.antennaHeightA, in: 0.5...100, step: 0.5) {
                        Text(String(format: "%.1f m", store.antennaHeightA))
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }
            }
            .listRowBackground(MeshTheme.surface)

            HStack {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Point B Antenna")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.accent)
                    Stepper(value: $store.antennaHeightB, in: 0.5...100, step: 0.5) {
                        Text(String(format: "%.1f m", store.antennaHeightB))
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }
            }
            .listRowBackground(MeshTheme.surface)

            HStack {
                Image(systemName: "waveform")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Frequency")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.accent)
                    if store.manualFrequencyOverride {
                        TextField("MHz", value: $store.frequencyMHz, format: .number)
                            .foregroundStyle(MeshTheme.textPrimary)
                            #if !os(watchOS)
                            .textFieldStyle(MeshTextFieldStyle())
                            #endif
                    } else {
                        Text(String(format: "%.3f MHz (from radio)", store.frequencyMHz))
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
            }
            .listRowBackground(MeshTheme.surface)

            Toggle("Manual Frequency Override", isOn: $store.manualFrequencyOverride)
                .font(.caption)
                .foregroundStyle(MeshTheme.accent)
                .listRowBackground(MeshTheme.surface)
                .onChange(of: store.manualFrequencyOverride) { _, manual in
                    if !manual {
                        store.loadFromDeviceConfig(deviceConfig)
                    }
                }
        } header: {
            Text("Antenna & RF Settings")
        }
    }
}
