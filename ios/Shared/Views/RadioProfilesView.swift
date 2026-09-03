//
//  RadioProfilesView.swift
//  PommeCore
//
//  Save, apply, rename, and delete radio configuration profiles.
//  Profiles are stored in iCloud KVS (max 10).
//
//  Created by Michael P. Bedworth on 04/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct RadioProfilesView: View {
    @Environment(RadioProfileStore.self) private var profileStore
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ChannelStore.self) private var channelStore

    @State private var showSaveAlert = false
    @State private var newProfileName = ""
    @State private var profileToRename: RadioProfile?
    @State private var renameText = ""
    @State private var profileToApply: RadioProfile?
    @State private var isApplying = false
    @State private var appliedProfileID: UUID?

    private var isConnected: Bool { connectionManager.isActivelyConnected }

    var body: some View {
        List {
            saveSection
            profilesSection
        }
        .navigationTitle("Radio Profiles")
        .meshListStyle()
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .alert("Save Profile", isPresented: $showSaveAlert) {
            TextField("Profile Name", text: $newProfileName)
            Button("Save") { saveCurrentConfig() }
            Button("Cancel", role: .cancel) { newProfileName = "" }
        } message: {
            Text("Give this radio configuration a name.")
        }
        .alert("Rename Profile", isPresented: Binding(
            get: { profileToRename != nil },
            set: { if !$0 { profileToRename = nil } }
        )) {
            TextField("Name", text: $renameText)
            Button("Rename") {
                if let p = profileToRename, !renameText.trimmingCharacters(in: .whitespaces).isEmpty {
                    profileStore.rename(p, to: renameText.trimmingCharacters(in: .whitespaces))
                }
                profileToRename = nil
            }
            Button("Cancel", role: .cancel) { profileToRename = nil }
        } message: {
            Text("Enter a new name for \"\(profileToRename?.name ?? "")\".")
        }
        .alert("Apply Profile", isPresented: Binding(
            get: { profileToApply != nil && !isApplying },
            set: { if !$0 { profileToApply = nil } }
        )) {
            Button("Apply", role: .destructive) {
                guard let p = profileToApply else { return }
                Task { await applyProfile(p) }
            }
            Button("Cancel", role: .cancel) { profileToApply = nil }
        } message: {
            if let p = profileToApply {
                Text("Apply \"\(p.name)\" to your connected radio? Current settings will be overwritten. A reboot is required after applying.")
            }
        }
    }

    // MARK: - Sections

    private var saveSection: some View {
        Section {
            if isConnected {
                Button {
                    newProfileName = suggestedName()
                    showSaveAlert = true
                } label: {
                    Label(profileStore.profiles.count >= 10
                          ? "Profile Limit Reached (10/10)"
                          : "Save Current Config",
                          systemImage: "plus.circle")
                        .foregroundStyle(profileStore.profiles.count >= 10
                                         ? MeshTheme.textSecondary : MeshTheme.accent)
                }
                .buttonStyle(.plain)
                .disabled(profileStore.profiles.count >= 10)
                .listRowBackground(MeshTheme.surface)
            } else {
                LabelValueRow(label: "Save Current Config", value: "Connect to radio first")
                    .listRowBackground(MeshTheme.surface)
            }
        } header: {
            SectionInfoHeader(title: "Profiles",
                              info: "Save your current radio settings and channels as a named profile. Switch profiles when moving between mesh networks or regions.")
        } footer: {
            Text("Includes radio name, frequency, spreading factor, bandwidth, TX power, channels, and routing settings. Stored in iCloud. Max 10 profiles.")
        }
    }

    @ViewBuilder
    private var profilesSection: some View {
        if !profileStore.profiles.isEmpty {
            Section("Saved") {
                ForEach(profileStore.profiles) { profile in
                    profileRow(profile)
                }
                .onDelete { offsets in
                    offsets.forEach { profileStore.delete(profileStore.profiles[$0]) }
                }
            }
        }
    }

    private func profileRow(_ profile: RadioProfile) -> some View {
        let r = profile.config.radio
        let freqStr = String(format: "%.3f MHz", Double(r.radioFrequency) / 1000.0)
        let bwKHz = r.radioBandwidth / 1000
        let summary = "\(freqStr) · \(bwKHz)kHz · SF\(r.radioSpreadingFactor)"
        let justApplied = appliedProfileID == profile.id

        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(profile.name)
                        .font(.body)
                        .foregroundStyle(MeshTheme.textPrimary)
                    if justApplied {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                Text(profile.savedAt, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            Spacer()
            if isApplying && profileToApply?.id == profile.id {
                ProgressView().controlSize(.small)
            } else if isConnected {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .contentShape(Rectangle())
        .listRowBackground(justApplied ? MeshTheme.accent.opacity(0.1) : MeshTheme.surface)
        .onTapGesture {
            guard isConnected && !isApplying else { return }
            profileToApply = profile
        }
        .contextMenu {
            Button {
                renameText = profile.name
                profileToRename = profile
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
                profileStore.delete(profile)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    // MARK: - Actions

    private func saveCurrentConfig() {
        let trimmed = newProfileName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        newProfileName = ""
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let export = ProfileExportService.buildExport(deviceConfig: deviceConfig,
                                                      channelStore: channelStore,
                                                      appVersion: appVersion)
        let profile = RadioProfile(name: trimmed, config: export)
        profileStore.save(profile)
    }

    private func applyProfile(_ profile: RadioProfile) async {
        isApplying = true
        profileToApply = nil
        await ProfileExportService.applyProfile(profile.config,
                                                connectionManager: connectionManager,
                                                channelStore: channelStore)
        isApplying = false
        appliedProfileID = profile.id
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if appliedProfileID == profile.id { appliedProfileID = nil }
        }
    }

    private func suggestedName() -> String {
        let freq = String(format: "%.3f", Double(deviceConfig.radioFrequency) / 1000.0)
        let name = deviceConfig.deviceName.isEmpty ? "" : "\(deviceConfig.deviceName) · "
        return "\(name)\(freq) MHz"
    }
}
#endif
