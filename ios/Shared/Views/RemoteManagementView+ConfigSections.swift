//
//  RemoteManagementView+ConfigSections.swift
//  PommeCore
//
//  Radio, Timing, Routing, and Advertising configuration sections for remote management.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit
import CoreLocation

// MARK: - Radio Section

struct RemoteRadioSection: View {
    let contact: Contact
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    let canEdit: Bool

    @State private var radioParams = ""
    @State private var txPower = ""
    @State private var saveState: SaveButtonState = .idle
    @State private var isRebooting = false
    @State private var regionFilter: String? = LocationSuggestion.cachedCountryCode

    /// Parse "freq_MHz,bw_kHz,sf,cr" from session settings into components for preset detection.
    private var parsedRadio: (freqKHz: Double, bw: Double, sf: UInt8, cr: UInt8) {
        guard let radio = session.settings["radio"] else { return (0, 0, 0, 0) }
        let parts = radio.replacingOccurrences(of: " ", with: "").split(separator: ",")
        guard parts.count >= 4,
              let freqMHz = Double(parts[0]),
              let bw = Double(parts[1]),
              let sf = UInt8(parts[2]),
              let cr = UInt8(parts[3]) else { return (0, 0, 0, 0) }
        return (freqMHz * 1000, bw, sf, cr) // Convert MHz → kHz for preset comparison
    }

    var body: some View {
        if canEdit {
            RadioPresetPicker(
                onApply: { preset in
                    let freqMHz = String(format: "%.6f", preset.frequencyKHz / 1000.0)
                    let bwStr = preset.bandwidth == preset.bandwidth.rounded() ? "\(Int(preset.bandwidth))" : "\(preset.bandwidth)"
                    let params = "\(freqMHz),\(bwStr),\(preset.spreadingFactor),\(preset.codingRate)"
                    radioParams = params
                    sendCLI("set radio \(params)")
                    // Radio params require reboot to take effect — guard against rapid taps
                    guard !isRebooting else { return }
                    isRebooting = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        sendCLI("reboot")
                    }
                },
                currentFreqKHz: parsedRadio.freqKHz,
                currentBW: parsedRadio.bw,
                currentSF: parsedRadio.sf,
                currentCR: parsedRadio.cr,
                countryFilter: regionFilter
            )
            .task { regionFilter = await LocationSuggestion.detectIfNeeded() }
        }

        Section {
            if canEdit {
                cliEditRow(icon: "antenna.radiowaves.left.and.right", label: "Radio (freq,bw,sf,cr)", text: $radioParams, current: session.settings["radio"])
                cliEditRow(icon: "bolt", label: "TX Power", text: $txPower, current: session.settings["tx"])
            } else {
                cliInfoRow(icon: "antenna.radiowaves.left.and.right", label: "Radio", value: session.settings["radio"] ?? "\u{2014}")
                cliInfoRow(icon: "bolt", label: "TX Power", value: session.settings["tx"] ?? "\u{2014}")
            }
            CLIToggleRow(icon: "repeat", label: "Repeat Mode", settingKey: "repeat", onCommand: "set repeat on", offCommand: "set repeat off", session: session, sendCLI: sendCLI, canEdit: canEdit)

            if canEdit {
                SaveButton(state: saveState, label: "Apply Radio Settings") {
                    if !radioParams.isEmpty { sendCLI("set radio \(radioParams)") }
                    if !txPower.isEmpty { sendCLI("set tx \(txPower)") }
                    showSaved($saveState)
                }
            }
        } header: {
            SectionInfoHeader(title: "Radio Configuration", info: "Radio format: freq_MHz,bw_kHz,sf,cr (e.g. 910.525,62.5,7,5)")
        }
    }
}

// MARK: - Timing Section

struct RemoteTimingSection: View {
    let contact: Contact
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    let canEdit: Bool

    @State private var airtimeFactor = ""
    @State private var rxDelay = ""
    @State private var txDelay = ""
    @State private var directTxDelay = ""
    @State private var floodMax = ""
    @State private var floodMaxUnscoped = ""
    @State private var intThresh = ""
    @State private var agcReset = ""
    @State private var saveState: SaveButtonState = .idle

    var body: some View {
        Group {
            cliEditRow(icon: "clock.arrow.2.circlepath", label: "Duty Cycle", text: $airtimeFactor, current: session.settings["dutycycle"] ?? session.settings["af"])
            cliEditRow(icon: "timer", label: "RX Delay", text: $rxDelay, current: session.settings["rxdelay"])
            cliEditRow(icon: "arrow.up.circle", label: "TX Delay", text: $txDelay, current: session.settings["txdelay"])
            cliEditRow(icon: "arrow.right.circle", label: "Direct TX Delay", text: $directTxDelay, current: session.settings["direct.txdelay"])
            cliEditRow(icon: "arrow.triangle.branch", label: "Flood Max Hops", text: $floodMax, current: session.settings["flood.max"])
            cliEditRow(icon: "arrow.triangle.branch", label: "Flood Max (Unscoped)", text: $floodMaxUnscoped, current: session.settings["flood.max.unscoped"])
            cliEditRow(icon: "waveform.badge.exclamationmark", label: "Interference Thresh", text: $intThresh, current: session.settings["int.thresh"])
            cliEditRow(icon: "dial.low", label: "AGC Reset Interval", text: $agcReset, current: session.settings["agc.reset.interval"])

            if canEdit {
                SaveButton(state: saveState, label: "Apply Settings") {
                    let dutycycleCmd = session.settings["dutycycle"] != nil ? "set dutycycle" : "set af"
                    if !airtimeFactor.isEmpty { sendCLI("\(dutycycleCmd) \(airtimeFactor)") }
                    if !rxDelay.isEmpty { sendCLI("set rxdelay \(rxDelay)") }
                    if !txDelay.isEmpty { sendCLI("set txdelay \(txDelay)") }
                    if !directTxDelay.isEmpty { sendCLI("set direct.txdelay \(directTxDelay)") }
                    if !floodMax.isEmpty { sendCLI("set flood.max \(floodMax)") }
                    if !floodMaxUnscoped.isEmpty { sendCLI("set flood.max.unscoped \(floodMaxUnscoped)") }
                    if !intThresh.isEmpty { sendCLI("set int.thresh \(intThresh)") }
                    if !agcReset.isEmpty { sendCLI("set agc.reset.interval \(agcReset)") }
                    showSaved($saveState)
                }
            }
        }
        .disabled(!canEdit)
    }
}

// MARK: - Routing Section

struct RemoteRoutingSection: View {
    let contact: Contact
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    let canEdit: Bool
    @State private var loopDetect = ""
    @State private var pathHashMode = ""
    @State private var floodScope = ""
    @State private var floodScopeSaveState: SaveButtonState = .idle
    @State private var saveState: SaveButtonState = .idle
    // Region tree management (firmware 1.16+ `region def` builder)
    @State private var regionDef = ""
    @State private var regionPutName = ""
    @State private var regionPutParent = ""
    @State private var regionRemoveName = ""
    @State private var regionDefSaveState: SaveButtonState = .idle
    @State private var regionPutFeedback = false
    @State private var regionRemoveFeedback = false

    var body: some View {
        Group {
            HStack {
                Image(systemName: "arrow.triangle.capsulepath")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Loop Detection", selection: loopDetectBinding) {
                    Text("Off").tag("off")
                    Text("Min").tag("minimal")
                    Text("Mod").tag("moderate")
                    Text("Strict").tag("strict")
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(MeshTheme.surface)

            HStack {
                Image(systemName: "number.circle")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Path Hash", selection: pathHashBinding) {
                    Text("1-byte").tag("1")
                    Text("2-byte").tag("2")
                    Text("3-byte").tag("3")
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(MeshTheme.surface)

            CLICommandButton(icon: "antenna.radiowaves.left.and.right", label: "Discover Neighbors") {
                sendCLI("discover.neighbors")
            }

            if let neighborsResult = session.settings["discover.neighbors"], !neighborsResult.isEmpty {
                Text(neighborsResult)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(MeshTheme.textPrimary)
                    .listRowBackground(MeshTheme.surface)
            }

            if contact.type == .repeater {
                cliEditRow(icon: "globe.americas", label: "Default Flood Scope", text: $floodScope, current: session.settings["region default"])
                if canEdit {
                    let scopeName = floodScope.trimmingCharacters(in: .whitespaces)
                    SaveButton(state: floodScopeSaveState, label: "Set Flood Scope") {
                        sendCLI("region default \(scopeName)")
                        session.settings["region default"] = scopeName
                        showSaved($floodScopeSaveState)
                    }
                    .disabled(scopeName.isEmpty)
                    if session.settings["region default"] != nil && scopeName.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "info.circle")
                                .foregroundStyle(.orange)
                            Text("Flood scope can only be cleared via USB CLI on the repeater directly.")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        .listRowBackground(MeshTheme.surface)
                    }
                }

                // Region tree (firmware 1.16+): view, build via `region def`, persist.
                CLICommandButton(icon: "list.bullet.indent", label: "View Region Tree") {
                    sendCLI("region")
                }
                if let tree = session.settings["region"], !tree.isEmpty {
                    Text(tree)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(MeshTheme.textPrimary)
                        .listRowBackground(MeshTheme.surface)
                }
                if canEdit {
                    cliEditRow(icon: "point.topleft.down.to.point.bottomright.curvepath", label: "Region Def Tokens", text: $regionDef, current: nil)
                    SaveButton(state: regionDefSaveState, label: "Apply Region Def") {
                        let tokens = regionDef.trimmingCharacters(in: .whitespaces)
                        sendCLI("region def \(tokens)")
                        sendCLI("region")
                        showSaved($regionDefSaveState)
                    }
                    .disabled(regionDef.trimmingCharacters(in: .whitespaces).isEmpty)

                    HStack {
                        Image(systemName: "plus.circle")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        TextField("New region", text: $regionPutName)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .textFieldStyle(MeshTextFieldStyle())
                        TextField("Parent (optional)", text: $regionPutParent)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .textFieldStyle(MeshTextFieldStyle())
                    }
                    .listRowBackground(MeshTheme.surface)
                    Button {
                        let n = regionPutName.trimmingCharacters(in: .whitespaces)
                        let p = regionPutParent.trimmingCharacters(in: .whitespaces)
                        guard !n.contains(" "), !p.contains(" ") else { return }  // region names are single tokens
                        sendCLI(p.isEmpty ? "region put \(n)" : "region put \(n) \(p)")
                        sendCLI("region")
                        showFeedback($regionPutFeedback)
                        regionPutName = ""
                        regionPutParent = ""
                    } label: {
                        HStack {
                            Image(systemName: regionPutFeedback ? "checkmark.circle.fill" : "plus")
                                .foregroundStyle(regionPutFeedback ? .green : MeshTheme.accent)
                                .frame(width: 24)
                            Text("Add Region")
                                .foregroundStyle(MeshTheme.accent)
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(regionPutName.trimmingCharacters(in: .whitespaces).isEmpty)
                    .listRowBackground(MeshTheme.surface)

                    HStack {
                        Image(systemName: "minus.circle")
                            .foregroundStyle(.red)
                            .frame(width: 24)
                        TextField("Region to remove", text: $regionRemoveName)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .textFieldStyle(MeshTextFieldStyle())
                    }
                    .listRowBackground(MeshTheme.surface)
                    Button {
                        let n = regionRemoveName.trimmingCharacters(in: .whitespaces)
                        guard !n.contains(" ") else { return }  // region names are single tokens
                        sendCLI("region remove \(n)")
                        sendCLI("region")
                        showFeedback($regionRemoveFeedback)
                        regionRemoveName = ""
                    } label: {
                        HStack {
                            Image(systemName: regionRemoveFeedback ? "checkmark.circle.fill" : "minus")
                                .foregroundStyle(regionRemoveFeedback ? .green : .red)
                                .frame(width: 24)
                            Text("Remove Region")
                                .foregroundStyle(.red)
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(regionRemoveName.trimmingCharacters(in: .whitespaces).isEmpty)
                    .listRowBackground(MeshTheme.surface)

                    CLICommandButton(icon: "tray.and.arrow.down", label: "Save Regions (persist)") {
                        sendCLI("region save")
                    }

                    HStack(spacing: 6) {
                        Image(systemName: "info.circle")
                            .foregroundStyle(MeshTheme.accent)
                        Text("Region def builds a tree in one line: each token is a child of the previous; use name|jump to branch to an existing region, or name|* to return to root. Review the tree, then Save to persist.")
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            }
        }
        .disabled(!canEdit)
    }

    private var loopDetectBinding: Binding<String> {
        Binding(
            get: {
                if !loopDetect.isEmpty { return loopDetect }
                return session.settings["loop.detect"] ?? "off"
            },
            set: { newValue in
                loopDetect = newValue
                sendCLI("set loop.detect \(newValue)")
            }
        )
    }

    private var pathHashBinding: Binding<String> {
        Binding(
            get: {
                if !pathHashMode.isEmpty { return pathHashMode }
                return session.settings["path.hash.mode"] ?? "1"
            },
            set: { newValue in
                pathHashMode = newValue
                sendCLI("set path.hash.mode \(newValue)")
            }
        )
    }
}

// MARK: - Advertising Section

struct RemoteAdvertSection: View {
    let contact: Contact
    @ObservedObject var session: RemoteDeviceSession
    let sendCLI: (String) -> Void
    let canEdit: Bool

    @State private var name = ""
    @State private var lat = ""
    @State private var lon = ""
    @State private var ownerInfo = ""
    @State private var advertInterval = ""
    @State private var floodAdvertInterval = ""
    @State private var saveState: SaveButtonState = .idle
    @State private var showAdvertOptions = false
    @State private var showAdvertSent = false
    @State private var showMapPicker = false
    @State private var mapPickedCoordinate: CLLocationCoordinate2D?
    @State private var mapPickFeedback = false

    var body: some View {
        Section {
            cliEditRow(icon: "person.text.rectangle", label: "Name", text: $name, current: session.settings["name"])
            cliEditRow(icon: "location", label: "Latitude", text: $lat, current: session.settings["lat"])
            cliEditRow(icon: "location", label: "Longitude", text: $lon, current: session.settings["lon"])

            if canEdit {
                Button {
                    // Pre-populate with current lat/lon if available
                    if let latStr = session.settings["lat"], let lonStr = session.settings["lon"],
                       let latVal = Double(latStr), let lonVal = Double(lonStr), latVal != 0 || lonVal != 0 {
                        mapPickedCoordinate = CLLocationCoordinate2D(latitude: latVal, longitude: lonVal)
                    }
                    showMapPicker = true
                } label: {
                    (mapPickFeedback ? Label("Location Set!", systemImage: "checkmark.circle.fill") : Label("Pick on Map", systemImage: "map"))
                        .foregroundStyle(mapPickFeedback ? .green : MeshTheme.accent)
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
            }

            cliEditRow(icon: "person.crop.rectangle", label: "Owner Info", text: $ownerInfo, current: session.settings["owner.info"])
            HStack {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Standard Advert", selection: standardAdvertBinding) {
                    Text("Disabled").tag("0")
                    Text("60 min").tag("60")
                    Text("90 min").tag("90")
                    Text("120 min").tag("120")
                    Text("180 min").tag("180")
                    Text("240 min").tag("240")
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            HStack {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Flood Advert", selection: floodAdvertBinding) {
                    Text("Disabled").tag("0")
                    Text("3 hours").tag("3")
                    Text("6 hours").tag("6")
                    Text("12 hours").tag("12")
                    Text("24 hours").tag("24")
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)
            CLIToggleRow(icon: "checkmark.message", label: "Multi-ACKs", settingKey: "multi.acks", onCommand: "set multi.acks 1", offCommand: "set multi.acks 0", session: session, sendCLI: sendCLI, canEdit: canEdit)

            if canEdit {
                HStack(spacing: 12) {
                    SaveButton(state: saveState, label: "Save Advertising") {
                        // Send owner.info, lat, lon BEFORE name —
                        // "set name" must be last (firmware may restart advert system)
                        if !ownerInfo.isEmpty { sendCLI("set owner.info \(ownerInfo)") }
                        if !lat.isEmpty { sendCLI("set lat \(lat)") }
                        if !lon.isEmpty { sendCLI("set lon \(lon)") }
                        if !name.isEmpty { sendCLI("set name \(name)") }
                        // Advert intervals handled via picker bindings
                        showSaved($saveState)
                    }

                    Spacer()

                    Button {
                        showAdvertOptions = true
                    } label: {
                        (showAdvertSent ? Label("Sent!", systemImage: "dot.radiowaves.left.and.right") : Label("Advertise", systemImage: "dot.radiowaves.left.and.right"))
                            .foregroundStyle(showAdvertSent ? .green : MeshTheme.accent)
                    }
                    .buttonStyle(.plain)
                    .contentShape(Rectangle())
                }
            }
        } header: {
            SectionInfoHeader(title: "Advertising", info: "Standard adverts are local (0-hop, 60-240 min). Flood adverts are relayed by all repeaters (min 3 hours). Minimum intervals enforced by firmware.")
        }
        .sheet(isPresented: $showMapPicker, onDismiss: {
            guard let coord = mapPickedCoordinate else { return }
            let latStr = formatCoordinate(coord.latitude)
            let lonStr = formatCoordinate(coord.longitude)
            lat = latStr
            lon = lonStr
            sendCLI("set lat \(latStr)")
            sendCLI("set lon \(lonStr)")
            showFeedback($mapPickFeedback)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                sendCLI("get lat")
                sendCLI("get lon")
            }
        }) {
            MapPointPickerView(selectedCoordinate: $mapPickedCoordinate)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 500, idealWidth: 700, minHeight: 500, idealHeight: 600)
            #endif
        }
        .confirmationDialog("Send Advertisement", isPresented: $showAdvertOptions) {
            Button("Zero-Hop (nearby only)") {
                sendCLI("advert.zerohop")
                showFeedback($showAdvertSent)
            }
            Button("Flood (entire mesh)") {
                sendCLI("advert")
                showFeedback($showAdvertSent)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Zero-hop reaches nearby nodes only. Flood is relayed by repeaters across the entire mesh network.")
        }
        .disabled(!canEdit)
    }

    private var standardAdvertBinding: Binding<String> {
        Binding(
            get: {
                if !advertInterval.isEmpty { return advertInterval }
                return session.settings["advert.interval"] ?? "120"
            },
            set: { newValue in
                advertInterval = newValue
                sendCLI("set advert.interval \(newValue)")
            }
        )
    }

    private var floodAdvertBinding: Binding<String> {
        Binding(
            get: {
                if !floodAdvertInterval.isEmpty { return floodAdvertInterval }
                return session.settings["flood.advert.interval"] ?? "3"
            },
            set: { newValue in
                floodAdvertInterval = newValue
                sendCLI("set flood.advert.interval \(newValue)")
            }
        )
    }
}
