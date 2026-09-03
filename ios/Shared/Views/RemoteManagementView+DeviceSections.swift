//
//  RemoteManagementView+DeviceSections.swift
//  PommeCore
//
//  Security, GPS, and Clock sections for remote management.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - Security Section

struct RemoteSecuritySection: View {
    let contact: Contact
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    let permission: RemotePermission

    @State private var adminPassword = ""
    @State private var guestPassword = ""

    var body: some View {
        Group {
            if permission.isAdmin {
                HStack {
                    Image(systemName: "lock.shield")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    #if os(watchOS)
                    SecureField("New Admin Password", text: $adminPassword)
                        .foregroundStyle(MeshTheme.textPrimary)
                    #else
                    SecureField("New Admin Password", text: $adminPassword)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .textFieldStyle(MeshTextFieldStyle())
                        .onChange(of: adminPassword) { _, new in
                            if new.count > 15 { adminPassword = String(new.prefix(15)) }
                        }
                    #endif
                    Button {
                        guard !adminPassword.isEmpty else { return }
                        sendCLI("password \(adminPassword)")
                        adminPassword = ""
                    } label: {
                        Text("Set")
                            .foregroundStyle(MeshTheme.accent)
                    }
                    .buttonStyle(.plain)
                }
                .listRowBackground(MeshTheme.surface)
            }

            HStack {
                Image(systemName: "lock")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                #if os(watchOS)
                SecureField("Guest Password", text: $guestPassword)
                    .foregroundStyle(MeshTheme.textPrimary)
                #else
                SecureField("Guest Password", text: $guestPassword)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .textFieldStyle(MeshTextFieldStyle())
                    .onChange(of: guestPassword) { _, new in
                        if new.count > 15 { guestPassword = String(new.prefix(15)) }
                    }
                #endif
                Button {
                    guard !guestPassword.isEmpty else { return }
                    sendCLI("set guest.password \(guestPassword)")
                    guestPassword = ""
                } label: {
                    Text("Set")
                        .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.plain)
            }
            .listRowBackground(MeshTheme.surface)

            HStack(spacing: 8) {
                Image(systemName: "list.bullet.rectangle")
                    .foregroundStyle(MeshTheme.textSecondary)
                    .frame(width: 24)
                Text("ACL requires USB serial connection")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            .listRowBackground(MeshTheme.surface)
        }
    }
}

// MARK: - GPS Section

struct RemoteGPSSection: View {
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    let canEdit: Bool
    @State private var gpsSyncFeedback = false
    @State private var gpsLocFeedback = false
    @State private var gpsAdvertMode = ""

    var body: some View {
        Group {
            CLIToggleRow(icon: "location.circle", label: "GPS", settingKey: "gps", onCommand: "gps on", offCommand: "gps off", session: session, sendCLI: sendCLI, canEdit: canEdit)

            if canEdit {
                HStack(spacing: 12) {
                    Button {
                        let epoch = Int(Date().timeIntervalSince1970)
                        sendCLI("time \(epoch)")
                        sendCLI("gps sync")
                        showFeedback($gpsSyncFeedback)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { sendCLI("clock") }
                    } label: {
                        (gpsSyncFeedback ? Label("Clock Synced", systemImage: "checkmark.circle.fill") : Label("Sync Time", systemImage: "clock.arrow.2.circlepath"))
                            .foregroundStyle(gpsSyncFeedback ? .green : MeshTheme.accent)
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Button {
                        sendCLI("gps setloc")
                        showFeedback($gpsLocFeedback)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                            sendCLI("get lat")
                            sendCLI("get lon")
                        }
                    } label: {
                        (gpsLocFeedback ? Label("Location Set", systemImage: "checkmark.circle.fill") : Label("Set from Hardware GPS", systemImage: "antenna.radiowaves.left.and.right"))
                            .foregroundStyle(gpsLocFeedback ? .green : MeshTheme.accent)
                    }
                    .buttonStyle(.plain)
                }
                .listRowBackground(MeshTheme.surface)

                HStack {
                    Image(systemName: "location.north.line")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Picker("Location in Advertisements", selection: gpsAdvertBinding) {
                        Text("None \u{2014} don't include location").tag("none")
                        Text("GPS \u{2014} use live GPS coordinates").tag("share")
                        Text("Manual \u{2014} use saved lat/lon settings").tag("prefs")
                    }
                    .foregroundStyle(MeshTheme.accent)
                    .tint(.primary)
                }
                .listRowBackground(MeshTheme.surface)
            }
        }
    }

    private var gpsAdvertBinding: Binding<String> {
        Binding(
            get: {
                if !gpsAdvertMode.isEmpty { return gpsAdvertMode }
                return session.settings["gps advert"] ?? session.settings["gps.advert"] ?? "none"
            },
            set: { newValue in
                gpsAdvertMode = newValue
                sendCLI("gps advert \(newValue)")
            }
        )
    }
}

// MARK: - Remote Clock Row

struct RemoteClockRow: View {
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void

    private var clockValue: String {
        guard let raw = session.settings["clock"], !raw.isEmpty else { return "\u{2014}" }
        // If the response looks like a raw epoch number, format it as a date
        if let epoch = Double(raw.trimmingCharacters(in: .whitespaces)), epoch > 1_000_000_000 {
            let date = Date(timeIntervalSince1970: epoch)
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return raw
    }

    /// Check if the clock text indicates a stale date (more than 60 seconds from now).
    private var isClockStale: Bool {
        guard let clockStr = session.settings["clock"], !clockStr.isEmpty else { return false }
        // Try to extract epoch from the response — firmware returns "HH:MM - DD/MM/YYYY" or epoch
        // Check for year mismatch (robust heuristic for date-formatted responses)
        let calendar = Calendar.current
        let currentYear = calendar.component(.year, from: Date())
        let yearPattern = try? NSRegularExpression(pattern: "\\b(20\\d{2})\\b")
        if let match = yearPattern?.firstMatch(in: clockStr, range: NSRange(clockStr.startIndex..., in: clockStr)),
           let range = Range(match.range(at: 1), in: clockStr),
           let year = Int(clockStr[range]) {
            return abs(year - currentYear) >= 1
        }
        // If response is just an epoch number, compare with 60-second tolerance
        if let epoch = Double(clockStr.trimmingCharacters(in: .whitespaces)) {
            return abs(epoch - Date().timeIntervalSince1970) > 60
        }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                sendCLI("clock")
            } label: {
                HStack {
                    Image(systemName: "clock")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Clock")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text(clockValue)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .font(.caption)
                    Image(systemName: "arrow.clockwise")
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            HStack(spacing: 6) {
                if isClockStale {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.caption)
                    Text("Clock out of sync")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                Spacer()
                Button {
                    let epoch = Int(Date().timeIntervalSince1970)
                    sendCLI("time \(epoch)")
                    // Refresh clock after a delay
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        sendCLI("clock")
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "clock.arrow.2.circlepath")
                            .font(.caption)
                        Text("Sync Clock")
                            .font(.caption)
                    }
                    .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .listRowBackground(MeshTheme.surface)
    }
}
