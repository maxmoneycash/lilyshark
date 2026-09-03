//
//  MeshtasticIdentity.swift
//  MeshtasticKit
//
//  Carrying a 32-bit Meshtastic node number through a 32-byte key space.
//

import Foundation

/// The single definition of how a Meshtastic node is named inside an app whose
/// stores key everything by a 32-byte public key.
///
/// Meshtastic identifies a node by a 32-bit `num`. MeshCore identifies a contact
/// by a 32-byte public key whose first six bytes are the routing prefix, and
/// that prefix is what the message store, the map and the chat list all key on.
/// A deck reports the former and the app is built on the latter, so one has to
/// be derived from the other — and the derivation has to live in exactly one
/// place, or the same node ends up owning three different conversations.
///
/// Pure `Data` arithmetic, so `swift test` covers all of it.
public enum MeshtasticIdentity {
    /// Length of the public key a contact carries.
    public static let keyLength = 32

    /// Bytes of a key that routing looks at, and therefore all of one that a
    /// stored message keeps.
    public static let prefixLength = 6

    /// Marks a derived key as standing for a Meshtastic node rather than for a
    /// real keypair. Two protocols never hold the link at the same time, so the
    /// tag is not a collision guard between live contacts; it is what lets a
    /// key that came from here be recognised again later, and what keeps a
    /// derived prefix from looking like a plausible MeshCore one in a log.
    public static let tag: [UInt8] = [0x4d, 0x54]   // "MT"

    /// The 32-byte key standing for `num`: the tag, the number big endian, then
    /// zero padding. Stable across reconnects and unique per node, which is
    /// what makes a conversation survive the deck going out of range.
    public static func syntheticKey(forNodeNum num: UInt32) -> Data {
        var key = Data(tag)
        key.append(contentsOf: withUnsafeBytes(of: num.bigEndian, Array.init))
        key.append(Data(repeating: 0, count: keyLength - key.count))
        return key
    }

    /// Recover the node number from a derived key, or from just its six-byte
    /// prefix — which is all a stored message keeps. Returns nil for anything
    /// not carrying the tag, so a MeshCore contact never turns into a node
    /// number the app would then try to address over a deck.
    public static func nodeNum(forSyntheticKey key: Data) -> UInt32? {
        let bytes = Array(key.prefix(prefixLength))
        guard bytes.count == prefixLength,
              Array(bytes.prefix(tag.count)) == tag else { return nil }
        var num: UInt32 = 0
        for byte in bytes.dropFirst(tag.count) { num = (num << 8) | UInt32(byte) }
        return num
    }

    /// What stock Meshtastic calls a node that has published no name.
    public static func defaultLabel(forNodeNum num: UInt32) -> String {
        String(format: "!%08x", num)
    }

    /// Meshtastic reports SNR as plain decibels in a float; MeshCore stores it
    /// as decibels × 4 in an `Int8`, and every screen that shows SNR divides by
    /// four. Converting here is what stops a deck's −8.5 dB being drawn as
    /// −2.1 dB.
    public static func snrQuarterDecibels(from decibels: Float) -> Int8 {
        Int8(clamping: Int((decibels * 4).rounded()))
    }
}
