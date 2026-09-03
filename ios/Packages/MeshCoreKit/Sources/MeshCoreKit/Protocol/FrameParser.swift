//
//  FrameParser.swift
//  MeshCoreKit
//
//  Parses binary response and push frames from MeshCore firmware.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import os.log

/// Parses incoming binary frames from the MeshCore device.
public enum FrameParser {

    private static let logger = Logger(subsystem: "com.pommecore", category: "FrameParser")

    /// Parsed response from the device.
    public enum ParsedResponse: Sendable {
        case ok
        case error(code: UInt8, description: String)
        case selfInfo(SelfInfoPayload)
        case deviceInfo(DeviceInfoPayload)
        case battAndStorage(BattStoragePayload)
        case currentTime(UInt32)
        case tuningParams(rxDelayBase: UInt32, airtimeFactor: UInt32)
        case customVars(String)
        case stats(subType: UInt8, payload: Data)
        case contactsStart(count: UInt32)             // RESP_CODE_CONTACTS_START (code 2)
        case contact(Contact)                          // RESP_CODE_CONTACT (code 3)
        case endOfContacts(lastmod: UInt32)            // RESP_CODE_END_OF_CONTACTS (code 4)
        case sent(type: UInt8, expectedACK: UInt32, suggestedTimeout: UInt32) // RESP_CODE_SENT (code 6)
        case contactMsgRecv(Message)                   // RESP_CODE_CONTACT_MSG_RECV_V3 (code 16)
        case channelMsgRecv(Message)                   // RESP_CODE_CHANNEL_MSG_RECV_V3 (code 17)
        case noMoreMessages                            // RESP_CODE_NO_MORE_MESSAGES (code 10)
        case currentAdvert(Data)
        case rawData(Data)                                     // PUSH_CODE_RAW_DATA (0x84)
        case logRxData(snr: Int8, rssi: Int8, rawBytes: Data)  // PUSH_CODE_LOG_RX_DATA (0x88)
        case binaryResponse(tag: UInt32, payload: Data)        // PUSH_CODE_BINARY_RESPONSE (0x8C)
        case sendConfirmed(ackCode: UInt32, roundTripMs: UInt32)  // PUSH_CODE_SEND_CONFIRMED (0x82)
        case msgWaiting                                // PUSH_CODE_MSG_WAITING (0x83)
        case advert(Contact)                           // PUSH_CODE_ADVERT (0x80)
        case pathUpdated(publicKey: Data)              // PUSH_CODE_PATH_UPDATED (0x81)
        case loginSuccess(permissionLevel: Int)         // PUSH_CODE_LOGIN_SUCCESS (0x85)
        case loginFail                                 // PUSH_CODE_LOGIN_FAIL (0x86)
        case statusResponse(RemoteStatusInfo)           // PUSH_CODE_STATUS_RESPONSE (0x87)
        case traceData(TraceResult)                    // PUSH_CODE_TRACE_DATA (0x89)
        case newAdvert(Contact)                        // PUSH_CODE_NEW_ADVERT (0x8A)
        case telemetryResponse(senderKey: Data, readings: [TelemetryReading]) // PUSH_CODE_TELEMETRY_RESPONSE (0x8B)
        case pathDiscovery(PathDiscoveryResult)                // PUSH_CODE_PATH_DISCOVERY_RESPONSE (0x8D)
        case controlData(snr: Int8, rssi: Int8, pathLen: UInt8, payload: Data) // PUSH_CODE_CONTROL_DATA (0x8E)
        case channelInfo(MeshChannel)                 // RESP_CODE_CHANNEL_INFO (code 18)
        case exportedContact(url: String)             // RESP_CODE_EXPORTED_CONTACT (code 20)
        case advertPath(AdvertPathInfo)               // RESP_CODE_ADVERT_PATH (code 22)
        case allowedRepeatFreq([FrequencyRange])      // RESP_ALLOWED_REPEAT_FREQ (code 26)
        case contactDeleted(publicKey: Data)          // PUSH_CODE_CONTACT_DELETED (0x8F)
        case contactsFull(maxContacts: UInt16)        // PUSH_CODE_CONTACTS_FULL (0x90)
        case autoAddConfig(bitmask: UInt8, maxHops: UInt8)  // RESP_CODE_AUTOADD_CONFIG (0x19)
        case signStartResp(maxLength: UInt32)              // RESP_CODE_SIGN_START (0x13)
        case signatureResp(signature: Data)                // RESP_CODE_SIGNATURE (0x14)
        case defaultFloodScope(name: String)               // RESP_CODE_DEFAULT_FLOOD_SCOPE (0x1C, firmware 1.15.0+)
        case unknown(type: UInt8, payload: Data)
    }

    // MARK: - Payload Structs

    /// RESP_CODE_SELF_INFO (code 5) — returned after CMD_APP_START.
    public struct SelfInfoPayload: Sendable {
        public let type: UInt8
        public let txPower: UInt8
        public let maxTXPower: UInt8
        public let publicKey: Data
        public let latitude: Double
        public let longitude: Double
        public let multiACK: UInt8
        public let advertLocPolicy: UInt8
        public let telemetryByte: UInt8
        public let manualAddContacts: UInt8
        public let radioFreq: UInt32
        public let radioBW: UInt32
        public let radioSF: UInt8
        public let radioCR: UInt8
        public let name: String
        public let rawData: Data
    }

    /// RESP_CODE_DEVICE_INFO (code 13) — returned after CMD_DEVICE_QUERY.
    public struct DeviceInfoPayload: Sendable {
        public let firmwareVersion: UInt8
        public let maxContactsDiv2: UInt8
        public let maxChannels: UInt8
        public let blePIN: UInt32
        public let buildDate: String
        public let manufacturer: String
        public let semanticVersion: String
        public let rawData: Data
    }

    /// RESP_CODE_BATT_AND_STORAGE (code 12).
    public struct BattStoragePayload: Sendable {
        public let batteryMV: UInt16
    }

    // MARK: - Parse

    public static func parse(_ data: Data) -> ParsedResponse {
        guard let firstByte = data.first else {
            return .unknown(type: 0, payload: Data())
        }

        let payload = Data(data.dropFirst())
        let hex = data.hexFormatted()
        logger.info("Parse frame [\(data.count) bytes] code=0x\(String(format: "%02x", firstByte)): \(hex)")

        // Check push codes first (high bit set, 0x80+ range)
        if firstByte >= 0x80 {
            if let pushCode = MeshCorePushCode(rawValue: firstByte) {
                return parsePushCode(pushCode, payload: payload)
            }
            // Unknown push code — log and ignore
            logger.debug("Received push notification 0x\(String(format: "%02x", firstByte)) (undocumented), \(payload.count) bytes payload")
            return .unknown(type: firstByte, payload: payload)
        }

        guard let code = MeshCoreResponseCode(rawValue: firstByte) else {
            logger.warning("Unknown response code 0x\(String(format: "%02x", firstByte))")
            return .unknown(type: firstByte, payload: payload)
        }

        switch code {
        case .ok:
            return .ok

        case .err:
            let errCode = payload.first ?? 0
            let errEnum = MeshCoreErrorCode(rawValue: errCode)
            let desc = errEnum?.description ?? "Unknown error (\(errCode))"
            logger.warning("RESP_CODE_ERR: code=\(errCode) (\(desc))")
            return .error(code: errCode, description: desc)

        case .selfInfo:
            return parseSelfInfo(payload)

        case .deviceInfo:
            return parseDeviceInfoResponse(payload)

        case .battAndStorage:
            return parseBattAndStorage(payload)

        case .currTime:
            return parseCurrentTime(payload)

        case .tuningParams:
            return parseTuningParams(payload)

        case .exportedContact:
            if payload.isEmpty {
                logger.warning("ExportedContact: empty payload")
                return .exportedContact(url: "")
            }
            // Firmware returns raw advert packet bytes, NOT a URL string.
            // Format as meshcore:// + hex-encoded card data.
            let hex = payload.hexCompact
            let url = "meshcore://\(hex)"
            logger.info("ExportedContact: \(payload.count) raw bytes → url='\(url.prefix(80))'")
            return .exportedContact(url: url)

        case .customVars:
            let str = String(data: payload, encoding: .utf8) ?? ""
            return .customVars(str)

        case .stats:
            let subType: UInt8 = payload.isEmpty ? 0 : payload[0]
            return .stats(subType: subType, payload: Data(payload.dropFirst()))

        case .contactsStart:
            return parseContactsStart(payload)

        case .contact:
            return parseContactFull(payload)

        case .endOfContacts:
            return parseEndOfContacts(payload)

        case .sent:
            return parseSentResponse(payload)

        case .contactMsgRecv:
            return parseContactMsgRecv(payload)

        case .contactMsgRecvV3:
            return parseContactMsgRecvV3(payload)

        case .channelMsgRecv:
            return parseChannelMsgRecvV1(payload)

        case .channelMsgRecvV3:
            return parseChannelMsgRecvV3(payload)

        case .channelInfo:
            return parseChannelInfo(payload)

        case .noMoreMessages:
            return .noMoreMessages

        case .privateKey:
            logger.info("RESP_CODE_PRIVATE_KEY: \(payload.count) bytes (not handled)")
            return .unknown(type: firstByte, payload: payload)

        case .disabled:
            logger.info("RESP_CODE_DISABLED received")
            return .unknown(type: firstByte, payload: payload)

        case .signStart:
            var offset = 0
            _ = readUInt8(payload, offset: &offset) // reserved byte
            let maxLen = readUInt32(payload, offset: &offset)
            logger.info("RESP_CODE_SIGN_START: maxLength=\(maxLen)")
            return .signStartResp(maxLength: maxLen)

        case .signature:
            // 64-byte Ed25519 signature
            let sig = Data(payload.prefix(64))
            logger.info("RESP_CODE_SIGNATURE: \(sig.count) bytes")
            return .signatureResp(signature: sig)

        case .advertPath:
            return parseAdvertPath(payload)

        case .autoAddConfig:
            var offset = 0
            let bitmask = readUInt8(payload, offset: &offset)
            let maxHops = readUInt8(payload, offset: &offset)
            logger.info("AutoAddConfig: bitmask=0x\(String(format: "%02x", bitmask)) maxHops=\(maxHops) (chat=\(bitmask & 0x01 != 0), repeater=\(bitmask & 0x02 != 0), room=\(bitmask & 0x04 != 0), sensor=\(bitmask & 0x08 != 0))")
            return .autoAddConfig(bitmask: bitmask, maxHops: maxHops)

        case .allowedRepeatFreq:
            return parseAllowedRepeatFreq(payload)

        case .defaultFloodScope:
            return parseDefaultFloodScope(payload)
        }
    }

    // MARK: - Push Code Dispatch

    private static func parsePushCode(_ pushCode: MeshCorePushCode, payload: Data) -> ParsedResponse {
        switch pushCode {
        case .advert:
            return parseAdvertPush(payload)

        case .pathUpdated:
            // Contains 32-byte public key of the contact whose path changed
            let key = payload.count >= 32 ? Data(payload.prefix(32)) : payload
            logger.info("PathUpdated: key=\(Data(key.prefix(6)).hexCompact)")
            return .pathUpdated(publicKey: key)

        case .sendConfirmed:
            return parseSendConfirmed(payload)

        case .msgWaiting:
            return .msgWaiting

        case .loginSuccess:
            // Frame layout (after code byte):
            //   [0]     old_permissions (1 byte, isAdmin flag in bit 0)
            //   [1-6]   pub_key_prefix (6 bytes)
            //   [7-10]  tag (int32)
            //   [11]    new_permissions (v7+: 0=Guest, 1=ReadOnly, 2=ReadWrite, 3=Admin)
            let permissionLevel: Int
            if payload.count >= 12 {
                // v7+ firmware: use new_permissions byte (byte 11 of payload)
                permissionLevel = Int(payload[11])
            } else {
                // Old firmware: derive from isAdmin flag
                let oldPerms = payload.first ?? 0
                permissionLevel = (oldPerms & 1) == 1 ? 3 : 0
            }
            logger.info("LoginSuccess: permissionLevel=\(permissionLevel) (payload \(payload.count) bytes)")
            return .loginSuccess(permissionLevel: permissionLevel)

        case .loginFail:
            logger.info("LoginFail")
            return .loginFail

        case .statusResponse:
            return parseStatusResponse(payload)

        case .traceData:
            return parseTraceData(payload)

        case .newAdvert:
            // Same format as RESP_CODE_CONTACT — a new contact discovered in manual_add mode
            let contactResponse = parseContactFull(payload)
            if case .contact(let contact) = contactResponse {
                logger.info("NewAdvert (manual_add): \(contact.name)")
                return .newAdvert(contact)
            }
            return .unknown(type: MeshCorePushCode.newAdvert.rawValue, payload: payload)

        case .telemetryResponse:
            return parseTelemetryResponse(payload)

        case .controlData:
            return parseControlData(payload)

        case .rawData:
            logger.debug("RawData: \(payload.count) bytes")
            return .rawData(payload)

        case .logRxData:
            let snr = payload.count > 0 ? Int8(bitPattern: payload[0]) : 0
            let rssi = payload.count > 1 ? Int8(bitPattern: payload[1]) : 0
            let rawBytes = payload.count > 2 ? Data(payload[2...]) : Data()
            logger.debug("LogRxData: snr=\(Float(snr)/4.0) rssi=\(rssi) rawLen=\(rawBytes.count)")
            return .logRxData(snr: snr, rssi: rssi, rawBytes: rawBytes)

        case .binaryResponse:
            var offset = 0
            let tag = readUInt32(payload, offset: &offset)
            let responseData = offset < payload.count ? Data(payload[offset...]) : Data()
            logger.debug("BinaryResponse: tag=\(tag) payload=\(responseData.count) bytes")
            return .binaryResponse(tag: tag, payload: responseData)

        case .pathDiscoveryResp:
            return parsePathDiscoveryResp(payload)

        case .contactDeleted:
            let key = payload.count >= 32 ? Data(payload.prefix(32)) : payload
            logger.info("ContactDeleted: key=\(Data(key.prefix(6)).hexCompact)")
            return .contactDeleted(publicKey: key)

        case .contactsFull:
            // Firmware sends just the code byte with no payload
            logger.warning("ContactsFull: device contact storage is full")
            return .contactsFull(maxContacts: 0)
        }
    }

    // MARK: - Self Info (code 5)

    private static func parseSelfInfo(_ data: Data) -> ParsedResponse {
        var offset = 0

        let type = readUInt8(data, offset: &offset)
        let txPower = readUInt8(data, offset: &offset)
        let maxTXPower = readUInt8(data, offset: &offset)

        let pubKeyLen = min(32, data.count - offset)
        let publicKey: Data
        if pubKeyLen > 0 {
            publicKey = Data(data[offset..<offset+pubKeyLen])
            offset += pubKeyLen
        } else {
            publicKey = Data()
        }

        let latRaw = readInt32(data, offset: &offset)
        let lonRaw = readInt32(data, offset: &offset)
        let latitude = Double(latRaw) / 1_000_000.0
        let longitude = Double(lonRaw) / 1_000_000.0

        let multiACK = readUInt8(data, offset: &offset)
        let advertLocPolicy = readUInt8(data, offset: &offset)
        let telemetryByte = readUInt8(data, offset: &offset)
        let manualAddContacts = readUInt8(data, offset: &offset)

        let freq = readUInt32(data, offset: &offset)
        let bw = readUInt32(data, offset: &offset)
        let sf = readUInt8(data, offset: &offset)
        let cr = readUInt8(data, offset: &offset)

        let name: String
        if offset < data.count {
            name = String(data: Data(data[offset...]), encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) ?? ""
        } else {
            name = ""
        }

        logger.info("SelfInfo: type=\(type) txPwr=\(txPower)/\(maxTXPower) lat=\(latitude) lon=\(longitude) freq=\(freq) bw=\(bw) sf=\(sf) cr=\(cr) name='\(name)'")

        let payload = SelfInfoPayload(
            type: type,
            txPower: txPower,
            maxTXPower: maxTXPower,
            publicKey: publicKey,
            latitude: latitude,
            longitude: longitude,
            multiACK: multiACK,
            advertLocPolicy: advertLocPolicy,
            telemetryByte: telemetryByte,
            manualAddContacts: manualAddContacts,
            radioFreq: freq,
            radioBW: bw,
            radioSF: sf,
            radioCR: cr,
            name: name,
            rawData: data
        )
        return .selfInfo(payload)
    }

    // MARK: - Device Info (code 13)

    private static func parseDeviceInfoResponse(_ data: Data) -> ParsedResponse {
        var offset = 0

        let firmwareVer = readUInt8(data, offset: &offset)
        let maxContactsDiv2 = readUInt8(data, offset: &offset)
        let maxChannels = readUInt8(data, offset: &offset)
        let blePIN = readUInt32(data, offset: &offset)

        let buildDate = readFixedString(data, offset: &offset, maxLen: 12)
        let manufacturer = readFixedString(data, offset: &offset, maxLen: 40)
        let semanticVersion = readFixedString(data, offset: &offset, maxLen: 20)

        logger.info("DeviceInfo: fwVer=\(firmwareVer) maxContacts=\(Int(maxContactsDiv2) * 2) maxCh=\(maxChannels) blePIN=\(blePIN) buildDate='\(buildDate)' mfg='\(manufacturer)' semVer='\(semanticVersion)'")

        let payload = DeviceInfoPayload(
            firmwareVersion: firmwareVer,
            maxContactsDiv2: maxContactsDiv2,
            maxChannels: maxChannels,
            blePIN: blePIN,
            buildDate: buildDate,
            manufacturer: manufacturer,
            semanticVersion: semanticVersion,
            rawData: data
        )
        return .deviceInfo(payload)
    }

    // MARK: - Battery & Storage (code 12)

    private static func parseBattAndStorage(_ data: Data) -> ParsedResponse {
        var offset = 0
        let batt = readUInt16(data, offset: &offset)
        logger.info("BattAndStorage: \(batt) mV")
        return .battAndStorage(BattStoragePayload(batteryMV: batt))
    }

    // MARK: - Time (code 9)

    private static func parseCurrentTime(_ data: Data) -> ParsedResponse {
        var offset = 0
        let epoch = readUInt32(data, offset: &offset)
        return .currentTime(epoch)
    }

    // MARK: - Tuning Params (code 23)

    private static func parseTuningParams(_ data: Data) -> ParsedResponse {
        var offset = 0
        let rxDelay = readUInt32(data, offset: &offset)
        let airtime = readUInt32(data, offset: &offset)
        // Remaining bytes are padding (protocol only has rx_delay + airtime_factor)
        logger.info("TuningParams: rxDelay=\(rxDelay) airtime=\(airtime) (payload=\(data.count) bytes)")
        return .tuningParams(rxDelayBase: rxDelay, airtimeFactor: airtime)
    }

    // MARK: - Contacts Protocol

    /// RESP_CODE_CONTACTS_START (code 2) — start of contact list.
    /// Layout: count(uint32)
    private static func parseContactsStart(_ data: Data) -> ParsedResponse {
        var offset = 0
        let count = readUInt32(data, offset: &offset)
        logger.info("ContactsStart: count=\(count)")
        return .contactsStart(count: count)
    }

    /// RESP_CODE_CONTACT (code 3) — individual contact data.
    /// Layout: publicKey(32) type(1) flags(1) outPathLen(1 signed) outPath(64)
    ///         advName(32 null-terminated) lastAdvert(uint32) advLat(int32) advLon(int32) lastmod(uint32)
    private static func parseContactFull(_ data: Data) -> ParsedResponse {
        var offset = 0

        // public_key: 32 bytes
        let keyLen = min(32, data.count - offset)
        let publicKey: Data
        if keyLen > 0 {
            publicKey = Data(data[offset..<offset+keyLen])
            offset += keyLen
        } else {
            publicKey = Data()
        }

        // type: 1 byte
        let contactType = readUInt8(data, offset: &offset)

        // flags: 1 byte
        let flags = readUInt8(data, offset: &offset)

        // out_path_len: 1 byte (signed)
        let outPathLen = Int8(bitPattern: readUInt8(data, offset: &offset))

        // out_path: 64 bytes of routing hashes (needed for trace route)
        // Byte encoding: lower 6 bits = hash_count, upper 2 bits = hash_mode
        // hash_size = (hash_mode >> 6) + 1  → 1, 2, 4, or 8 bytes per hash
        // meaningful bytes = hash_count * hash_size
        let pathDataLen = min(64, data.count - offset)
        let outPath: Data
        if pathDataLen > 0 && outPathLen > 0 {
            let raw = UInt8(bitPattern: outPathLen)
            let hashCount = Int(raw & 0x3F)
            let hashSize = Int(raw >> 6) + 1
            let meaningfulLen = min(hashCount * hashSize, pathDataLen)
            outPath = Data(data[offset..<offset+meaningfulLen])
        } else {
            outPath = Data()
        }
        offset += pathDataLen

        // adv_name: 32 bytes null-terminated fixed field
        let name = readFixedString(data, offset: &offset, maxLen: 32)

        // last_advert: uint32 (epoch seconds)
        let lastAdvert = readUInt32(data, offset: &offset)

        // adv_lat: int32 (degrees × 1,000,000)
        let latRaw = readInt32(data, offset: &offset)
        let latitude = Double(latRaw) / 1_000_000.0

        // adv_lon: int32 (degrees × 1,000,000)
        let lonRaw = readInt32(data, offset: &offset)
        let longitude = Double(lonRaw) / 1_000_000.0

        // lastmod: uint32
        let lastmod = readUInt32(data, offset: &offset)

        let type = ContactType(rawValue: contactType) ?? .unknown

        logger.info("Contact: name='\(name)' type=\(contactType) flags=\(flags) pathLen=\(outPathLen) lastAdvert=\(lastAdvert) lat=\(latitude) lon=\(longitude) lastmod=\(lastmod)")

        let contact = Contact(
            publicKey: publicKey,
            name: name,
            type: type,
            flags: flags,
            outPathLen: outPathLen,
            outPath: outPath,
            lastAdvert: lastAdvert,
            latitude: latitude,
            longitude: longitude,
            lastmod: lastmod
        )
        return .contact(contact)
    }

    /// RESP_CODE_END_OF_CONTACTS (code 4) — end of contact list.
    /// Layout: most_recent_lastmod(uint32)
    private static func parseEndOfContacts(_ data: Data) -> ParsedResponse {
        var offset = 0
        let lastmod = readUInt32(data, offset: &offset)
        logger.info("EndOfContacts: lastmod=\(lastmod)")
        return .endOfContacts(lastmod: lastmod)
    }

    // MARK: - Messages

    /// RESP_CODE_SENT (code 6) — device accepted our message for sending.
    /// Layout: type(1) expected_ack(uint32) suggested_timeout(uint32 ms)
    private static func parseSentResponse(_ data: Data) -> ParsedResponse {
        var offset = 0
        let type = readUInt8(data, offset: &offset)
        let expectedACK = readUInt32(data, offset: &offset)
        let suggestedTimeout = readUInt32(data, offset: &offset)
        logger.info("Sent: type=\(type) expectedACK=\(expectedACK) timeout=\(suggestedTimeout)ms")
        return .sent(type: type, expectedACK: expectedACK, suggestedTimeout: suggestedTimeout)
    }

    /// RESP_CODE_CONTACT_MSG_RECV_V3 (code 16) — received direct message.
    /// Layout: SNR(1) reserved(2) pubkey_prefix(6) path_len(1) txt_type(1) sender_timestamp(uint32) text
    private static func parseContactMsgRecvV3(_ data: Data) -> ParsedResponse {
        var offset = 0
        let snr = Int8(bitPattern: readUInt8(data, offset: &offset))
        _ = readUInt8(data, offset: &offset) // reserved byte 1
        _ = readUInt8(data, offset: &offset) // reserved byte 2
        let pubkeyPrefix = data.count >= offset + 6 ? Data(data[offset..<offset+6]) : Data()
        offset += min(6, data.count - offset)
        let pathLen = readUInt8(data, offset: &offset)
        let txtType = readUInt8(data, offset: &offset)
        let senderTimestamp = readUInt32(data, offset: &offset)
        let text: String
        if offset < data.count {
            text = String(data: Data(data[offset...]), encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) ?? ""
        } else {
            text = ""
        }

        let timestamp = senderTimestamp > 0
            ? senderTimestamp.asDate
            : Date()

        logger.info("ContactMsgRecvV3: snr=\(snr) pathLen=\(pathLen) txtType=\(txtType) from=\(pubkeyPrefix.hexCompact) text='\(text)'")

        let isSigned = txtType == 2

        let message = Message(
            senderKeyHash: pubkeyPrefix,
            contactKeyHash: pubkeyPrefix,
            text: text,
            timestamp: timestamp,
            isOutgoing: false,
            status: .delivered,
            snr: snr,
            hops: pathLen,
            txtType: txtType,
            isSigned: isSigned
        )
        return .contactMsgRecv(message)
    }

    /// RESP_CODE_CHANNEL_MSG_RECV_V3 (code 17) — received channel message.
    /// Verified against firmware MyMesh.cpp:520-544 and meshcore_py reader.py:
    /// Layout: SNR*4(1) reserved(1) reserved(1) channel_idx(1) path_len(1) txt_type(1) timestamp(uint32) text(remaining)
    /// Text is "SenderName: message" — one continuous string, no null separator.
    private static func parseChannelMsgRecvV3(_ data: Data) -> ParsedResponse {
        var offset = 0
        let snr = Int8(bitPattern: readUInt8(data, offset: &offset))
        _ = readUInt8(data, offset: &offset) // reserved1
        _ = readUInt8(data, offset: &offset) // reserved2
        let channelIdx = readUInt8(data, offset: &offset)
        let pathLen = readUInt8(data, offset: &offset)
        let txtType = readUInt8(data, offset: &offset)
        let senderTimestamp = readUInt32(data, offset: &offset)

        // Firmware sends text as "SenderName: message" — one continuous UTF-8 string.
        // Split on ": " to extract sender name.
        let fullText: String
        if offset < data.count {
            fullText = String(data: Data(data[offset...]), encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) ?? ""
        } else {
            fullText = ""
        }

        let senderName: String
        let text: String
        if let colonSpace = fullText.range(of: ": ") {
            senderName = String(fullText[fullText.startIndex..<colonSpace.lowerBound])
            text = String(fullText[colonSpace.upperBound...])
        } else {
            senderName = ""
            text = fullText
        }

        let timestamp = senderTimestamp > 0
            ? senderTimestamp.asDate
            : Date()

        logger.info("ChannelMsgRecvV3: snr=\(snr) pathLen=\(pathLen) ch=\(channelIdx) sender='\(senderName)' txtType=\(txtType) text='\(text)'")

        let isSigned = txtType == 2

        let message = Message(
            senderKeyHash: Data(),
            contactKeyHash: Data([channelIdx]),
            text: text,
            timestamp: timestamp,
            isOutgoing: false,
            status: .delivered,
            snr: snr,
            hops: pathLen,
            channelIndex: channelIdx,
            senderName: senderName.isEmpty ? nil : senderName,
            txtType: txtType,
            isSigned: isSigned
        )
        return .channelMsgRecv(message)
    }

    /// RESP_CODE_CHANNEL_MSG_RECV (code 8) — V1 channel message (firmware ver < 3).
    /// Layout: channel_idx(1) path_len(1) txt_type(1) sender_timestamp(uint32) text(remaining)
    /// No SNR or reserved bytes in V1 format.
    private static func parseChannelMsgRecvV1(_ data: Data) -> ParsedResponse {
        var offset = 0
        let channelIdx = readUInt8(data, offset: &offset)
        let pathLen = readUInt8(data, offset: &offset)
        let txtType = readUInt8(data, offset: &offset)
        let senderTimestamp = readUInt32(data, offset: &offset)

        let fullText: String
        if offset < data.count {
            fullText = String(data: Data(data[offset...]), encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) ?? ""
        } else {
            fullText = ""
        }

        let senderName: String
        let text: String
        if let colonSpace = fullText.range(of: ": ") {
            senderName = String(fullText[fullText.startIndex..<colonSpace.lowerBound])
            text = String(fullText[colonSpace.upperBound...])
        } else {
            senderName = ""
            text = fullText
        }

        let timestamp = senderTimestamp > 0
            ? senderTimestamp.asDate
            : Date()

        logger.info("ChannelMsgRecv(v1): ch=\(channelIdx) pathLen=\(pathLen) txtType=\(txtType) sender='\(senderName)' text='\(text)'")

        let message = Message(
            senderKeyHash: Data(),
            contactKeyHash: Data([channelIdx]),
            text: text,
            timestamp: timestamp,
            isOutgoing: false,
            status: .delivered,
            hops: pathLen,
            channelIndex: channelIdx,
            senderName: senderName.isEmpty ? nil : senderName,
            txtType: txtType
        )
        return .channelMsgRecv(message)
    }

    /// PUSH_CODE_SEND_CONFIRMED (0x82) — ACK received for a sent message.
    /// Layout: ack_code(uint32) round_trip(uint32 ms)
    private static func parseSendConfirmed(_ data: Data) -> ParsedResponse {
        var offset = 0
        let ackCode = readUInt32(data, offset: &offset)
        let roundTrip = readUInt32(data, offset: &offset)
        logger.info("SendConfirmed: ackCode=\(ackCode) roundTrip=\(roundTrip)ms")
        return .sendConfirmed(ackCode: ackCode, roundTripMs: roundTrip)
    }

    /// PUSH_CODE_ADVERT (0x80) — known contact advertised.
    /// Payload may be just pub_key(32 bytes) OR full contact record (148 bytes).
    /// If only pubkey, parse as advert with pubkey only — caller must update timestamp
    /// on existing contact rather than replacing it.
    private static func parseAdvertPush(_ data: Data) -> ParsedResponse {
        // Full contact record (same layout as RESP_CODE_CONTACT)
        if data.count >= 100 {
            let contactResponse = parseContactFull(data)
            if case .contact(let contact) = contactResponse {
                return .advert(contact)
            }
        }
        // Short form: just the 32-byte public key — build minimal contact for identification
        if data.count >= 32 {
            let publicKey = Data(data.prefix(32))
            logger.info("Advert (pubkey-only): \(Data(publicKey.prefix(6)).hexCompact)")
            let contact = Contact(publicKey: publicKey, name: "", type: .unknown, flags: 0,
                                  outPathLen: 0, outPath: Data(), lastAdvert: 0,
                                  latitude: 0, longitude: 0, lastmod: 0)
            return .advert(contact)
        }
        return .unknown(type: MeshCorePushCode.advert.rawValue, payload: data)
    }

    /// RESP_CODE_CONTACT_MSG_RECV (code 7) — received direct message (old/v1 format).
    /// Layout: pubkey_prefix(6) path_len(1) txt_type(1) sender_timestamp(uint32) text(varchar)
    private static func parseContactMsgRecv(_ data: Data) -> ParsedResponse {
        var offset = 0

        // pubkey_prefix: 6 bytes
        let pubkeyPrefix = data.count >= offset + 6 ? Data(data[offset..<offset+6]) : Data()
        offset += min(6, data.count - offset)

        // path_len: 1 byte (0xFF = direct)
        let pathLen = readUInt8(data, offset: &offset)

        // txt_type: 1 byte (0 = plain, 1 = CLI_DATA, 2 = signed)
        let txtType = readUInt8(data, offset: &offset)

        // sender_timestamp: uint32
        let senderTimestamp = readUInt32(data, offset: &offset)

        // text: remainder of frame
        let text: String
        if offset < data.count {
            text = String(data: Data(data[offset...]), encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) ?? ""
        } else {
            text = ""
        }

        let timestamp = senderTimestamp > 0
            ? senderTimestamp.asDate
            : Date()

        let isSigned = txtType == 2

        logger.info("ContactMsgRecv(v1): from=\(pubkeyPrefix.hexCompact) pathLen=\(pathLen) txtType=\(txtType) text='\(text)'")

        let message = Message(
            senderKeyHash: pubkeyPrefix,
            contactKeyHash: pubkeyPrefix,
            text: text,
            timestamp: timestamp,
            isOutgoing: false,
            status: .delivered,
            hops: pathLen,
            txtType: txtType,
            isSigned: isSigned
        )
        return .contactMsgRecv(message)
    }

    // MARK: - Channel Info (code 18)

    /// RESP_CODE_CHANNEL_INFO (code 0x12/18) — channel metadata + secret.
    /// Actual layout (verified against firmware MyMesh.cpp + meshcore.js):
    ///   channel_idx(1) channel_name(32 null-terminated) secret(16 bytes)
    /// The firmware DOES return the 16-byte channel PSK. There is no flags byte.
    private static func parseChannelInfo(_ data: Data) -> ParsedResponse {
        let hex = data.hexFormatted(maxBytes: 50)
        logger.info("ChannelInfo raw [\(data.count) bytes]: \(hex)")

        var offset = 0
        let channelIdx = readUInt8(data, offset: &offset)
        let name = readFixedString(data, offset: &offset, maxLen: 32)

        // Firmware sends 16-byte channel secret (PSK) after the name.
        // Previous code incorrectly read secret[0] as "flags".
        var secret: Data?
        let remaining = data.count - offset
        if remaining >= 16 {
            secret = Data(data[offset..<offset+16])
            offset += 16
            logger.info("ChannelInfo: idx=\(channelIdx) name='\(name)' secret=<\(secret?.count ?? 0) bytes>")
        } else {
            logger.info("ChannelInfo: idx=\(channelIdx) name='\(name)' (no secret, \(remaining) trailing bytes)")
        }

        let channel = MeshChannel(index: channelIdx, name: name, flags: 0, secret: secret)
        return .channelInfo(channel)
    }

    // MARK: - Status Response (0x87)

    /// PUSH_CODE_STATUS_RESPONSE (0x87) — status from a remote device.
    /// Layout: reserved(1) pub_key_prefix(6) status_data(remainder)
    /// status_data (60 bytes, firmware v1.14+):
    ///   battery_mv(u16) reserved(u16) rssi(i16) snr×4(i16)
    ///   stat1(u32) stat2(u32) stat3(u32) uptime_seconds(u32) num_contacts(u32)
    ///   stat4(u32) stat5(u32) stat6(u32) ... trailing stats
    private static func parseStatusResponse(_ data: Data) -> ParsedResponse {
        var offset = 0
        _ = readUInt8(data, offset: &offset) // reserved
        let senderKey = data.count >= offset + 6 ? Data(data[offset..<offset+6]) : Data()
        offset += min(6, data.count - offset)

        // Byte 0-1: battery millivolts
        let batteryMV = readUInt16(data, offset: &offset)
        // Byte 2-3: reserved
        _ = readUInt16(data, offset: &offset)
        // Byte 4-5: RSSI (int16)
        _ = readUInt16(data, offset: &offset)
        // Byte 6-7: SNR×4 (int16)
        _ = readUInt16(data, offset: &offset)
        // Byte 8-19: stat counters (3 × uint32)
        _ = readUInt32(data, offset: &offset)
        _ = readUInt32(data, offset: &offset)
        _ = readUInt32(data, offset: &offset)
        // Byte 20-23: uptime seconds (uint32)
        let uptime = readUInt32(data, offset: &offset)
        // Byte 24-27: num contacts in table (uint32)
        let contactsU32 = readUInt32(data, offset: &offset)
        let contacts = UInt16(min(contactsU32, UInt32(UInt16.max)))

        logger.info("StatusResponse: from=\(senderKey.hexCompact) batt=\(batteryMV)mV uptime=\(uptime)s contacts=\(contacts)")

        let info = RemoteStatusInfo(
            batteryMV: batteryMV,
            uptime: uptime,
            contacts: contacts,
            rawData: data
        )
        return .statusResponse(info)
    }

    // MARK: - Trace Data (0x89)

    /// PUSH_CODE_TRACE_DATA (0x89) — trace route result.
    /// Layout: reserved(1) path_len(1) flags(1) tag(int32) auth_code(int32)
    ///         path_hashes(6*path_len bytes) path_snrs(path_len+1 bytes)
    private static func parseTraceData(_ data: Data) -> ParsedResponse {
        var offset = 0
        _ = readUInt8(data, offset: &offset) // reserved
        let pathLen = Int(readUInt8(data, offset: &offset))
        _ = readUInt8(data, offset: &offset) // flags
        let tag = readUInt32(data, offset: &offset)
        _ = readUInt32(data, offset: &offset) // auth_code

        // Read path hashes (6 bytes each)
        var nodeHashes: [Data] = []
        for _ in 0..<pathLen {
            if offset + 6 <= data.count {
                nodeHashes.append(Data(data[offset..<offset+6]))
                offset += 6
            }
        }

        // Read path SNRs (path_len + 1 entries, each SNR*4 as signed byte)
        var hops: [TraceHop] = []
        for i in 0..<pathLen {
            let snrRaw = Int8(bitPattern: readUInt8(data, offset: &offset))
            let snr = snrRaw / 4
            let hash = i < nodeHashes.count ? nodeHashes[i] : Data()
            hops.append(TraceHop(nodeHash: hash, snr: snr))
        }
        // Final hop SNR (destination)
        if offset < data.count {
            _ = readUInt8(data, offset: &offset) // skip final SNR
        }

        logger.info("TraceData: tag=\(tag) pathLen=\(pathLen) hops=\(hops.count)")

        return .traceData(TraceResult(tag: tag, hops: hops))
    }

    // MARK: - Telemetry Response (0x8B)

    /// PUSH_CODE_TELEMETRY_RESPONSE (0x8B) — LPP-encoded sensor data.
    /// Layout: reserved(1) pub_key_prefix(6) lpp_data(remainder)
    /// LPP format: channel(1) type(1) value(variable)
    private static func parseTelemetryResponse(_ data: Data) -> ParsedResponse {
        var offset = 0
        _ = readUInt8(data, offset: &offset) // reserved

        let senderKey = data.count >= offset + 6 ? Data(data[offset..<offset+6]) : Data()
        offset += min(6, data.count - offset)

        var readings: [TelemetryReading] = []

        while offset + 2 < data.count {
            _ = readUInt8(data, offset: &offset) // channel
            let lppType = readUInt8(data, offset: &offset)

            switch lppType {
            case 0x67: // Temperature (int16 BE, 0.1 C)
                let raw = Int16(bitPattern: readUInt16BE(data, offset: &offset))
                readings.append(TelemetryReading(name: "Temperature", value: Double(raw) / 10.0, unit: "\u{00B0}C"))
            case 0x68: // Humidity (uint8, 0.5 %)
                let raw = readUInt8(data, offset: &offset)
                readings.append(TelemetryReading(name: "Humidity", value: Double(raw) / 2.0, unit: "%"))
            case 0x73: // Barometric Pressure (uint16 BE, 0.1 hPa)
                let raw = readUInt16BE(data, offset: &offset)
                readings.append(TelemetryReading(name: "Pressure", value: Double(raw) / 10.0, unit: "hPa"))
            case 0x02: // Analog Input (uint16 BE, 0.01 V) — often battery
                let raw = readUInt16BE(data, offset: &offset)
                readings.append(TelemetryReading(name: "Battery", value: Double(raw) / 100.0, unit: "V"))
            case 0x74: // Voltage (uint16 BE, 0.01 V) — battery voltage
                let raw = readUInt16BE(data, offset: &offset)
                readings.append(TelemetryReading(name: "Battery", value: Double(raw) / 100.0, unit: "V"))
            case 0x65: // Illuminance (uint16 BE, 1 lux)
                let raw = readUInt16BE(data, offset: &offset)
                readings.append(TelemetryReading(name: "Light", value: Double(raw), unit: "lux"))
            case 0x88: // GPS (9 bytes: lat 3, lon 3, alt 3 — all 24-bit signed)
                guard offset + 9 <= data.count else { break }
                // Read directly from data at correct offsets — do NOT slice then index
                let latRaw = Int32(data[offset]) << 16 | Int32(data[offset+1]) << 8 | Int32(data[offset+2])
                let lat = latRaw > 0x7FFFFF ? latRaw - 0x1000000 : latRaw
                offset += 3
                let lonRaw = Int32(data[offset]) << 16 | Int32(data[offset+1]) << 8 | Int32(data[offset+2])
                let lon = lonRaw > 0x7FFFFF ? lonRaw - 0x1000000 : lonRaw
                offset += 3
                let altRaw = Int32(data[offset]) << 16 | Int32(data[offset+1]) << 8 | Int32(data[offset+2])
                let alt = altRaw > 0x7FFFFF ? altRaw - 0x1000000 : altRaw
                offset += 3
                readings.append(TelemetryReading(name: "GPS Lat", value: Double(lat) / 10000.0, unit: "\u{00B0}"))
                readings.append(TelemetryReading(name: "GPS Lon", value: Double(lon) / 10000.0, unit: "\u{00B0}"))
                readings.append(TelemetryReading(name: "Altitude", value: Double(alt) / 100.0, unit: "m"))
            default:
                // Unknown LPP type — skip remaining data
                logger.debug("Unknown LPP type 0x\(String(format: "%02x", lppType)) at offset \(offset)")
                break
            }
        }

        logger.info("TelemetryResponse: \(readings.count) readings from \(senderKey.hexCompact)")

        return .telemetryResponse(senderKey: senderKey, readings: readings)
    }

    // MARK: - Path Discovery Response (0x8D)

    /// PUSH_CODE_PATH_DISCOVERY_RESPONSE (0x8D) — bidirectional path returned after CMD_SEND_PATH_DISCOVERY_REQ.
    /// Layout: reserved(1) pubKeyPrefix(6) outPathLen(1) outPath(N) inPathLen(1) inPath(M)
    /// Path bytes: N = (outPathLen & 0x3F) * ((outPathLen >> 6) + 1)
    private static func parsePathDiscoveryResp(_ data: Data) -> ParsedResponse {
        var offset = 0
        _ = readUInt8(data, offset: &offset) // reserved

        guard offset + 6 <= data.count else {
            logger.warning("PathDiscoveryResp: too short (\(data.count) bytes)")
            return .unknown(type: MeshCorePushCode.pathDiscoveryResp.rawValue, payload: data)
        }
        let pubKeyPrefix = Data(data[offset..<offset+6])
        offset += 6

        let outPathLen = readUInt8(data, offset: &offset)
        let outHops = Int(outPathLen & 0x3F)
        let outHashSize = Int((outPathLen >> 6) + 1)
        let outByteCount = min(outHops * outHashSize, data.count - offset)
        let outPathBytes = Data(data[offset..<offset+outByteCount])
        offset += outByteCount

        let inPathLen = offset < data.count ? readUInt8(data, offset: &offset) : 0
        let inHops = Int(inPathLen & 0x3F)
        let inHashSize = Int((inPathLen >> 6) + 1)
        let inByteCount = min(inHops * inHashSize, data.count - offset)
        let inPathBytes = offset < data.count ? Data(data[offset..<offset+inByteCount]) : Data()

        logger.info("PathDiscoveryResp: outHops=\(outHops) inHops=\(inHops) from \(pubKeyPrefix.hexCompact)")

        return .pathDiscovery(PathDiscoveryResult(
            pubKeyPrefix: pubKeyPrefix,
            outPathLen: outPathLen,
            outPathBytes: outPathBytes,
            inPathLen: inPathLen,
            inPathBytes: inPathBytes,
            timestamp: Date()
        ))
    }

    // MARK: - Control Data (0x8E)

    /// PUSH_CODE_CONTROL_DATA (0x8E) — control packet (discover responses, etc.).
    /// Layout: SNR(int8) RSSI(int8) path_len(1) path(variable) payload(remainder)
    private static func parseControlData(_ data: Data) -> ParsedResponse {
        var offset = 0
        let snr = Int8(bitPattern: readUInt8(data, offset: &offset))
        let rssi = Int8(bitPattern: readUInt8(data, offset: &offset))
        let pathLen = readUInt8(data, offset: &offset)

        // Skip path bytes (6 bytes per hop)
        let pathBytes = min(Int(pathLen) * 6, data.count - offset)
        offset += pathBytes

        let payload = offset < data.count ? Data(data[offset...]) : Data()

        logger.info("ControlData: snr=\(snr) rssi=\(rssi) pathLen=\(pathLen) payload=\(payload.count) bytes")

        return .controlData(snr: snr, rssi: rssi, pathLen: pathLen, payload: payload)
    }

    // MARK: - Advert Path (code 22)

    /// RESP_CODE_ADVERT_PATH (0x16) — last known path to a contact.
    /// Layout: recv_timestamp(uint32) path_len(1) path(6*path_len bytes)
    private static func parseAdvertPath(_ data: Data) -> ParsedResponse {
        var offset = 0
        let recvTimestamp = readUInt32(data, offset: &offset)
        let pathLen = readUInt8(data, offset: &offset)

        var hashes: [Data] = []
        for _ in 0..<pathLen {
            if offset + 6 <= data.count {
                hashes.append(Data(data[offset..<offset+6]))
                offset += 6
            }
        }

        logger.info("AdvertPath: timestamp=\(recvTimestamp) pathLen=\(pathLen) hops=\(hashes.count)")

        return .advertPath(AdvertPathInfo(recvTimestamp: recvTimestamp, pathLen: pathLen, pathHashes: hashes))
    }

    // MARK: - Allowed Repeat Freq (code 26)

    /// RESP_ALLOWED_REPEAT_FREQ (0x1A) — allowed repeat frequency ranges.
    /// Layout: pairs of {lower_freq(uint32), upper_freq(uint32)}
    private static func parseAllowedRepeatFreq(_ data: Data) -> ParsedResponse {
        var offset = 0
        var ranges: [FrequencyRange] = []

        while offset + 8 <= data.count {
            let lower = readUInt32(data, offset: &offset)
            let upper = readUInt32(data, offset: &offset)
            ranges.append(FrequencyRange(lowerKHz: lower, upperKHz: upper))
        }

        logger.info("AllowedRepeatFreq: \(ranges.count) ranges")

        return .allowedRepeatFreq(ranges)
    }

    // MARK: - Default Flood Scope (code 28, firmware 1.15.0+)

    /// RESP_CODE_DEFAULT_FLOOD_SCOPE (0x1C).
    /// Configured:     name(31 bytes, null-terminated) + key(16 bytes) = 47 bytes payload
    /// Not configured: empty payload (0 bytes)
    private static func parseDefaultFloodScope(_ data: Data) -> ParsedResponse {
        guard data.count >= 31 else {
            logger.info("DefaultFloodScope: not configured")
            return .defaultFloodScope(name: "")
        }
        var offset = 0
        let name = readFixedString(data, offset: &offset, maxLen: 31)
        logger.info("DefaultFloodScope: '\(name)'")
        return .defaultFloodScope(name: name)
    }

    // MARK: - Binary Read Helpers

    private static func readUInt8(_ data: Data, offset: inout Int) -> UInt8 {
        guard offset < data.count else { return 0 }
        let v = data[offset]
        offset += 1
        return v
    }

    private static func readUInt16(_ data: Data, offset: inout Int) -> UInt16 {
        guard offset + 2 <= data.count else { return 0 }
        var v: UInt16 = 0
        _ = withUnsafeMutableBytes(of: &v) { dest in
            data.copyBytes(to: dest, from: offset..<offset+2)
        }
        offset += 2
        return UInt16(littleEndian: v)
    }

    /// Read big-endian UInt16 (for Cayenne LPP telemetry fields).
    private static func readUInt16BE(_ data: Data, offset: inout Int) -> UInt16 {
        guard offset + 2 <= data.count else { return 0 }
        let v = UInt16(data[offset]) << 8 | UInt16(data[offset + 1])
        offset += 2
        return v
    }

    private static func readUInt32(_ data: Data, offset: inout Int) -> UInt32 {
        guard offset + 4 <= data.count else { return 0 }
        var v: UInt32 = 0
        _ = withUnsafeMutableBytes(of: &v) { dest in
            data.copyBytes(to: dest, from: offset..<offset+4)
        }
        offset += 4
        return UInt32(littleEndian: v)
    }

    private static func readInt32(_ data: Data, offset: inout Int) -> Int32 {
        guard offset + 4 <= data.count else { return 0 }
        var v: Int32 = 0
        _ = withUnsafeMutableBytes(of: &v) { dest in
            data.copyBytes(to: dest, from: offset..<offset+4)
        }
        offset += 4
        return Int32(littleEndian: v)
    }

    private static func readFloat(_ data: Data, offset: inout Int) -> Float {
        guard offset + 4 <= data.count else { return 0 }
        var v: Float = 0
        _ = withUnsafeMutableBytes(of: &v) { dest in
            data.copyBytes(to: dest, from: offset..<offset+4)
        }
        offset += 4
        return v
    }

    /// Read a fixed-length null-terminated C string (reads exactly maxLen bytes, returns up to null).
    private static func readFixedString(_ data: Data, offset: inout Int, maxLen: Int) -> String {
        let available = min(maxLen, data.count - offset)
        guard available > 0 else { return "" }
        let slice = data[offset..<offset+available]
        offset += available
        if let nullIdx = slice.firstIndex(of: 0x00) {
            return String(data: data[slice.startIndex..<nullIdx], encoding: .utf8) ?? ""
        }
        return String(data: Data(slice), encoding: .utf8) ?? ""
    }

    private static func readNullTerminated(_ data: Data, offset: inout Int) -> String {
        guard offset < data.count else { return "" }
        let slice = data[offset...]
        if let nullIdx = slice.firstIndex(of: 0x00) {
            let str = String(data: data[offset..<nullIdx], encoding: .utf8) ?? ""
            offset = nullIdx + 1
            return str
        }
        let str = String(data: Data(slice), encoding: .utf8) ?? ""
        offset = data.count
        return str
    }
}
