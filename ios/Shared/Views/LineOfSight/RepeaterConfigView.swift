//
//  RepeaterConfigView.swift
//  PommeCore
//
//  Multi-relay configuration: add/remove relay hops, position, and antenna height.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import CoreLocation
import MeshCoreKit

struct RepeaterConfigView: View {
    @Environment(LineOfSightStore.self) private var store

    var body: some View {
        Section {
            ForEach(Array(store.relays.enumerated()), id: \.element.id) { i, _ in
                RelayCardView(index: i)
            }
            .onDelete { indexSet in
                indexSet.forEach { store.removeRelay(at: $0) }
            }

            if store.relays.count < 3 {
                Button {
                    store.addRelay()
                    store.clearCache()
                } label: {
                    Label("Add Relay", systemImage: "plus.circle")
                        .foregroundStyle(MeshTheme.accent)
                }
                .listRowBackground(MeshTheme.surface)
            }
        } header: {
            store.relays.isEmpty ? Text("Relay Repeaters") : Text("Relay Repeaters (\(store.relays.count))")
        }
    }
}

// MARK: - Relay Card

private struct RelayCardView: View {
    let index: Int
    @Environment(LineOfSightStore.self) private var store
    @Environment(ContactStore.self) private var contactStore
    @State private var coordLatText: String = ""
    @State private var coordLonText: String = ""

    private var contactsWithLocation: [Contact] {
        contactStore.contacts.filter { $0.latitude != 0 || $0.longitude != 0 }
    }

    private var relay: RelayConfig { store.relays[index] }

    private var title: String {
        store.relays.count > 1 ? "Relay \(index + 1)" : "Relay Repeater"
    }

    var body: some View {
        if store.relays.indices.contains(index) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(.orange)
                        .frame(width: 20)
                    Text(title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Button(role: .destructive) {
                        store.removeRelay(at: index)
                        store.clearCache()
                    } label: {
                        Image(systemName: "minus.circle.fill")
                            .foregroundStyle(.red.opacity(0.8))
                    }
                    .buttonStyle(.plain)
                }

                Picker("Source", selection: sourceBinding) {
                    Text("Position").tag(0)
                    Text("Contact").tag(1)
                    Text("Coords").tag(2)
                }
                .pickerStyle(.segmented)

                if relay.source == .slider {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Position: \(String(format: "%.0f%%", relay.sliderFraction * 100)) along path")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                        Slider(value: fractionBinding, in: 0.05...0.95)
                            .tint(.orange)
                    }
                } else if relay.source == .contact {
                    if contactsWithLocation.isEmpty {
                        Text("No contacts with GPS coordinates available")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    } else {
                        Picker("Contact", selection: contactBinding) {
                            Text("Select...").tag(Contact?.none)
                            ForEach(contactsWithLocation, id: \.publicKey) { contact in
                                HStack {
                                    Text(contactStore.displayName(for: contact))
                                    if contact.type == .repeater {
                                        Image(systemName: "antenna.radiowaves.left.and.right")
                                            .font(.caption2)
                                            .foregroundStyle(MeshTheme.textSecondary)
                                    }
                                }
                                .tag(Contact?.some(contact))
                            }
                        }
                        .foregroundStyle(MeshTheme.accent)
                        .tint(.primary)
                    }
                } else {
                    CoordinateInputField(label: "Latitude", placeholder: "e.g. 37.334900", text: $coordLatText, onChange: parseRelayCoordinates)
                    CoordinateInputField(label: "Longitude", placeholder: "e.g. -122.009020", text: $coordLonText, onChange: parseRelayCoordinates)
                    if relay.coordinates == nil && !coordLatText.isEmpty && !coordLonText.isEmpty {
                        Text("Enter a valid latitude (−90 to 90) and longitude (−180 to 180)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }

                HStack {
                    Text("Antenna")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Stepper(value: antennaBinding, in: 0.5...100, step: 0.5) {
                        Text(String(format: "%.1f m", relay.antennaHeight))
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }
            }
            .padding(.vertical, 4)
            .listRowBackground(MeshTheme.surface)
            .onAppear {
                if let coord = relay.coordinates, coordLatText.isEmpty, coordLonText.isEmpty {
                    coordLatText = String(coord.latitude)
                    coordLonText = String(coord.longitude)
                }
            }
        }
    }

    // MARK: - Bindings

    private var sourceBinding: Binding<Int> {
        Binding(
            get: {
                guard store.relays.indices.contains(index) else { return 0 }
                switch relay.source {
                case .slider: return 0
                case .contact: return 1
                case .coordinates: return 2
                }
            },
            set: { v in
                guard store.relays.indices.contains(index) else { return }
                switch v {
                case 1: store.relays[index].source = .contact
                case 2: store.relays[index].source = .coordinates
                default: store.relays[index].source = .slider
                }
                store.clearCache()
            }
        )
    }


    private func parseRelayCoordinates() {
        guard store.relays.indices.contains(index) else { return }
        guard !coordLatText.isEmpty, !coordLonText.isEmpty else { return }
        guard let lat = Double(coordLatText), let lon = Double(coordLonText),
              lat >= -90, lat <= 90, lon >= -180, lon <= 180 else {
            if store.relays[index].coordinates != nil { store.relays[index].coordinates = nil }
            return
        }
        let newCoord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        let current = store.relays[index].coordinates
        if current?.latitude != newCoord.latitude || current?.longitude != newCoord.longitude {
            store.relays[index].coordinates = newCoord
            store.clearCache()
        }
    }

    private var fractionBinding: Binding<Double> {
        Binding(
            get: { store.relays.indices.contains(index) ? relay.sliderFraction : 0.5 },
            set: { newValue in
                guard store.relays.indices.contains(index) else { return }
                let lower: Double = index > 0 ? store.relays[index - 1].sliderFraction + 0.05 : 0.05
                let upper: Double = index < store.relays.count - 1 ? store.relays[index + 1].sliderFraction - 0.05 : 0.95
                store.relays[index].sliderFraction = min(max(newValue, lower), upper)
                store.clearCache()
            }
        )
    }

    private var contactBinding: Binding<Contact?> {
        Binding(
            get: { store.relays.indices.contains(index) ? relay.contact : nil },
            set: { guard store.relays.indices.contains(index) else { return }; store.relays[index].contact = $0; store.clearCache() }
        )
    }

    private var antennaBinding: Binding<Double> {
        Binding(
            get: { store.relays.indices.contains(index) ? relay.antennaHeight : 7.0 },
            set: { guard store.relays.indices.contains(index) else { return }; store.relays[index].antennaHeight = $0; store.clearCache() }
        )
    }
}
