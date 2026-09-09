#if !os(watchOS)
import SwiftUI
import MeshCoreKit
import CoreLocation
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif

struct RadioVisibilityView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(DeviceConfig.self) private var config
    @Environment(ContactStore.self) private var contacts
    @Environment(\.dismiss) private var dismiss
    @State private var announcementRequested = false

    private var position: CLLocationCoordinate2D? {
        RadioMapPosition.reportedCoordinate(connection: connection, config: config, contacts: contacts)
    }
    private var hasReportedSettings: Bool {
        !connection.isMeshtasticLinkActive && config.loadedSections.contains("selfInfo")
    }

    @ViewBuilder private var companionRadioSettings: some View {
        #if canImport(MeshtasticKit)
        if let report = connection.reportedMeshtasticLoRa, connection.isMeshtasticLinkActive {
            LabeledContent("Frequency", value: report.frequencyMHz.map { String(format: "%.3f MHz", $0) } ?? "Not reported")
            LabeledContent("Bandwidth", value: report.bandwidthKHz.map { String(format: "%.2f kHz", $0) } ?? (report.usePreset ? "Set by preset" : "Not reported"))
            if let factor = report.spreadingFactor, let rate = report.codingRate {
                LabeledContent("Modulation", value: "SF\(factor) · CR \(rate)")
            } else {
                LabeledContent("Modulation", value: report.usePreset ? "Preset \(report.modemPreset)" : "Not reported")
            }
            LabeledContent("Transmit", value: report.txEnabled ? "Enabled" : "Disabled")
            LabeledContent("TX power", value: report.txPower.map { $0 == 0 ? "Automatic" : "\($0) dBm" } ?? "Not reported")
            if report.frequencyMHz == nil {
                Text("The radio did not report its exact center frequency. Check the active profile on the T-Deck.")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
        } else { missingRadioSettings }
        #else
        missingRadioSettings
        #endif
    }

    private var missingRadioSettings: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Label("Radio settings not reported", systemImage: "questionmark.circle")
            Text("This app has not received a supported radio-settings report. Check frequency, bandwidth and modulation on the T-Deck.")
                .font(.caption).foregroundStyle(MeshTheme.textSecondary)
        }
    }

    var body: some View {
        List {
            Section {
                Label(connection.isActivelyConnected ? (connection.connectedDeviceName ?? "Radio connected") : "No radio connected",
                      systemImage: connection.isActivelyConnected ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right.slash")
                    .font(.headline)
                if !connection.isActivelyConnected {
                    Text("Connect your T-Deck to check its identity, radio settings, and reported position.")
                        .foregroundStyle(MeshTheme.textSecondary)
                    Button {
                        dismiss()
                        connection.requestShowScanner = true
                    } label: {
                        Text("Connect radio").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.meshPrimary)
                } else {
                    LabeledContent("Name", value: config.deviceName.isEmpty ? "Not reported" : config.deviceName)
                    LabeledContent("Link protocol", value: connection.isMeshtasticLinkActive ? "Meshtastic" : "MeshCore")
                    if hasReportedSettings {
                        LabeledContent("Role", value: config.selfType == 2 ? "Repeater" : config.selfType == 3 ? "Room server" : "Companion")
                    }
                    if !config.publicKeyHex.isEmpty {
                        Text(config.publicKeyHex).font(.caption.monospaced()).textSelection(.enabled)
                    }
                    Text("A Lilyshark radio can expose a Meshtastic companion link. The active RF profile determines what it hears over the air.")
                        .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                }
            } header: { Text("My radio") }
            if connection.isActivelyConnected {
                Section("Reported radio settings") {
                    if hasReportedSettings {
                    LabeledContent("Frequency", value: String(format: "%.3f MHz", Double(config.radioFrequency) / 1000))
                    LabeledContent("Bandwidth", value: String(format: "%.2f kHz", Double(config.radioBandwidth) / 1000))
                    LabeledContent("Modulation", value: "SF\(config.radioSpreadingFactor) · CR \(config.radioCodingRate)")
                    } else {
                        companionRadioSettings
                    }
                    Text("These must match the local mesh. MeshCore and Meshtastic traffic belong to different networks even when they use the same hardware.")
                        .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                }
                Section("Radio position") {
                    if let position {
                        LabeledContent("Reported coordinates", value: String(format: "%.5f, %.5f", position.latitude, position.longitude))
                        Text("My mesh marks this position separately from the phone’s blue location dot. A configured position may be older than your current location.")
                    } else {
                        Label("No usable position reported", systemImage: "mappin.slash")
                        Text("Allow the T-Deck to obtain a GPS fix outdoors, or configure location sharing in radio settings. Phone GPS alone does not mean the radio is advertising a position.")
                    }
                }
            }
            Section("Public map visibility") {
                Text("Community coverage maps show repeaters and contributed observations. A powered-on handheld is not automatically a public map entry.")
                Text("A repeater must be heard by the region’s observers. Handheld coverage is contributed through an authenticated survey session with location access and an internet connection.")
                if connection.isActivelyConnected && !connection.isMeshtasticLinkActive {
                    Button("Request local announcement") {
                        connection.sendAdvertise()
                        announcementRequested = true
                    }
                    if announcementRequested {
                        Text("Announcement requested. This does not confirm reception or a public map listing.")
                            .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                    }
                }
                Text("Public survey upload is not connected yet. A local announcement only sends over the radio; it does not publish your position to the internet.")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .textSelection(.enabled)
        .navigationTitle("My radio")
    }
}
/// Resolve a radio's own position using protocol field presence. In particular,
/// Meshtastic 0,0 is a valid reported position and stale DeviceConfig defaults are not.
@MainActor enum RadioMapPosition {
    static func reportedCoordinate(connection: ConnectionManager, config: DeviceConfig, contacts: ContactStore) -> CLLocationCoordinate2D? {
        guard connection.isActivelyConnected else { return nil }
        if connection.isMeshtasticLinkActive {
            #if canImport(MeshtasticKit)
            guard config.loadedSections.contains("selfInfo"),
                  let nodeNum = UInt32(config.publicKeyHex, radix: 16), nodeNum != 0 else { return nil }
            let prefix = Data(MeshtasticIdentity.syntheticKey(forNodeNum: nodeNum).prefix(MeshtasticIdentity.prefixLength))
            guard let point = contacts.nodePositions[prefix] else { return nil }
            let coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
            return CLLocationCoordinate2DIsValid(coordinate) ? coordinate : nil
            #else
            return nil
            #endif
        }
        guard config.loadedSections.contains("selfInfo"), config.latitude != 0 || config.longitude != 0 else { return nil }
        let coordinate = CLLocationCoordinate2D(latitude: config.latitude, longitude: config.longitude)
        return CLLocationCoordinate2DIsValid(coordinate) ? coordinate : nil
    }
}
#endif
