//
//  ProfileExportService.swift
//  PommeCore
//
//  Builds MeshProfileExport from live store state and applies an imported profile
//  back to a connected radio. Commands are spaced 300 ms apart to avoid lockup.
//

import Foundation
import MeshCoreKit

enum ProfileExportService {

    // MARK: - Export

    @MainActor
    static func buildExport(deviceConfig: DeviceConfig,
                            channelStore: ChannelStore,
                            appVersion: String) -> MeshProfileExport {
        let radio = MeshProfileRadio(
            deviceName: deviceConfig.deviceName,
            advertName: deviceConfig.deviceName,
            radioFrequency: deviceConfig.radioFrequency,
            radioBandwidth: deviceConfig.radioBandwidth,
            radioSpreadingFactor: deviceConfig.radioSpreadingFactor,
            radioCodingRate: deviceConfig.radioCodingRate,
            radioTXPower: deviceConfig.radioTXPower,
            repeatMode: deviceConfig.repeatMode,
            manualAddContacts: deviceConfig.manualAddContacts,
            telemetryBase: deviceConfig.telemetryBase,
            telemetryLocation: deviceConfig.telemetryLocation,
            advertLocPolicy: deviceConfig.advertLocPolicy,
            multiACK: deviceConfig.multiACK,
            autoAddBitmask: deviceConfig.autoAddBitmask,
            defaultFloodScope: deviceConfig.defaultFloodScope,
            rxDelayBase: deviceConfig.rxDelayBase,
            airtimeFactor: deviceConfig.airtimeFactor
        )

        let channels: [MeshProfileChannel] = channelStore.channels.map { ch in
            let hex = ch.secret.map { $0.hexCompact }
            return MeshProfileChannel(index: ch.index, name: ch.name,
                                      flags: ch.flags, secretHex: hex)
        }

        return MeshProfileExport(
            version: MeshProfileExport.currentVersion,
            exportedAt: Date(),
            appVersion: appVersion,
            radio: radio,
            channels: channels,
            privateKeyHex: nil,     // reserved — serial-only, not available here
            exportedWithPIN: nil
        )
    }

    static func exportData(from profile: MeshProfileExport) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(profile)
    }

    static func exportURL(from profile: MeshProfileExport, radioName: String) throws -> URL {
        let data = try exportData(from: profile)
        let safe = radioName.replacingOccurrences(of: "[^a-zA-Z0-9_-]", with: "_",
                                                   options: .regularExpression)
        let name = safe.isEmpty ? "radio" : safe
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(name).meshprofile")
        try data.write(to: url)
        return url
    }

    // MARK: - Import

    static func parseImport(from url: URL) throws -> MeshProfileExport {
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(MeshProfileExport.self, from: data)
    }

    @MainActor
    static func applyProfile(_ profile: MeshProfileExport,
                              connectionManager: ConnectionManager,
                              channelStore: ChannelStore) async {
        let r = profile.radio
        let delay: UInt64 = 300_000_000  // 300 ms

        connectionManager.setRadioParams(
            frequency: r.radioFrequency, bandwidth: r.radioBandwidth,
            spreadingFactor: r.radioSpreadingFactor, codingRate: r.radioCodingRate,
            repeatMode: r.repeatMode)
        try? await Task.sleep(nanoseconds: delay)

        connectionManager.setRadioTXPower(r.radioTXPower)
        try? await Task.sleep(nanoseconds: delay)

        // Name lives in `deviceName` (populated from SELF_INFO). Older profiles
        // may carry an empty `advertName`, so fall back to it only if needed.
        // Never push an empty name — that would blank the radio's existing name.
        let nameToRestore = r.deviceName.isEmpty ? r.advertName : r.deviceName
        if !nameToRestore.isEmpty {
            connectionManager.setAdvertName(nameToRestore)
            try? await Task.sleep(nanoseconds: delay)
        }

        connectionManager.setOtherParams(
            manualAddContacts: r.manualAddContacts,
            telemetryBase: r.telemetryBase,
            telemetryLocation: r.telemetryLocation,
            advertLocPolicy: r.advertLocPolicy,
            multiACK: r.multiACK)
        try? await Task.sleep(nanoseconds: delay)

        connectionManager.setAutoAddConfig(bitmask: r.autoAddBitmask)
        try? await Task.sleep(nanoseconds: delay)

        if !r.defaultFloodScope.isEmpty {
            connectionManager.setDefaultFloodScope(r.defaultFloodScope)
            try? await Task.sleep(nanoseconds: delay)
        }

        if r.rxDelayBase > 0 || r.airtimeFactor > 0 {
            connectionManager.setTuningParams(rxDelayBase: r.rxDelayBase,
                                              airtimeFactor: r.airtimeFactor)
            try? await Task.sleep(nanoseconds: delay)
        }

        for ch in profile.channels where ch.index > 0 {
            let secret = ch.secretHex.flatMap { Data(hexString: $0) }
            channelStore.setChannel(index: ch.index, name: ch.name, secret: secret)
            try? await Task.sleep(nanoseconds: delay)
        }

        // Future: when firmware adds PIN-protected binary key export —
        // if let keyHex = profile.privateKeyHex, profile.exportedWithPIN == true {
        //     connectionManager.setPrivateKey(keyHex)
        //     try? await Task.sleep(nanoseconds: delay)
        // }
    }
}
