//
//  USBSerialView.swift
//  PommeCore
//
//  USB terminal view for raw CLI interaction with infrastructure devices.
//
//  Created by Michael P. Bedworth on 3/16/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if os(macOS) || targetEnvironment(macCatalyst)
import SwiftUI
import MeshCoreKit

// MARK: - USB Terminal View (CLI Mode)

struct USBTerminalView: View {
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var commandText = ""

    var body: some View {
        VStack(spacing: 0) {
            // Output log
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(remoteSessionManager.usbCLIOutput) { line in
                            Text(line.text)
                                .font(.system(.body, design: .monospaced))
                                .foregroundStyle(line.isCommand ? MeshTheme.accent : MeshTheme.textPrimary)
                                .textSelection(.enabled)
                                .id(line.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .onChange(of: remoteSessionManager.usbCLIOutput.count) {
                    if let last = remoteSessionManager.usbCLIOutput.last {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Command input
            HStack(spacing: 8) {
                Text(">")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(MeshTheme.accent)
                TextField("Enter command...", text: $commandText)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.plain)
                    .onSubmit {
                        guard !commandText.isEmpty else { return }
                        sendCommand()
                    }
                Button {
                    guard !commandText.isEmpty else { return }
                    sendCommand()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(MeshTheme.surface)
        }
        .background(MeshTheme.background)
        .navigationTitle("USB Terminal")
    }

    private func sendCommand() {
        connectionManager.sendUSBCLI(commandText)
        remoteSessionManager.usbCLIOutput.append(USBTerminalLine(text: "> \(commandText)", isCommand: true))
        commandText = ""
    }
}
#endif
