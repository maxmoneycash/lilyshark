//
//  MeshCoreProtocol.swift
//  MeshCoreKit
//
//  Frame builders for all CMD_ commands sent to the radio.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Encodes MeshCore protocol command frames for transmission to the device.
public enum MeshCoreProtocol {

    // MARK: - Connection & Query

    /// Supported companion protocol version sent with DeviceQuery.
    /// MUST be >= 3 for V3 message format (0x10/0x11 with SNR + reserved bytes).
    /// Version 1-2 uses legacy format (0x07/0x08) which lacks SNR and has different layout.
    public static let supportedProtocolVersion: UInt8 = 3

    /// CMD_APP_START (code 1) — initialize connection, returns SELF_INFO.
    /// Format: [cmd, appVer, 6×reserved, appName..., 0x00]
    public static func buildAppStart(appName: String = "PommeCore") -> Data {
        var frame = Data([MeshCoreCommand.appStart.rawValue])
        frame.append(supportedProtocolVersion)       // appVer
        frame.append(Data(repeating: 0, count: 6))   // 6 reserved bytes
        if let nameData = appName.data(using: .utf8) {
            frame.append(nameData)
        }
        frame.append(0x00) // null terminator
        return frame
    }

    /// CMD_DEVICE_QUERY (code 22) — request device info.
    /// Format: [cmd, appTargetVer]
    public static func buildDeviceQuery() -> Data {
        Data([MeshCoreCommand.deviceQuery.rawValue, supportedProtocolVersion])
    }

    /// CMD_GET_BATT_AND_STORAGE (code 20).
    public static func buildGetBattAndStorage() -> Data {
        Data([MeshCoreCommand.getBattAndStorage.rawValue])
    }

    // MARK: - Contacts & Messages

    /// CMD_GET_CONTACTS (code 4). Pass `since` for incremental sync (only contacts modified after).
    public static func buildGetContacts(since: UInt32 = 0) -> Data {
        var frame = Data([MeshCoreCommand.getContacts.rawValue])
        if since > 0 {
            appendUInt32(&frame, since)
        }
        return frame
    }

    /// CMD_ADD_UPDATE_CONTACT (code 9) — update a contact on the device.
    /// Frame: code(1) pub_key(32) type(1) flags(1) out_path_len(1) out_path(64) adv_name(32) last_advert(4) adv_lat(4) adv_lon(4)
    /// ALL fields must be populated from the existing contact to avoid zeroing data on the device.
    public static func buildAddUpdateContact(
        publicKey: Data,
        type: UInt8,
        flags: UInt8,
        outPathLen: Int8,
        outPath: Data,
        advName: String,
        lastAdvert: UInt32,
        latitude: Int32,
        longitude: Int32
    ) -> Data {
        var frame = Data([MeshCoreCommand.addUpdateContact.rawValue])
        // Full 32-byte public key
        var key = publicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        // type byte
        frame.append(type)
        // flags byte
        frame.append(flags)
        // out_path_len (signed byte)
        frame.append(UInt8(bitPattern: outPathLen))
        // out_path: 64 bytes
        var pathField = Data(repeating: 0, count: 64)
        let pathLen = min(outPath.count, 64)
        if pathLen > 0 {
            pathField.replaceSubrange(0..<pathLen, with: outPath.prefix(pathLen))
        }
        frame.append(pathField)
        // adv_name: 32 bytes null-padded
        var nameField = Data(repeating: 0, count: 32)
        if let nameData = advName.data(using: .utf8) {
            let len = min(nameData.count, 31)
            nameField.replaceSubrange(0..<len, with: nameData.prefix(len))
        }
        frame.append(nameField)
        // last_advert: uint32 LE
        appendUInt32(&frame, lastAdvert)
        // adv_lat: int32 LE
        var lat = latitude
        frame.append(Data(bytes: &lat, count: 4))
        // adv_lon: int32 LE
        var lon = longitude
        frame.append(Data(bytes: &lon, count: 4))
        return frame
    }

    /// CMD_SYNC_NEXT_MESSAGE (code 10) — pull next queued message from device.
    public static func buildSyncNextMessage() -> Data {
        Data([MeshCoreCommand.syncNextMessage.rawValue])
    }

    /// CMD_SEND_TXT_MSG (code 2).
    /// Frame: code(1) txt_type(1) attempt(1) sender_timestamp(uint32) pubkey_prefix(6) text(varchar)
    /// txt_type: 0 = plain text, 1 = CLI data (for remote management)
    public static func buildSendTextMessage(text: String, recipientKeyHash: Data, txtType: UInt8 = 0, attempt: UInt8 = 0) -> Data {
        var frame = Data([MeshCoreCommand.sendTextMessage.rawValue])
        frame.append(txtType)
        frame.append(attempt)
        appendUInt32(&frame, Date().epochUInt32)
        // pubkey_prefix: first 6 bytes of recipient's public key hash
        frame.append(recipientKeyHash.prefix(6))
        if let textData = text.data(using: .utf8) {
            frame.append(textData.prefix(160)) // max 160 bytes
        }
        return frame
    }

    /// CMD_SEND_CHANNEL_TXT_MSG (code 3).
    /// Frame: code(1) txt_type(1) channel_idx(1) sender_timestamp(uint32) text(varchar)
    public static func buildSendChannelMessage(text: String, channelIndex: UInt8 = 0, txtType: UInt8 = 0) -> Data {
        var frame = Data([MeshCoreCommand.sendChannelMessage.rawValue])
        frame.append(txtType)
        frame.append(channelIndex)
        appendUInt32(&frame, Date().epochUInt32)
        if let textData = text.data(using: .utf8) {
            frame.append(textData.prefix(160))
        }
        return frame
    }

    // MARK: - Remote Management

    /// CMD_SEND_LOGIN (code 26) — login to a remote device (repeater/room server).
    /// Frame: code(1) pub_key(32) password(varchar, null-terminated, max 15 bytes)
    public static func buildSendLogin(recipientPublicKey: Data, password: String) -> Data {
        var frame = Data([MeshCoreCommand.sendLogin.rawValue])
        // Full 32-byte public key required (not the 6-byte prefix)
        var key = recipientPublicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        if let pwData = password.data(using: .utf8) {
            frame.append(pwData.prefix(15)) // max 15 bytes
        }
        frame.append(0x00) // null terminator
        return frame
    }

    /// CMD_SEND_STATUS_REQ (code 27) — request status from a remote device.
    /// Frame: code(1) pub_key(32)
    public static func buildSendStatusReq(recipientPublicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.sendStatusReq.rawValue])
        var key = recipientPublicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// Send a CLI command to a remote device as txt_type=1 (TXT_TYPE_CLI_DATA).
    public static func buildSendCLICommand(command: String, recipientKeyHash: Data) -> Data {
        buildSendTextMessage(text: command, recipientKeyHash: recipientKeyHash, txtType: 1)
    }

    // MARK: - Contact Management

    /// CMD_REMOVE_CONTACT (code 15) — remove a contact by 32-byte public key.
    public static func buildRemoveContact(publicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.removeContact.rawValue])
        var key = publicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// CMD_RESET_PATH (code 13) — reset outbound path for a contact.
    public static func buildResetPath(publicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.resetPath.rawValue])
        var key = publicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// CMD_SHARE_CONTACT (code 16) — zero-hop share a contact's advert on the mesh.
    public static func buildShareContact(publicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.shareContact.rawValue])
        var key = publicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// CMD_EXPORT_CONTACT (code 17) — export a contact as a meshcore:// URL.
    public static func buildExportContact(publicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.exportContact.rawValue])
        var key = publicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// CMD_IMPORT_CONTACT (code 18) — import a contact from a meshcore:// URL string.
    public static func buildImportContact(url: String) -> Data {
        var frame = Data([MeshCoreCommand.importContact.rawValue])
        if let urlData = url.data(using: .utf8) {
            frame.append(urlData)
        }
        frame.append(0x00) // null terminator
        return frame
    }

    // MARK: - Channels

    /// CMD_GET_CHANNEL (code 31) — request channel info by index.
    /// Frame: code(1) channel_idx(1)
    public static func buildGetChannel(index: UInt8) -> Data {
        Data([MeshCoreCommand.getChannel.rawValue, index])
    }

    /// CMD_SET_CHANNEL (code 32) — add or update a channel.
    /// Frame: code(1) channel_idx(1) channel_name(32 null-padded) secret(32 null-padded)
    public static func buildSetChannel(index: UInt8, name: String, secret: Data? = nil) -> Data {
        var frame = Data([MeshCoreCommand.setChannel.rawValue])
        frame.append(index)
        // channel_name: 32 bytes null-padded
        var nameField = Data(repeating: 0, count: 32)
        if let nameData = name.data(using: .utf8) {
            let len = min(nameData.count, 31)
            nameField.replaceSubrange(0..<len, with: nameData.prefix(len))
        }
        frame.append(nameField)
        // secret/PSK: 16 bytes (128-bit key, matching meshcore.js format)
        var secretField = Data(repeating: 0, count: 16)
        if let secret, !secret.isEmpty {
            let len = min(secret.count, 16)
            secretField.replaceSubrange(0..<len, with: secret.prefix(len))
        }
        frame.append(secretField)
        return frame
    }

    // MARK: - Identity & Advertising

    /// CMD_SET_ADVERT_NAME (code 8).
    public static func buildSetAdvertName(_ name: String) -> Data {
        var frame = Data([MeshCoreCommand.setAdvertName.rawValue])
        if let nameData = name.data(using: .utf8) {
            frame.append(nameData)
        }
        frame.append(0x00) // null terminator
        return frame
    }

    /// CMD_SET_ADVERT_LATLON (code 14). Lat/lon encoded as int32 × 1,000,000.
    public static func buildSetAdvertLatLon(latitude: Double, longitude: Double) -> Data {
        var frame = Data([MeshCoreCommand.setAdvertLatLon.rawValue])
        appendInt32(&frame, Int32(latitude * 1_000_000))
        appendInt32(&frame, Int32(longitude * 1_000_000))
        return frame
    }

    /// CMD_SEND_SELF_ADVERT (code 7). advertType: 0=zero-hop, 1=flood.
    public static func buildSendSelfAdvert(advertType: UInt8 = 0) -> Data {
        Data([MeshCoreCommand.sendSelfAdvert.rawValue, advertType])
    }

    // MARK: - Radio Configuration

    /// CMD_SET_RADIO_PARAMS (code 11).
    public static func buildSetRadioParams(
        frequency: UInt32,
        bandwidth: UInt32,
        spreadingFactor: UInt8,
        codingRate: UInt8,
        repeatMode: Bool = false
    ) -> Data {
        var frame = Data([MeshCoreCommand.setRadioParams.rawValue])
        appendUInt32(&frame, frequency)
        appendUInt32(&frame, bandwidth)
        frame.append(spreadingFactor)
        frame.append(codingRate)
        frame.append(repeatMode ? 1 : 0)
        return frame
    }

    /// CMD_SET_RADIO_TX_POWER (code 12).
    public static func buildSetRadioTXPower(_ power: UInt8) -> Data {
        Data([MeshCoreCommand.setRadioTXPower.rawValue, power])
    }

    // MARK: - Tuning Parameters

    /// CMD_SET_TUNING_PARAMS (code 21).
    /// Frame: code(1) rx_delay_base(uint32 LE, *1000) airtime_factor(uint32 LE, *1000) padding(2 bytes zero)
    /// NOTE: Only rx_delay and airtime_factor are in this command. Flood max hops is set via CLI.
    public static func buildSetTuningParams(rxDelayBase: UInt32, airtimeFactor: UInt32) -> Data {
        var frame = Data([MeshCoreCommand.setTuningParams.rawValue])
        appendUInt32(&frame, rxDelayBase)
        appendUInt32(&frame, airtimeFactor)
        frame.append(0x00) // padding
        frame.append(0x00) // padding
        return frame
    }

    /// CMD_GET_TUNING_PARAMS (code 43).
    public static func buildGetTuningParams() -> Data {
        Data([MeshCoreCommand.getTuningParams.rawValue])
    }

    // MARK: - Privacy & Security

    /// CMD_SET_OTHER_PARAMS (code 38).
    /// Packs: manualAddContacts, telemetryMode, advertLocPolicy, multiACK.
    public static func buildSetOtherParams(
        manualAddContacts: UInt8,
        telemetryBase: UInt8,
        telemetryLocation: UInt8,
        advertLocPolicy: UInt8,
        multiACK: UInt8
    ) -> Data {
        var frame = Data([MeshCoreCommand.setOtherParams.rawValue])
        frame.append(manualAddContacts)
        let telemetryByte = (telemetryBase & 0x03) | ((telemetryLocation & 0x03) << 2)
        frame.append(telemetryByte)
        frame.append(advertLocPolicy)
        frame.append(multiACK)
        return frame
    }

    /// CMD_SET_DEVICE_PIN (code 37).
    public static func buildSetDevicePIN(_ pin: UInt32) -> Data {
        var frame = Data([MeshCoreCommand.setDevicePIN.rawValue])
        appendUInt32(&frame, pin)
        return frame
    }

    // MARK: - Time

    /// CMD_GET_DEVICE_TIME (code 5).
    public static func buildGetDeviceTime() -> Data {
        Data([MeshCoreCommand.getDeviceTime.rawValue])
    }

    /// CMD_SET_DEVICE_TIME (code 6).
    public static func buildSetDeviceTime(epochSeconds: UInt32) -> Data {
        var frame = Data([MeshCoreCommand.setDeviceTime.rawValue])
        appendUInt32(&frame, epochSeconds)
        return frame
    }

    // MARK: - Custom Variables

    /// CMD_GET_CUSTOM_VARS (code 40).
    public static func buildGetCustomVars() -> Data {
        Data([MeshCoreCommand.getCustomVars.rawValue])
    }

    /// CMD_SET_CUSTOM_VAR (code 41). Format: "name:value\0"
    public static func buildSetCustomVar(name: String, value: String) -> Data {
        var frame = Data([MeshCoreCommand.setCustomVar.rawValue])
        if let payload = "\(name):\(value)".data(using: .utf8) {
            frame.append(payload)
        }
        frame.append(0x00)
        return frame
    }

    // MARK: - Statistics

    /// CMD_GET_STATS (code 56). subType: 0=core, 1=radio, 2=packets.
    public static func buildGetStats(subType: UInt8) -> Data {
        Data([MeshCoreCommand.getStats.rawValue, subType])
    }

    /// CMD_SET_AUTOADD_CONFIG (code 58).
    /// Bitmask: bit 0 = chat users, bit 1 = repeaters, bit 2 = room servers, bit 3 = sensors.
    public static func buildSetAutoAddConfig(bitmask: UInt8) -> Data {
        Data([MeshCoreCommand.setAutoAddConfig.rawValue, bitmask])
    }

    /// CMD_GET_AUTOADD_CONFIG (code 59) — read current auto-add config.
    /// Separate command from SET (58). Sending SET with no payload corrupts device config!
    public static func buildGetAutoAddConfig() -> Data {
        Data([MeshCoreCommand.getAutoAddConfig.rawValue])
    }

    // MARK: - Default Flood Scope (firmware 1.15.0+)

    /// CMD_GET_DEFAULT_FLOOD_SCOPE (code 64) — request current default flood scope region name.
    public static func buildGetDefaultFloodScope() -> Data {
        Data([MeshCoreCommand.getDefaultFloodScope.rawValue])
    }

    /// CMD_SET_DEFAULT_FLOOD_SCOPE (code 63) — set default flood scope region name.
    /// Pass an empty string to clear the default scope.
    public static func buildSetDefaultFloodScope(name: String) -> Data {
        var frame = Data([MeshCoreCommand.setDefaultFloodScope.rawValue])
        if !name.isEmpty, let payload = name.data(using: .utf8) {
            frame.append(payload)
        }
        frame.append(0x00)
        return frame
    }

    // MARK: - Discovery & Diagnostics

    /// CMD_SEND_PATH_DISCOVERY_REQ (code 52 / 0x34) — flood path discovery to a contact.
    /// Frame: code(1) reserved(1) pub_key(32)
    /// Firmware floods a telemetry request, then sends PUSH_CODE_PATH_DISCOVERY_RESPONSE (0x8D) with bidirectional path.
    public static func buildSendPathDiscoveryReq(publicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.sendPathDiscoveryReq.rawValue, 0x00])
        var key = publicKey.prefix(32)
        if key.count < 32 { key.append(Data(repeating: 0, count: 32 - key.count)) }
        frame.append(key)
        return frame
    }

    /// CMD_SEND_CONTROL_DATA (code 55) — send a control packet.
    /// For discover: flags=0, sub_type=0x80 (DISCOVER_REQ), no payload.
    /// Frame: code(1) flags(1) sub_type(1)
    public static func buildSendDiscover() -> Data {
        Data([MeshCoreCommand.sendControlData.rawValue, 0x00, 0x80])
    }

    /// CMD_SEND_TRACE_PATH (code 36) — trace route to a contact.
    /// Frame: code(1) tag(uint32) auth_code(uint32) flags(1) path(hop hashes)
    /// The path field contains the 6-byte hop hashes from the contact's out_path.
    public static func buildSendTracePath(outPath: Data, tag: UInt32? = nil) -> Data {
        var frame = Data([MeshCoreCommand.sendTracePath.rawValue])
        let traceTag = tag ?? UInt32.random(in: 0..<UInt32.max)
        appendUInt32(&frame, traceTag)
        appendUInt32(&frame, 0) // auth_code
        frame.append(0x00) // flags
        frame.append(outPath)
        return frame
    }

    /// CMD_SEND_TELEMETRY_REQ (code 39) — request telemetry from a sensor contact.
    /// Frame: code(1) reserved(3) pub_key(32)
    public static func buildSendTelemetryReq(recipientPublicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.sendTelemetryReq.rawValue])
        frame.append(Data(repeating: 0, count: 3)) // reserved
        var key = recipientPublicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// CMD_GET_ADVERT_PATH (code 42) — get last known path to a contact.
    /// Frame: code(1) reserved(1) pub_key(32) = 34 bytes total
    public static func buildGetAdvertPath(publicKey: Data) -> Data {
        var frame = Data([MeshCoreCommand.getAdvertPath.rawValue])
        frame.append(0x00) // reserved byte
        var key = publicKey.prefix(32)
        if key.count < 32 {
            key.append(Data(repeating: 0, count: 32 - key.count))
        }
        frame.append(key)
        return frame
    }

    /// CMD_GET_ALLOWED_REPEAT_FREQ (code 60).
    public static func buildGetAllowedRepeatFreq() -> Data {
        Data([MeshCoreCommand.getAllowedRepeatFreq.rawValue])
    }

    // MARK: - Raw & Binary

    /// CMD_SEND_RAW_DATA (code 0x19) — transmit a raw LoRa payload with an optional routing path.
    /// Frame: code(1) payload(N) path(M)
    public static func buildSendRawData(payload: Data, path: Data = Data()) -> Data {
        var frame = Data([MeshCoreCommand.sendRawData.rawValue])
        frame.append(payload)
        frame.append(path)
        return frame
    }

    /// CMD_SEND_BINARY_REQ (code 0x32) — send a binary request to the device.
    /// The device responds with RESP_CODE_SENT(0x06) containing a TAG, then fires
    /// PUSH_CODE_BINARY_RESPONSE(0x8C) with that TAG when the response is ready.
    /// Frame: code(1) payload(N)
    public static func buildSendBinaryReq(_ payload: Data) -> Data {
        var frame = Data([MeshCoreCommand.sendBinaryReq.rawValue])
        frame.append(payload)
        return frame
    }

    // MARK: - Danger Zone

    /// CMD_REBOOT (code 19).
    public static func buildReboot() -> Data {
        var frame = Data([MeshCoreCommand.reboot.rawValue])
        frame.append(contentsOf: "reboot".utf8)
        return frame
    }

    /// CMD_FACTORY_RESET (code 51).
    public static func buildFactoryReset() -> Data {
        var frame = Data([MeshCoreCommand.factoryReset.rawValue])
        frame.append(contentsOf: "reset".utf8)
        return frame
    }

    // MARK: - Signing (Device-Side Ed25519)

    /// CMD_SIGN_START (code 0x21) — initialize device signing session.
    /// Response: RESP_CODE_SIGN_START (0x13) with max buffer length.
    public static func buildSignStart() -> Data {
        Data([MeshCoreCommand.signStart.rawValue])
    }

    /// CMD_SIGN_DATA (code 0x22) — send a chunk of data to sign.
    /// BLE max chunk: 120 bytes per frame. Send multiple frames for larger data.
    public static func buildSignData(chunk: Data) -> Data {
        var frame = Data([MeshCoreCommand.signData.rawValue])
        frame.append(chunk)
        return frame
    }

    /// CMD_SIGN_FINISH (code 0x23) — finalize and get Ed25519 signature.
    /// Response: RESP_CODE_SIGNATURE (0x14) with 64-byte signature.
    public static func buildSignFinish() -> Data {
        Data([MeshCoreCommand.signFinish.rawValue])
    }

    // MARK: - Helpers

    private static func appendUInt32(_ data: inout Data, _ value: UInt32) {
        var le = value.littleEndian
        data.append(Data(bytes: &le, count: 4))
    }

    private static func appendInt32(_ data: inout Data, _ value: Int32) {
        var le = value.littleEndian
        data.append(Data(bytes: &le, count: 4))
    }
}
