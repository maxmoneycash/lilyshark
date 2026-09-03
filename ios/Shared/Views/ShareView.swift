//
//  ShareView.swift
//  PommeCore
//
//  QR code generation, contact/channel sharing, and meshcore:// URL handling.
//
//  Created by Michael P. Bedworth on 3/16/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
#if !os(watchOS)
import CoreImage.CIFilterBuiltins
#endif
import MeshCoreKit

// MARK: - QR Code Helpers

#if !os(watchOS)

#if os(macOS)
private func generateQRCodeImage(from string: String) -> NSImage? {
    guard let data = string.data(using: .utf8) else { return nil }
    let filter = CIFilter.qrCodeGenerator()
    filter.message = data
    filter.correctionLevel = "M"
    guard let ciImage = filter.outputImage else { return nil }
    let transform = CGAffineTransform(scaleX: 10, y: 10)
    let scaled = ciImage.transformed(by: transform)
    let rep = NSCIImageRep(ciImage: scaled)
    let nsImage = NSImage(size: rep.size)
    nsImage.addRepresentation(rep)
    return nsImage
}
#else
private func generateQRCodeImage(from string: String) -> UIImage? {
    guard let data = string.data(using: .utf8) else { return nil }
    let filter = CIFilter.qrCodeGenerator()
    filter.message = data
    filter.correctionLevel = "M"
    guard let ciImage = filter.outputImage else { return nil }
    let transform = CGAffineTransform(scaleX: 10, y: 10)
    let scaled = ciImage.transformed(by: transform)
    let context = CIContext()
    guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cgImage)
}
#endif

/// Reusable QR code image view — renders a large, centered QR code.
private struct QRImage: View {
    let content: String
    let size: CGFloat

    var body: some View {
        if let image = generateQRCodeImage(from: content) {
            #if os(macOS)
            Image(nsImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
            #else
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
            #endif
        }
    }
}

// MARK: - QR Code View (legacy, used by ShareContactSheet / MyContactCodeSheet)

struct QRCodeView: View {
    let content: String
    let label: LocalizedStringKey

    var body: some View {
        VStack(spacing: 16) {
            QRImage(content: content, size: 250)

            Text(label)
                .font(.headline)
                .foregroundStyle(MeshTheme.textPrimary)

            Text(content)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)

            Button {
                copyToClipboard(content)
            } label: {
                Label("Copy Link", systemImage: "doc.on.doc")
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.plain)
        }
        .padding()
    }
}
#endif

// MARK: - QR Code Camera Scanner (iOS only)

#if os(iOS)
import AVFoundation

struct QRScannerView: UIViewControllerRepresentable {
    let onCodeScanned: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let vc = QRScannerViewController()
        vc.onCodeScanned = onCodeScanned
        return vc
    }

    func updateUIViewController(_ vc: QRScannerViewController, context: Context) {}
}

class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCodeScanned: ((String) -> Void)?
    private let captureSession = AVCaptureSession()
    private var hasScanned = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              captureSession.canAddInput(input) else {
            showError("Camera not available")
            return
        }

        captureSession.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else { return }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
        previewLayer.frame = view.bounds
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)

        // Scan target overlay
        let guide = UIView()
        guide.layer.borderColor = UIColor.white.cgColor
        guide.layer.borderWidth = 2
        guide.layer.cornerRadius = 12
        guide.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(guide)
        NSLayoutConstraint.activate([
            guide.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            guide.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            guide.widthAnchor.constraint(equalToConstant: 250),
            guide.heightAnchor.constraint(equalToConstant: 250),
        ])

        let hint = UILabel()
        hint.text = "Point camera at a meshcore:// QR code"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 14)
        hint.textAlignment = .center
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)
        NSLayoutConstraint.activate([
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hint.topAnchor.constraint(equalTo: guide.bottomAnchor, constant: 20),
        ])

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.captureSession.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !hasScanned,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let string = object.stringValue,
              string.hasPrefix("meshcore://") else { return }
        hasScanned = true
        captureSession.stopRunning()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        onCodeScanned?(string)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureSession.stopRunning()
    }

    private func showError(_ message: String) {
        let label = UILabel()
        label.text = message
        label.textColor = .white
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}
#endif

// MARK: - Share Contact Sheet

#if !os(watchOS)
struct ShareContactSheet: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(\.dismiss) private var dismiss
    @State private var exportedURL: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let url = exportedURL {
                    QRCodeView(
                        content: url,
                        label: "Share \(contactStore.displayName(for: contact))"
                    )
                    Text("Scan this QR code or share the link to add this contact.")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                } else {
                    ProgressView()
                        .tint(MeshTheme.accent)
                    Text("Generating contact link...")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                Spacer()
            }
            .padding(.top, 20)
            .navigationTitle("Share Contact")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                messageStoreManager.lastExportedURL = nil
                let frame = MeshCoreProtocol.buildExportContact(publicKey: contact.publicKey)
                connectionManager.sendCommand(frame, label: "EXPORT_CONTACT")
            }
            .onChange(of: messageStoreManager.lastExportedURL) { _, url in
                if let url, !url.isEmpty {
                    exportedURL = url
                    messageStoreManager.lastExportedURL = nil
                }
            }
        }
        .meshTheme()
    }
}
#endif

// MARK: - My Contact Code Sheet

#if !os(watchOS)
struct MyContactCodeSheet: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(\.dismiss) private var dismiss
    @State private var exportedURL: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let url = exportedURL {
                    QRCodeView(
                        content: url,
                        label: deviceConfig.deviceName.isEmpty ? "My Contact Code" : "\(deviceConfig.deviceName)"
                    )
                    Text("Others can scan this QR code to add you as a contact.")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                } else {
                    ProgressView()
                        .tint(MeshTheme.accent)
                    Text("Generating contact code...")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                Spacer()
            }
            .padding(.top, 20)
            .navigationTitle("My Contact Code")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                messageStoreManager.lastExportedURL = nil
                connectionManager.sendCommand(Data([0x11]), label: "EXPORT_SELF")
            }
            .onChange(of: messageStoreManager.lastExportedURL) { _, url in
                if let url, !url.isEmpty {
                    exportedURL = url
                    messageStoreManager.lastExportedURL = nil
                }
            }
        }
        .meshTheme()
    }
}
#endif

// MARK: - Share Channel Sheet

#if !os(watchOS)
struct ShareChannelSheet: View {
    let channel: MeshChannel
    @Environment(\.dismiss) private var dismiss
    @State private var copiedQR = false

    private var channelURL: String {
        var url = "meshcore://channel?name=\(channel.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? channel.name)"
        if let secret = channel.secret {
            url += "&secret=\(secret.hexCompact)"
        }
        return url
    }

    private var secretHex: String? {
        channel.secret?.hexCompact
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // QR Code — large and prominent
                    QRImage(content: channelURL, size: 250)

                    // Channel name and instruction
                    VStack(spacing: 6) {
                        Text(channel.name)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(MeshTheme.textPrimary)
                        Text("Scan QR code to add channel")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }

                    if channel.secret == nil {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                            Text("Channel secret not available locally. Recipients will need the secret separately to join.")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        .padding(.horizontal)
                    }

                    // Action buttons
                    VStack(spacing: 12) {
                        // Copy Link
                        CopyButton(text: channelURL, label: "Copy Link", icon: "doc.on.doc")

                        // Copy Secret
                        if let hex = secretHex {
                            CopyButton(text: hex, label: "Copy Secret", icon: "key")
                        }

                        // Platform-specific share
                        #if os(iOS)
                        ShareLink(item: channelURL) {
                            HStack {
                                Label("Share", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .padding(.vertical, 10)
                            .background(MeshTheme.accent)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        #elseif os(macOS)
                        Button {
                            if let image = generateQRCodeImage(from: channelURL) {
                                let pasteboard = NSPasteboard.general
                                pasteboard.clearContents()
                                pasteboard.writeObjects([image])
                                showFeedback($copiedQR)
                            }
                        } label: {
                            (copiedQR ? Label("Copied!", systemImage: "checkmark") : Label("Copy QR Code", systemImage: "photo.on.rectangle"))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(MeshTheme.accent.opacity(0.1))
                                .foregroundStyle(copiedQR ? MeshTheme.interactiveGreen : MeshTheme.accent)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        #endif
                    }
                    .padding(.horizontal)
                }
                .padding(.top, 20)
                .padding(.bottom, 30)
            }
            .navigationTitle("Share Channel")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .meshTheme()
    }
}

// MARK: - Share All Channels Sheet

struct ShareAllChannelsSheet: View {
    let channels: [MeshChannel]
    @Environment(\.dismiss) private var dismiss
    @State private var copiedQR = false

    private var nonPublicChannels: [MeshChannel] {
        channels.filter { $0.index != 0 }
    }

    private var channelsURL: String {
        var list: [[String: String]] = []
        for channel in nonPublicChannels {
            let hex = channel.secret?.hexCompact ?? ""
            list.append(["name": channel.name, "secret": hex])
        }
        guard let jsonData = try? JSONSerialization.data(withJSONObject: list),
              let base64 = jsonData.base64EncodedString()
                .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            return "meshcore://channels?data="
        }
        return "meshcore://channels?data=\(base64)"
    }

    private var channelNames: String {
        nonPublicChannels.map(\.name).joined(separator: ", ")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // QR Code — large and prominent
                    QRImage(content: channelsURL, size: 250)

                    VStack(spacing: 6) {
                        Text("\(nonPublicChannels.count) Channels")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(MeshTheme.textPrimary)
                        Text(channelNames)
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .multilineTextAlignment(.center)
                        Text("Scan QR code to import all channels")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .padding(.horizontal)

                    VStack(spacing: 12) {
                        CopyButton(text: channelsURL, label: "Copy Link", icon: "doc.on.doc")

                        #if os(iOS)
                        ShareLink(item: channelsURL) {
                            HStack {
                                Label("Share", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .padding(.vertical, 10)
                            .background(MeshTheme.accent)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        #elseif os(macOS)
                        Button {
                            if let image = generateQRCodeImage(from: channelsURL) {
                                let pasteboard = NSPasteboard.general
                                pasteboard.clearContents()
                                pasteboard.writeObjects([image])
                                showFeedback($copiedQR)
                            }
                        } label: {
                            (copiedQR ? Label("Copied!", systemImage: "checkmark") : Label("Copy QR Code", systemImage: "photo.on.rectangle"))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(MeshTheme.accent.opacity(0.1))
                                .foregroundStyle(copiedQR ? MeshTheme.interactiveGreen : MeshTheme.accent)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        #endif
                    }
                    .padding(.horizontal)
                }
                .padding(.top, 20)
                .padding(.bottom, 30)
            }
            .navigationTitle("Share All Channels")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .meshTheme()
    }
}
#endif
