//
//  GeofencesView.swift
//  PommeCore
//
//  Manage safe zone geofences. When the device exits an enabled zone, a distress beacon
//  is sent automatically via the mesh radio.
//
//  Created by Michael P. Bedworth on 4/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MapKit
import MeshCoreKit

#if !os(watchOS)

struct GeofencesView: View {
    @Environment(GeofenceStore.self) private var geofenceStore
    @Environment(\.dismiss) private var dismiss

    @State private var showAddZone = false
    @State private var zoneToDelete: SafeZone?

    var body: some View {
        List {
            if !geofenceStore.monitoringAvailable {
                Section {
                    Label("Region monitoring is not available on this device.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                        .listRowBackground(MeshTheme.surface)
                }
            }

            Section {
                if geofenceStore.zones.isEmpty {
                    Text("No safe zones defined. Tap + to add one.")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .listRowBackground(MeshTheme.surface)
                } else {
                    ForEach(geofenceStore.zones) { zone in
                        ZoneRow(zone: zone)
                    }
                    .onDelete { offsets in
                        for idx in offsets { zoneToDelete = geofenceStore.zones[idx] }
                    }
                }
            } header: {
                SectionInfoHeader(
                    title: "Safe Zones",
                    info: "When you leave an enabled zone, PommeCore sends a flood advert and SOS message to the public channel. Requires \u{201C}Always\u{201D} location permission for background monitoring."
                )
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #else
        .listStyle(.inset)
        #endif
        .background(MeshTheme.background)
        .meshTheme()
        .navigationTitle("Safe Zones")
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button {
                    geofenceStore.requestAlwaysAuthorization()
                    showAddZone = true
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(!geofenceStore.monitoringAvailable)
            }
        }
        .sheet(isPresented: $showAddZone) {
            AddZoneView()
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 400, minHeight: 500)
            #endif
        }
        .alert("Delete Zone", isPresented: Binding(get: { zoneToDelete != nil }, set: { if !$0 { zoneToDelete = nil } })) {
            Button("Delete", role: .destructive) {
                if let z = zoneToDelete { geofenceStore.removeZone(z) }
                zoneToDelete = nil
            }
            Button("Cancel", role: .cancel) { zoneToDelete = nil }
        } message: {
            Text("Remove \"\(zoneToDelete?.name ?? "")\"?")
        }
    }
}

struct ZoneRow: View {
    let zone: SafeZone
    @Environment(GeofenceStore.self) private var geofenceStore

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: zone.isEnabled ? "shield.fill" : "shield")
                .foregroundStyle(zone.isEnabled ? .green : MeshTheme.textSecondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(zone.name)
                    .foregroundStyle(MeshTheme.textPrimary)
                Text(String(format: "%.5f, %.5f — radius %.0f m", zone.latitude, zone.longitude, zone.radiusMeters))
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }

            Spacer()

            Toggle("", isOn: Binding(
                get: { zone.isEnabled },
                set: { _ in geofenceStore.toggleZone(zone) }
            ))
            .labelsHidden()
            .tint(MeshTheme.accent)
        }
        .listRowBackground(MeshTheme.surface)
    }
}

struct AddZoneView: View {
    @Environment(GeofenceStore.self) private var geofenceStore
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var latText = ""
    @State private var lonText = ""
    @State private var radiusMeters: Double = 500
    @State private var useCurrentLocation = false

    private var latDouble: Double? { Double(latText) }
    private var lonDouble: Double? { Double(lonText) }
    private var canSave: Bool { !name.isEmpty && latDouble != nil && lonDouble != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Name")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        TextField("Home, Work, Camp...", text: $name)
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                    .listRowBackground(MeshTheme.surface)
                } header: {
                    Text("Zone")
                        .foregroundStyle(MeshTheme.accent)
                }

                Section {
                    HStack {
                        Text("Latitude")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        TextField("e.g. 37.33182", text: $latText)
                            #if os(iOS)
                            .keyboardType(.decimalPad)
                            #endif
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                    .listRowBackground(MeshTheme.surface)

                    HStack {
                        Text("Longitude")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        TextField("e.g. -122.03118", text: $lonText)
                            #if os(iOS)
                            .keyboardType(.decimalPad)
                            #endif
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                    .listRowBackground(MeshTheme.surface)

                    #if os(iOS)
                    Button {
                        if let loc = SharedLocation.manager.location {
                            latText = String(format: "%.6f", loc.coordinate.latitude)
                            lonText = String(format: "%.6f", loc.coordinate.longitude)
                        }
                    } label: {
                        Label("Use Current Location", systemImage: "location.fill")
                            .foregroundStyle(MeshTheme.accent)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(MeshTheme.surface)
                    #endif
                } header: {
                    Text("Center")
                        .foregroundStyle(MeshTheme.accent)
                }

                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Radius")
                                .foregroundStyle(MeshTheme.accent)
                            Spacer()
                            Text("\(Int(radiusMeters)) m")
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        Slider(value: $radiusMeters, in: 100...5000, step: 100)
                            .tint(MeshTheme.accent)
                    }
                    .listRowBackground(MeshTheme.surface)
                } header: {
                    Text("Alert Radius")
                        .foregroundStyle(MeshTheme.accent)
                }
            }
            .background(MeshTheme.background)
            .meshTheme()
            .navigationTitle("Add Safe Zone")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let lat = latDouble, let lon = lonDouble else { return }
                        geofenceStore.addZone(SafeZone(name: name, latitude: lat, longitude: lon, radiusMeters: radiusMeters))
                        dismiss()
                    }
                    .disabled(!canSave)
                }
            }
        }
    }
}

#endif
