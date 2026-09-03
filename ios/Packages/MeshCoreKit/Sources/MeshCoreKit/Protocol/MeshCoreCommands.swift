//
//  MeshCoreCommands.swift
//  MeshCoreKit
//
//  Command, response, push, and error code enums for the MeshCore protocol.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// MeshCore Companion Radio Protocol — command codes sent TO the device.
public enum MeshCoreCommand: UInt8, Sendable {
    case appStart             = 0x01  // 1
    case sendTextMessage      = 0x02  // 2
    case sendChannelMessage   = 0x03  // 3
    case getContacts          = 0x04  // 4
    case getDeviceTime        = 0x05  // 5
    case setDeviceTime        = 0x06  // 6
    case sendSelfAdvert       = 0x07  // 7
    case setAdvertName        = 0x08  // 8
    case addUpdateContact     = 0x09  // 9 — CMD_ADD_UPDATE_CONTACT
    case syncNextMessage      = 0x0A  // 10
    case setRadioParams       = 0x0B  // 11
    case setRadioTXPower      = 0x0C  // 12
    case resetPath            = 0x0D  // 13 — reset outbound path for a contact
    case setAdvertLatLon      = 0x0E  // 14
    case removeContact        = 0x0F  // 15 — remove a contact by public key
    case shareContact         = 0x10  // 16 — zero-hop share a contact's advert
    case exportContact        = 0x11  // 17 — export contact as meshcore:// URL
    case importContact        = 0x12  // 18 — import contact from meshcore:// URL
    case reboot               = 0x13  // 19
    case getBattAndStorage    = 0x14  // 20
    case setTuningParams      = 0x15  // 21
    case deviceQuery          = 0x16  // 22
    case sendRawData          = 0x19  // 25 — send raw LoRa payload with routing path
    case sendLogin            = 0x1A  // 26 — login to remote device (repeater/room)
    case sendStatusReq        = 0x1B  // 27 — request status from remote device
    case getChannel           = 0x1F  // 31 — get channel info by index
    case setChannel           = 0x20  // 32 — add or update a channel
    case setDevicePIN         = 0x25  // 37
    case setOtherParams       = 0x26  // 38
    case sendTracePath        = 0x24  // 36 — trace route to a contact
    case sendTelemetryReq     = 0x27  // 39 — request telemetry from a sensor
    case getCustomVars        = 0x28  // 40
    case setCustomVar         = 0x29  // 41
    case getAdvertPath        = 0x2A  // 42 — get last known path to a contact
    case getTuningParams      = 0x2B  // 43
    case sendBinaryReq        = 0x32  // 50 — binary request; response via PUSH_CODE_BINARY_RESPONSE (0x8C)
    case factoryReset         = 0x33  // 51
    case sendPathDiscoveryReq = 0x34  // 52 — flood path discovery to a contact
    case sendControlData      = 0x37  // 55 — send control packet (discover, etc.)
    case getStats             = 0x38  // 56
    case setAutoAddConfig     = 0x3A  // 58 — set contact auto-add bitmask
    case getAutoAddConfig     = 0x3B  // 59 — get contact auto-add config
    case getAllowedRepeatFreq = 0x3C  // 60 — get allowed repeat frequency ranges
    case setDefaultFloodScope = 0x3F  // 63 — set default flood scope region name (firmware 1.15.0+)
    case getDefaultFloodScope = 0x40  // 64 — get default flood scope region name (firmware 1.15.0+)

    // Signing commands (device-side Ed25519)
    case signStart            = 0x21  // 33 — initialize signing session
    case signData             = 0x22  // 34 — stream data chunk to sign
    case signFinish           = 0x23  // 35 — finalize and get Ed25519 signature
}

/// MeshCore Companion Radio Protocol — response codes received FROM the device.
/// Verified against firmware source: examples/companion_radio/MyMesh.h
public enum MeshCoreResponseCode: UInt8, Sendable {
    case ok                   = 0x00  // 0  — RESP_CODE_OK
    case err                  = 0x01  // 1  — RESP_CODE_ERR (followed by err_code byte)
    case contactsStart        = 0x02  // 2  — start of contact list (contains count)
    case contact              = 0x03  // 3  — individual contact data
    case endOfContacts        = 0x04  // 4  — end of contact list (contains lastmod)
    case selfInfo             = 0x05  // 5  — RESP_CODE_SELF_INFO
    case sent                 = 0x06  // 6  — RESP_CODE_SENT (type + ack_code + timeout)
    case contactMsgRecv       = 0x07  // 7  — RESP_CODE_CONTACT_MSG_RECV (v1 format, ver < 3)
    case channelMsgRecv       = 0x08  // 8  — RESP_CODE_CHANNEL_MSG_RECV (v1 format, ver < 3)
    case currTime             = 0x09  // 9  — RESP_CODE_CURR_TIME
    case noMoreMessages       = 0x0A  // 10 — RESP_CODE_NO_MORE_MESSAGES
    case exportedContact      = 0x0B  // 11 — RESP_CODE_EXPORT_CONTACT
    case battAndStorage       = 0x0C  // 12 — RESP_CODE_BATT_AND_STORAGE
    case deviceInfo           = 0x0D  // 13 — RESP_CODE_DEVICE_INFO
    case privateKey           = 0x0E  // 14 — RESP_CODE_PRIVATE_KEY
    case disabled             = 0x0F  // 15 — RESP_CODE_DISABLED
    case contactMsgRecvV3     = 0x10  // 16 — RESP_CODE_CONTACT_MSG_RECV_V3
    case channelMsgRecvV3     = 0x11  // 17 — RESP_CODE_CHANNEL_MSG_RECV_V3
    case channelInfo          = 0x12  // 18 — RESP_CODE_CHANNEL_INFO
    case signStart            = 0x13  // 19 — RESP_CODE_SIGN_START
    case signature            = 0x14  // 20 — RESP_CODE_SIGNATURE
    case customVars           = 0x15  // 21 — RESP_CODE_CUSTOM_VARS
    case advertPath           = 0x16  // 22 — RESP_CODE_ADVERT_PATH
    case tuningParams         = 0x17  // 23 — RESP_CODE_TUNING_PARAMS
    case stats                = 0x18  // 24 — RESP_CODE_STATS
    case autoAddConfig        = 0x19  // 25 — RESP_CODE_AUTOADD_CONFIG
    case allowedRepeatFreq    = 0x1A  // 26 — RESP_ALLOWED_REPEAT_FREQ
    case defaultFloodScope    = 0x1C  // 28 — RESP_CODE_DEFAULT_FLOOD_SCOPE (firmware 1.15.0+)
}

/// MeshCore error codes returned with RESP_CODE_ERR.
public enum MeshCoreErrorCode: UInt8, Sendable {
    case unsupportedCmd       = 1
    case notFound             = 2
    case tableFull            = 3
    case badState             = 4
    case fileIOError          = 5
    case illegalArg           = 6

    public var description: String {
        switch self {
        case .unsupportedCmd: return "Unsupported command"
        case .notFound:       return "Not found"
        case .tableFull:      return "Table full"
        case .badState:       return "Bad state"
        case .fileIOError:    return "File I/O error"
        case .illegalArg:     return "Illegal argument"
        }
    }
}

/// MeshCore push codes — unsolicited notifications FROM the device.
public enum MeshCorePushCode: UInt8, Sendable {
    case advert               = 0x80  // 128 — new advertisement received
    case pathUpdated          = 0x81  // 129 — contact path changed
    case sendConfirmed        = 0x82  // 130 — sent message was ACKed
    case msgWaiting           = 0x83  // 131 — new message waiting to be synced
    case rawData              = 0x84  // 132 — raw LoRa packet received
    case loginSuccess         = 0x85  // 133 — remote login succeeded (permissions byte)
    case loginFail            = 0x86  // 134 — remote login failed
    case statusResponse       = 0x87  // 135 — status response from remote device
    case logRxData            = 0x88  // 136 — debug log of received LoRa packet
    case traceData            = 0x89  // 137 — trace route data
    case newAdvert            = 0x8A  // 138 — new contact discovered (manual_add mode)
    case telemetryResponse    = 0x8B  // 139 — telemetry data from sensor
    case binaryResponse       = 0x8C  // 140 — binary request response
    case pathDiscoveryResp    = 0x8D  // 141 — path discovery result
    case controlData          = 0x8E  // 142 — control packet received (discover response, etc.)
    case contactDeleted       = 0x8F  // 143 — contact evicted from device
    case contactsFull         = 0x90  // 144 — contact storage full
}
