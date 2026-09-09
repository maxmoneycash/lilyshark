import Foundation

/// Firmware LCD frames shown on the T-Deck model, matching the website intro.
struct TDeckScreen: Identifiable, Hashable, Sendable {
    let fileName: String
    let title: String
    let detail: String

    var id: String { fileName }

    static let all: [TDeckScreen] = groups.flatMap(\.screens)

    struct Group: Sendable {
        let headline: String
        let screens: [TDeckScreen]
    }

    static let groups: [Group] = [
        Group(headline: "Turn a $60 handheld into a LoRa packet sniffer.", screens: [
            .init("splash", "Splash", "The deck’s own splash screen."),
            .init("home", "Home", "Home after setup, with the tools this firmware actually ships."),
        ]),
        Group(headline: "Mesh networks already carry hundreds of thousands of users.", screens: [
            .init("traffic", "Traffic", "The analyzer’s traffic list."),
            .init("traffic-live", "Live traffic", "Frames as they arrive, with protocol and RF fields."),
            .init("protocols", "Protocols", "Per-protocol totals from this capture."),
            .init("protocol-detail", "Protocol detail", "One protocol opened from that roster."),
            .init("nodes", "Nodes", "Every node the radio has a record for."),
        ]),
        Group(headline: "LoRa carries kilometers per hop, not meters.", screens: [
            .init("map", "Map", "Positions the radio has actually reported."),
            .init("node-detail", "Node detail", "SNR, RSSI, hops, and last-heard for one peer."),
            .init("survey", "Survey", "Coverage capture for a walk or drive."),
        ]),
        Group(headline: "Flooded meshes deliver less as they grow.", screens: [
            .init("utilization", "Channel utilization", "How much of the channel is actually busy."),
            .init("timeline", "Timeline", "Rate, SNR, and CRC on one clock."),
            .init("timeline-live", "Live timeline", "The same clock while frames are still arriving."),
            .init("traffic-filter", "Traffic filter", "Protocol and field filtering on the device."),
        ]),
        Group(headline: "The firmware measures everything the radio hears.", screens: [
            .init("spectrum", "Spectrum", "Band scan from the radio."),
            .init("spectrum-live", "Live spectrum", "Waterfall with noise floor and occupancy."),
            .init("spectrum-warning", "Spectrum warning", "When the band is too busy to treat as quiet."),
        ]),
        Group(headline: "Every anomaly becomes a logged event.", screens: [
            .init("events", "Events", "The running device history."),
            .init("event-detail", "Event detail", "One event opened with its cause."),
        ]),
        Group(headline: "Three mesh protocols, one capture engine.", screens: [
            .init("packet-detail", "Packet detail", "One frame with its measured fields."),
            .init("packet-live", "Live packet", "A packet while the radio is still hearing others."),
            .init("packet-pkt", "Packet fields", "The PKT tab."),
            .init("packet-rf", "Radio fields", "The RF tab."),
            .init("packet-dec", "Decode", "The DEC tab."),
        ]),
        Group(headline: "Down to the last byte.", screens: [
            .init("packet-hex", "Hex", "Raw bytes, page 1."),
            .init("packet-hex-2", "Hex page 2", "Raw bytes, page 2."),
            .init("packet-hex-3", "Hex page 3", "Raw bytes, page 3."),
            .init("packet-raw", "Raw", "The RAW tab."),
        ]),
        Group(headline: "A guided first run, not a config file.", screens: [
            .init("setup-welcome", "Setup welcome", "First-run welcome on the deck."),
            .init("setup-capabilities", "Capabilities", "What this hardware can do."),
            .init("setup-network", "Network", "Network selection on the device."),
            .init("setup-profile", "Radio profile", "Choosing a radio profile on the device."),
        ]),
        Group(headline: "It teaches its own controls.", screens: [
            .init("setup-controls", "Controls", "Trackball, keyboard, and shortcuts."),
            .init("setup-ready", "Ready", "The hardware check before Home."),
            .init("device-status", "Device status", "Radio, storage, GPS, and battery."),
            .init("help", "Help", "Help that lives on the deck."),
        ]),
        Group(headline: "Every control lives on the device.", screens: [
            .init("settings", "Settings", "Device settings."),
            .init("radio-profile", "Radio profile", "Spreading factor and related radio settings."),
            .init("display-input", "Display and input", "Display and input settings."),
            .init("about", "About", "About this firmware."),
            .init("reset-setup", "Reset setup", "Resetting first-run setup."),
        ]),
        Group(headline: "Captures are stored on Shelby.", screens: [
            .init("storage", "Storage", "Capture storage and the 82-byte pointer."),
        ]),
    ]

    private init(_ fileName: String, _ title: String, _ detail: String) {
        self.fileName = fileName
        self.title = title
        self.detail = detail
    }

    static func imageURL(for fileName: String) -> URL? {
        existingResource([
            Bundle.main.url(forResource: fileName, withExtension: "png", subdirectory: "TDeck/screens"),
            Bundle.main.resourceURL?.appendingPathComponent("TDeck/screens/\(fileName).png"),
            Bundle.main.url(forResource: fileName, withExtension: "png"),
        ])
    }

    static var modelURL: URL? {
        existingResource([
            Bundle.main.url(forResource: "tdeck-plus", withExtension: "usdz", subdirectory: "TDeck"),
            Bundle.main.resourceURL?.appendingPathComponent("TDeck/tdeck-plus.usdz"),
            Bundle.main.url(forResource: "tdeck-plus", withExtension: "scn", subdirectory: "TDeck"),
            Bundle.main.resourceURL?.appendingPathComponent("TDeck/tdeck-plus.scn"),
        ])
    }

    static var environmentURL: URL? {
        existingResource([
            Bundle.main.url(forResource: "blender-forest-512", withExtension: "exr", subdirectory: "TDeck"),
            Bundle.main.resourceURL?.appendingPathComponent("TDeck/blender-forest-512.exr"),
        ])
    }

    private static func existingResource(_ urls: [URL?]) -> URL? {
        urls.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.path) }
    }
}
