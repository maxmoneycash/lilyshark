//
//  PointSelectionView.swift
//  PommeCore
//
//  Reusable picker for selecting an LoS endpoint: GPS, Contact, Map Pin, or Coordinates.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import CoreLocation
import MeshCoreKit

struct PointSelectionView: View {
    let label: LocalizedStringKey
    @Binding var source: LoSPointSource
    @Binding var contact: Contact?
    @Binding var mapPin: CLLocationCoordinate2D?
    @Binding var coordinates: CLLocationCoordinate2D?
    @State private var showMapPicker = false
    @State private var latText: String = ""
    @State private var lonText: String = ""

    @Environment(ContactStore.self) private var contactStore
    @Environment(LineOfSightStore.self) private var store

    private var contactsWithLocation: [Contact] {
        contactStore.contacts.filter { $0.latitude != 0 || $0.longitude != 0 }
    }

    var body: some View {
        Section {
            Picker(label, selection: $source) {
                ForEach(LoSPointSource.allCases, id: \.self) { s in
                    Text(s.rawValue).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .listRowBackground(MeshTheme.surface)

            switch source {
            case .gps:
                if let loc = store.userLocationProvider?() {
                    coordinateRow(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
                } else {
                    HStack {
                        Image(systemName: "location.slash")
                            .foregroundStyle(.orange)
                        Text("Location unavailable")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    .listRowBackground(MeshTheme.surface)
                }

            case .contact:
                if contactsWithLocation.isEmpty {
                    Text("No contacts with GPS coordinates")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .listRowBackground(MeshTheme.surface)
                } else {
                    Picker("Contact", selection: $contact) {
                        Text("Select...").tag(Contact?.none)
                        ForEach(contactsWithLocation, id: \.publicKey) { c in
                            HStack {
                                Text(contactStore.displayName(for: c))
                                if c.type == .repeater {
                                    Image(systemName: "antenna.radiowaves.left.and.right")
                                        .font(.caption2)
                                        .foregroundStyle(MeshTheme.textSecondary)
                                }
                            }
                            .tag(Contact?.some(c))
                        }
                    }
                    .foregroundStyle(MeshTheme.accent)
                    .tint(.primary)
                    .listRowBackground(MeshTheme.surface)

                    if let c = contact {
                        coordinateRow(lat: c.latitude, lon: c.longitude)
                    }
                }

            case .mapPin:
                if let pin = mapPin {
                    coordinateRow(lat: pin.latitude, lon: pin.longitude)
                }
                Button {
                    showMapPicker = true
                } label: {
                    (mapPin == nil ? Label("Drop Pin on Map", systemImage: "mappin.and.ellipse") : Label("Change Pin", systemImage: "mappin.and.ellipse"))
                        .foregroundStyle(MeshTheme.accent)
                }
                .listRowBackground(MeshTheme.surface)
                #if !os(watchOS)
                .sheet(isPresented: $showMapPicker) {
                    MapPointPickerView(selectedCoordinate: $mapPin)
                }
                #endif

            case .coordinates:
                CoordinateInputField(label: "Latitude", placeholder: "e.g. 37.334900", text: $latText, onChange: parseCoordinates)
                CoordinateInputField(label: "Longitude", placeholder: "e.g. -122.009020", text: $lonText, onChange: parseCoordinates)
                if let coord = coordinates {
                    coordinateRow(lat: coord.latitude, lon: coord.longitude)
                } else if !latText.isEmpty && !lonText.isEmpty {
                    Text("Enter a valid latitude (−90 to 90) and longitude (−180 to 180)")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .listRowBackground(MeshTheme.surface)
                }
            }
        } header: {
            Text(label)
        }
        .onAppear {
            if let coord = coordinates, latText.isEmpty, lonText.isEmpty {
                latText = String(coord.latitude)
                lonText = String(coord.longitude)
            }
        }
    }

    private func parseCoordinates() {
        guard !latText.isEmpty, !lonText.isEmpty else { return }
        guard let lat = Double(latText), let lon = Double(lonText),
              lat >= -90, lat <= 90, lon >= -180, lon <= 180 else {
            if coordinates != nil { coordinates = nil }
            return
        }
        let newCoord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        if coordinates?.latitude != newCoord.latitude || coordinates?.longitude != newCoord.longitude {
            coordinates = newCoord
        }
    }

    private func coordinateRow(lat: Double, lon: Double) -> some View {
        HStack {
            Image(systemName: "location")
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 24)
            Text(String(format: "%.6f, %.6f", lat, lon))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .listRowBackground(MeshTheme.surface)
    }
}
