//
//  FirmwareUpdateView.swift
//  PommeCore
//
//  Step-by-step guided UI for ESP32 WiFi OTA firmware updates.
//
//  Created by Michael P. Bedworth on 04/19/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

#if !os(watchOS)
struct FirmwareUpdateView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(\.dismiss) private var dismiss
    let latestVersion: String
    var firmwareType: FirmwareOTAService.FirmwareType = .companion
    var manufacturerHint: String = ""

    @State private var otaService = FirmwareOTAService()

    var body: some View {
        NavigationStack {
            ZStack {
                MeshTheme.background.ignoresSafeArea()
                stepContent
                    .padding()
            }
            .navigationTitle("Firmware Update")
            #if os(macOS) || targetEnvironment(macCatalyst)
            .navigationSubtitle(latestVersion.isEmpty ? "" : "v\(latestVersion)")
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .meshTheme()
        #if os(macOS) || targetEnvironment(macCatalyst)
        .frame(minWidth: 480, minHeight: 400)
        #endif
        .task {
            let mfr = manufacturerHint.isEmpty ? deviceConfig.manufacturer : manufacturerHint
            await otaService.start(manufacturer: mfr, firmwareType: firmwareType)
        }
        .interactiveDismissDisabled(isActiveStep)
    }

    // Prevent accidental dismissal during download/upload
    private var isActiveStep: Bool {
        switch otaService.step {
        case .downloading, .uploading: return true
        default: return false
        }
    }

    // MARK: - Step Router

    @ViewBuilder
    private var stepContent: some View {
        switch otaService.step {
        case .ready, .fetchingAssets:
            loadingView("Loading firmware list...")

        case .selectingFirmware(let assets, let suggested):
            selectionView(assets: assets, suggested: suggested)

        case .downloading(let progress, let asset):
            downloadingView(progress: progress, asset: asset)

        case .activateOTA(let data, let asset):
            activateView(firmwareData: data, asset: asset)

        case .detectingRadio(_, _):
            detectingView

        case .uploading(let progress, let asset):
            uploadingView(progress: progress, asset: asset)

        case .dfuHandoff(let data, let asset):
            dfuHandoffView(zipData: data, asset: asset)

        case .done(let asset):
            doneView(asset: asset)

        case .failed(let message, let canRetry):
            failedView(message: message, canRetry: canRetry)
        }
    }

    // MARK: - Loading

    private func loadingView(_ message: LocalizedStringKey) -> some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
                .tint(MeshTheme.accent)
            Text(message)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Selection

    private func selectionView(assets: [OTAAsset], suggested: OTAAsset?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            stepHeader(
                icon: "cpu",
                title: firmwareType == .companion ? "Select Your Hardware" : "Select Firmware Build",
                subtitle: firmwareType == .companion
                    ? "Choose the firmware binary that matches your radio board."
                    : "Choose the \(firmwareType.displayName) firmware build for your hardware."
            )

            if let match = suggested {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Detected")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                    assetRow(match, badge: "Suggested") {
                        Task { await otaService.selectAsset(match) }
                    }
                }
                .padding(.bottom, 16)

                Text("All boards")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(MeshTheme.textSecondary)
                    .padding(.bottom, 4)
            }

            ScrollView {
                VStack(spacing: 8) {
                    ForEach(assets) { asset in
                        assetRow(asset, badge: nil) {
                            Task { await otaService.selectAsset(asset) }
                        }
                    }
                }
            }
        }
    }

    private func assetRow(_ asset: OTAAsset, badge: LocalizedStringKey?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "memorychip")
                    .font(.title3)
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 36)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(asset.displayName)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(MeshTheme.textPrimary)
                        if let badge {
                            Text(badge)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(MeshTheme.accent.opacity(0.15))
                                .foregroundStyle(MeshTheme.accent)
                                .clipShape(Capsule())
                        }
                    }
                    HStack(spacing: 8) {
                        if let version = asset.version {
                            Text(version)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(MeshTheme.accent)
                        }
                        Text(asset.sizeFormatted)
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }

                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            .padding(12)
            .background(MeshTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Downloading

    private func downloadingView(progress: Double, asset: OTAAsset) -> some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "arrow.down.circle",
                title: "Downloading Firmware",
                subtitle: "Downloading \(asset.displayName) — \(asset.sizeFormatted)"
            )

            VStack(spacing: 8) {
                if progress > 0 {
                    LinearProgressBar(progress: progress)
                    Text(String(format: "%d%%", Int(progress * 100)))
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                } else {
                    ProgressView().tint(MeshTheme.accent)
                }
            }

            Text("Keep the app open while downloading.")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Activate OTA

    private func activateView(firmwareData: Data, asset: OTAAsset) -> some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: asset.isZip ? "bolt.horizontal" : "wifi",
                title: "Activate OTA Mode",
                subtitle: asset.isZip
                    ? "Your radio needs to enter DFU bootloader mode to receive the update."
                    : "Your radio needs to create a WiFi hotspot for the update."
            )

            VStack(alignment: .leading, spacing: 12) {
                // Step A: trigger OTA mode
                instructionCard(number: "1", title: "Start OTA mode on your radio") {
                    VStack(alignment: .leading, spacing: 8) {
                        #if os(macOS) || targetEnvironment(macCatalyst)
                        if connectionManager.isUSBCLIMode || connectionManager.isUSBBinaryMode {
                            Text("Your radio is connected via USB. Tap the button below to send the command.")
                                .font(.subheadline)
                                .foregroundStyle(MeshTheme.textPrimary)
                            Button {
                                connectionManager.sendUSBCLI("start ota")
                            } label: {
                                Label("Send start ota Command", systemImage: "terminal")
                                    .foregroundStyle(MeshTheme.accent)
                            }
                            .buttonStyle(.plain)
                        } else if let session = remoteSessionManager.activeAdminSession {
                            remoteAdminOTAContent(session: session)
                        } else {
                            otaManualInstructions
                        }
                        #else
                        if let session = remoteSessionManager.activeAdminSession {
                            remoteAdminOTAContent(session: session)
                        } else {
                            otaManualInstructions
                        }
                        #endif
                    }
                }

                // Step B: connect to WiFi (ESP32 only — nRF52 goes straight to DFU app)
                if !asset.isZip {
                    instructionCard(number: "2", title: "Connect to '\(FirmwareOTAService.otaSSID)' WiFi") {
                        VStack(alignment: .leading, spacing: 8) {
                            #if os(macOS) || targetEnvironment(macCatalyst)
                            Text("After the radio starts OTA mode, click the WiFi icon in the menu bar and connect to:")
                                .font(.subheadline)
                                .foregroundStyle(MeshTheme.textPrimary)
                            #else
                            Text("After the radio starts OTA mode, go to Settings → Wi-Fi and connect to:")
                                .font(.subheadline)
                                .foregroundStyle(MeshTheme.textPrimary)
                            #endif
                            HStack(spacing: 8) {
                                Image(systemName: "wifi")
                                    .foregroundStyle(MeshTheme.accent)
                                Text(FirmwareOTAService.otaSSID)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(MeshTheme.textPrimary)
                            }
                            Text("No password required. Then return to this screen.")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                }
            }

            Button {
                otaService.beginDetection(firmwareData: firmwareData, asset: asset)
            } label: {
                (asset.isZip ? Text("I've Started OTA Mode — Continue") : Text("I've Connected — Continue"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(MeshTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Detecting Radio

    private var detectingView: some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "magnifyingglass",
                title: "Looking for Radio",
                subtitle: "Waiting for 192.168.4.1 to become reachable…"
            )

            ProgressView()
                .controlSize(.large)
                .tint(MeshTheme.accent)

            VStack(spacing: 4) {
                Text("Make sure your device is connected to '\(FirmwareOTAService.otaSSID)' WiFi.")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
                Text("This may take up to 30 seconds after the radio starts OTA mode.")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Uploading

    private func uploadingView(progress: Double, asset: OTAAsset) -> some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "arrow.up.circle",
                title: "Uploading Firmware",
                subtitle: "Transferring \(asset.displayName) to your radio…"
            )

            VStack(spacing: 8) {
                if progress > 0 {
                    LinearProgressBar(progress: progress)
                    Text(String(format: "%d%%", Int(progress * 100)))
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                } else {
                    ProgressView().tint(MeshTheme.accent)
                }
            }

            Text("Do not close the app or disconnect from '\(FirmwareOTAService.otaSSID)' WiFi.")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Done

    private func doneView(asset: OTAAsset) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.green)

            VStack(spacing: 8) {
                Text("Firmware Installed")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(MeshTheme.textPrimary)
                VStack(spacing: 2) {
                    Text(asset.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                    if let version = asset.version {
                        Text(version)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
                Text("The device rebooted successfully. Reconnect your WiFi to your normal network if needed — the app will reconnect automatically.")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                dismiss()
            } label: {
                Text("Done")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(MeshTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Failed

    private func failedView(message: String, canRetry: Bool) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.orange)

            VStack(spacing: 8) {
                Text("Update Failed")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(MeshTheme.textPrimary)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            if canRetry {
                Button {
                    Task {
                        let mfr = manufacturerHint.isEmpty ? deviceConfig.manufacturer : manufacturerHint
                        await otaService.start(manufacturer: mfr, firmwareType: firmwareType)
                    }
                } label: {
                    Text("Try Again")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(MeshTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }

            Button { dismiss() } label: {
                Text("Close")
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - DFU Handoff (nRF52)

    private func dfuHandoffView(zipData: Data, asset: OTAAsset) -> some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "bolt.horizontal",
                title: "Upload via nRF DFU App",
                subtitle: "Your radio is in DFU mode. Use the nRF Device Firmware Update app to complete the update."
            )

            VStack(alignment: .leading, spacing: 12) {
                instructionCard(number: "1", title: "Save the firmware file") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Save the firmware ZIP to your Files so the nRF DFU app can access it.")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textPrimary)
                        if let zipURL = makeTempZipURL(data: zipData, named: asset.name) {
                            ShareLink(item: zipURL, preview: SharePreview(asset.displayName, image: Image(systemName: "doc.zipper"))) {
                                Label("Save \(asset.name)", systemImage: "square.and.arrow.up")
                                    .foregroundStyle(MeshTheme.accent)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                instructionCard(number: "2", title: "Open nRF Device Firmware Update") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Install the free nRF Device Firmware Update app by Nordic Semiconductor, then:")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textPrimary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("1. Open the nRF DFU app")
                            Text("2. Tap Settings → enable Packet Receipt Notifications, set to 8")
                            Text("3. Select the ZIP file you saved")
                            Text("4. Select your device from the list")
                            Text("5. Tap Upload and wait for completion")
                        }
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)

                        if let url = URL(string: "https://apps.apple.com/search?term=nRF+Device+Firmware+Update") {
                            Link(destination: url) {
                                Label("Get nRF Device Firmware Update", systemImage: "arrow.up.right.square")
                                    .foregroundStyle(MeshTheme.accent)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Button { dismiss() } label: {
                Text("Done")
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func makeTempZipURL(data: Data, named: String) -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(named)
        do {
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }

    private func remoteAdminOTAContent(session: RemoteDeviceSession) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your radio is logged in via remote admin. Tap the button below to send the command.")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textPrimary)
            Button {
                remoteSessionManager.sendCLICommand("start ota", on: session)
            } label: {
                Label("Send start ota Command", systemImage: "terminal")
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.plain)
        }
    }

    private var otaManualInstructions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Press the physical OTA button on your hardware, or connect via USB serial and run:")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textPrimary)
            Text("start ota")
                .font(.system(.body, design: .monospaced).weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(MeshTheme.accent.opacity(0.1))
                .foregroundStyle(MeshTheme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            Text("Note: if your radio is connected via WiFi, it will disconnect when OTA mode starts — that's expected.")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }

    // MARK: - Reusable layout pieces

    private func stepHeader(icon: String, title: LocalizedStringKey, subtitle: LocalizedStringKey) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(MeshTheme.accent)
            VStack(spacing: 4) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(MeshTheme.textPrimary)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.bottom, 8)
    }

    private func instructionCard(number: String, title: LocalizedStringKey, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(number)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.black)
                    .frame(width: 20, height: 20)
                    .background(MeshTheme.accent)
                    .clipShape(Circle())
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MeshTheme.textPrimary)
            }
            content()
                .padding(.leading, 28)
        }
        .padding(14)
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
#endif
