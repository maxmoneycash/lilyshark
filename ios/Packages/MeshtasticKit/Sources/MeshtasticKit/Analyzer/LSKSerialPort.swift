//
//  LSKSerialPort.swift
//  MeshtasticKit
//
//  What a serial port is, which of them could be a deck, and what to do when
//  one does not answer. All of it pure, and all of it compiled on every
//  platform — including the ones that can never open a port, because those
//  still have to be able to explain themselves.
//

import Foundation

/// One candidate serial device on this machine.
public struct LSKSerialPort: Equatable, Sendable, Identifiable {
    /// The callout device, e.g. `/dev/cu.usbmodem14201`.
    public let path: String
    /// The IORegistry name, when there was one.
    public let name: String
    /// USB idVendor / idProduct read from the port's USB ancestor, nil for a
    /// port with no USB device behind it — a Bluetooth-incoming port or the
    /// debug console, both of which open happily and then say nothing.
    public let usbVendorID: UInt16?
    public let usbProductID: UInt16?

    public var id: String { path }

    public init(path: String, name: String, usbVendorID: UInt16?, usbProductID: UInt16?) {
        self.path = path
        self.name = name
        self.usbVendorID = usbVendorID
        self.usbProductID = usbProductID
    }

    /// Espressif's own USB vendor. The T-Deck's ESP32-S3 enumerates natively
    /// here rather than through a bridge chip.
    public static let espressifVendorID: UInt16 = 0x303A

    /// The USB-serial bridges other dev boards put in front of the same MCU:
    /// CH34x, CP210x, FTDI.
    ///
    /// This list is a second copy of the one in `webapp/src/lib/deviceLink.ts`
    /// (`KNOWN_USB_VENDORS`) and has to be, because a TypeScript constant
    /// cannot be imported into Swift. It is a discovery heuristic, not a
    /// protocol table: being wrong costs a port that has to be picked by hand,
    /// never a misread frame. If the two ever disagree, `deviceLink.ts` is the
    /// one with a browser's port picker behind it.
    public static let bridgeVendorIDs: Set<UInt16> = [0x1A86, 0x10C4, 0x0403]

    public var isEspressifNativeUSB: Bool { usbVendorID == Self.espressifVendorID }

    public var isUSBSerialBridge: Bool {
        guard let vendor = usbVendorID else { return false }
        return Self.bridgeVendorIDs.contains(vendor)
    }

    /// Worth trying a handshake on. A port with no USB vendor at all is a
    /// Bluetooth or console port: opening one is not harmful, but it will
    /// never answer, and twenty seconds of silence reads to an operator as a
    /// hang rather than as a wrong choice.
    public var couldBeADeck: Bool { isEspressifNativeUSB || isUSBSerialBridge }

    /// Candidates in the order they should be tried: the deck's own vendor
    /// first, then bridge chips, then everything else, and alphabetically
    /// within each group so the order does not shuffle between scans.
    public static func ranked(_ ports: [LSKSerialPort]) -> [LSKSerialPort] {
        ports.sorted { left, right in
            let leftRank = left.rank
            let rightRank = right.rank
            if leftRank != rightRank { return leftRank < rightRank }
            return left.path < right.path
        }
    }

    private var rank: Int {
        if isEspressifNativeUSB { return 0 }
        if isUSBSerialBridge { return 1 }
        return 2
    }
}

/// Whether this platform can open a serial link to a deck at all.
///
/// Compiled everywhere on purpose. A build for a platform that cannot do this
/// still has to say why, in words an operator can act on, rather than offering
/// a button that quietly does nothing.
public enum LSKUSBAvailability: Equatable, Sendable {
    case available
    case unavailable(String)

    public var isAvailable: Bool {
        if case .available = self { return true }
        return false
    }

    /// Nil when the link is available.
    public var reason: String? {
        if case .unavailable(let text) = self { return text }
        return nil
    }

    /// What this build can do, decided at compile time.
    ///
    /// The reasons below were checked against the iOS 26.5 SDK shipped with
    /// Xcode 26.6; `LSK.md` records the exact commands and their output.
    public static var current: LSKUSBAvailability {
        #if os(macOS)
        return .available
        #elseif os(watchOS)
        return .unavailable(
            "watchOS has no USB port and no serial API. Link a deck over Bluetooth, "
            + "or use the Mac app for the analyzer."
        )
        #else
        return .unavailable(
            "iOS and iPadOS expose no API for a USB CDC serial device. IOKit's serial "
            + "family is macOS-only, ExternalAccessory needs an MFi accessory and a "
            + "T-Deck is not one, and neither AccessorySetupKit nor the iOS 26 "
            + "AccessoryTransportExtension has a USB transport. Use the Mac app for the "
            + "analyzer link; Bluetooth carries chat on this device."
        )
        #endif
    }
}

/// What to do when a handshake attempt does not finish.
///
/// Opening an ESP32-S3's native USB port resets the chip, so the first attempt
/// on a cold cable almost always ends with the stream dropping out from under
/// the host. That is the board rebooting, not a failure, and this is the rule
/// that tells the two apart. It mirrors `nextSerialAction` in
/// `webapp/src/lib/deviceLink.ts`, which is the version that has actually been
/// run against hardware.
public enum LSKHandshakePolicy {
    public enum Event: Equatable, Sendable {
        /// The CDC stream ended — the usual sign of the board re-enumerating.
        case streamDropped
        /// No `LSK ID` inside the identify window.
        case timedOut
    }

    public enum Action: Equatable, Sendable {
        /// The host asked for this. Say nothing.
        case ignore
        /// Close, wait for the board to come back, and open again.
        case retry
        /// Out of attempts. Report it.
        case giveUp
    }

    public static func action(
        for event: Event,
        deliberate: Bool,
        attempt: Int,
        maximumAttempts: Int = LSKLinkTiming.deck.maximumAttempts
    ) -> Action {
        _ = event
        if deliberate { return .ignore }
        return attempt + 1 < maximumAttempts ? .retry : .giveUp
    }
}

/// The delays the link runs on.
///
/// Defaults are `deck`, which are the numbers `webapp/src/lib/deviceLink.ts`
/// arrived at against real hardware. Tests substitute short ones so a pty can
/// stand in for a board without the suite waiting twenty seconds.
public struct LSKLinkTiming: Equatable, Sendable {
    /// Let the board finish coming out of reset before the first HELLO. The
    /// firmware only reads the serial line after `setup()` returns, which is
    /// after the display, GPS and radio are up.
    public var helloAfterOpen: TimeInterval
    /// Keep asking while waiting, in case the first one landed mid-boot.
    public var helloRepeat: TimeInterval
    /// How long one open gets to produce an `LSK ID`.
    public var identifyTimeout: TimeInterval
    /// Wait after a drop before reopening; the T-Deck re-enumerates in here.
    public var reenumerateWait: TimeInterval
    /// Opens that may reboot the chip. The first drop is expected.
    public var maximumAttempts: Int

    public init(
        helloAfterOpen: TimeInterval,
        helloRepeat: TimeInterval,
        identifyTimeout: TimeInterval,
        reenumerateWait: TimeInterval,
        maximumAttempts: Int
    ) {
        self.helloAfterOpen = helloAfterOpen
        self.helloRepeat = helloRepeat
        self.identifyTimeout = identifyTimeout
        self.reenumerateWait = reenumerateWait
        self.maximumAttempts = maximumAttempts
    }

    public static let deck = LSKLinkTiming(
        helloAfterOpen: 0.8,
        helloRepeat: 1.2,
        identifyTimeout: 20,
        reenumerateWait: 4,
        maximumAttempts: 3
    )
}

/// Where the link is.
public enum LSKLinkState: Equatable, Sendable {
    case off
    /// Port open, HELLO going out, no `LSK ID` back yet.
    case connecting(port: String)
    /// The deck identified itself and is streaming.
    case linked(port: String, identity: LSKIdentity)
    /// Explained in words meant for an operator, not a log.
    case failed(String)

    public var isLinked: Bool {
        if case .linked = self { return true }
        return false
    }

    public var port: String? {
        switch self {
        case .connecting(let port): return port
        case .linked(let port, _): return port
        case .off, .failed: return nil
        }
    }
}
