//
//  MeshtasticBLEConstants.swift
//  MeshtasticKit
//
//  The GATT service and characteristics a Meshtastic radio exposes, and that
//  a Lilyshark T-Deck answers on.
//

import CoreBluetooth

/// Meshtastic's BLE API, as advertised by stock firmware and by the T-Deck.
///
/// These four UUIDs are the whole transport: the phone writes a ToRadio
/// protobuf to `toRadio`, and reads FromRadio protobufs from `fromRadio` until
/// the characteristic returns an empty value. `fromNum` notifies when the
/// radio has queued something new, so a connected phone does not have to poll.
public enum MeshtasticBLEConstants {
    /// The strings are kept alongside the `CBUUID`s because `CBUUID` upcases
    /// what it is given, and these are the exact lowercase spellings shared
    /// with the web client -- a mismatch between the two ends is a pairing bug
    /// that only shows up over the air.
    public static let serviceUUIDString = "6ba1b218-15a8-461f-9fa8-5dcae273eafd"
    public static let fromRadioUUIDString = "2c55e69e-4993-11ed-b878-0242ac120002"
    public static let toRadioUUIDString = "f75c76d2-129e-4dad-a1dd-7866124401e7"
    public static let fromNumUUIDString = "ed9da18c-a800-4f66-a670-aa7547e34453"

    /// The service to scan for and, once connected, to discover against.
    public static let serviceUUID = CBUUID(string: serviceUUIDString)

    /// Read repeatedly after every notification: one FromRadio per read, and
    /// an empty value means the radio's queue is drained.
    public static let fromRadioUUID = CBUUID(string: fromRadioUUIDString)

    /// Written with one ToRadio protobuf per write.
    public static let toRadioUUID = CBUUID(string: toRadioUUIDString)

    /// Notifies with a packet counter so the phone knows to drain `fromRadio`.
    public static let fromNumUUID = CBUUID(string: fromNumUUIDString)
}
