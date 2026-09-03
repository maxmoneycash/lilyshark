//
//  DistressBeaconView.swift
//  PommeCore
//
//  Emergency SOS beacon — sends flood advert + public channel message with location.
//
//  Created by Michael P. Bedworth on 4/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit
#if !os(watchOS)
import CoreLocation
#endif

struct DistressBeaconView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(\.dismiss) private var dismiss

    @State private var sent = false
    @State private var cooldownRemaining = 0
    @State private var cooldownTask: Task<Void, Never>? = nil

    private var locationText: String {
        #if !os(watchOS)
        if let loc = SharedLocation.manager.location {
            return String(format: "%.5f, %.5f", loc.coordinate.latitude, loc.coordinate.longitude)
        }
        #endif
        return ""
    }

    private var messagePreview: String {
        let name = deviceConfig.deviceName.isEmpty ? "Unknown" : deviceConfig.deviceName
        var text = "\u{1F198} DISTRESS from \(name)"
        if !locationText.isEmpty { text += " at \(locationText)" }
        return text
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                // Warning icon
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.red)

                Text("Emergency Beacon")
                    .font(.title.bold())
                    .foregroundStyle(MeshTheme.textPrimary)

                Text("Sends a flood advert and SOS message to the public channel. Use only in a genuine emergency.")
                    .font(.body)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                // Message preview
                VStack(alignment: .leading, spacing: 6) {
                    Text("Message that will be sent:")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text(messagePreview)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(MeshTheme.textPrimary)
                        .padding(12)
                        .background(MeshTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .padding(.horizontal, 24)

                Spacer()

                // SOS button
                if sent {
                    VStack(spacing: 8) {
                        Label("SOS Sent", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .foregroundStyle(.green)
                        if cooldownRemaining > 0 {
                            Text("Resend available in \(cooldownRemaining)s")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                    .padding(.bottom, 40)
                } else {
                    Button {
                        sendDistressBeacon()
                    } label: {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                            Text("Send SOS")
                                .font(.headline)
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .background(.red)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 40)
                }
            }
            .background(MeshTheme.background)
            .navigationTitle("Emergency Beacon")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .meshTheme()
    }

    private func sendDistressBeacon() {
        // Flood advert — broadcasts our presence to all nearby nodes
        connectionManager.sendAdvertise(type: 1)

        // Public channel (#0) message
        messageStoreManager.sendChannelMessage(messagePreview, channelIndex: 0)

        sent = true
        startCooldown()
    }

    private func startCooldown() {
        cooldownRemaining = 60
        cooldownTask?.cancel()
        cooldownTask = Task { @MainActor in
            while cooldownRemaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { return }
                cooldownRemaining -= 1
            }
            sent = false
        }
    }
}
