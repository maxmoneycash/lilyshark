//
//  GeofenceStore.swift
//  PommeCore
//
//  Safe zone geofences — triggers a distress beacon when the user exits a defined region.
//
//  Created by Michael P. Bedworth on 4/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import CoreLocation

struct SafeZone: Identifiable, Codable, Sendable {
    let id: UUID
    var name: String
    var latitude: Double
    var longitude: Double
    var radiusMeters: Double
    var isEnabled: Bool

    init(id: UUID = UUID(), name: String, latitude: Double, longitude: Double, radiusMeters: Double = 500, isEnabled: Bool = true) {
        self.id = id
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.radiusMeters = radiusMeters
        self.isEnabled = isEnabled
    }

    var center: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }

    var region: CLCircularRegion {
        let r = CLCircularRegion(center: center, radius: radiusMeters, identifier: id.uuidString)
        r.notifyOnExit = true
        r.notifyOnEntry = false
        return r
    }
}

extension SafeZone {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        latitude = try c.decodeIfPresent(Double.self, forKey: .latitude) ?? 0
        longitude = try c.decodeIfPresent(Double.self, forKey: .longitude) ?? 0
        radiusMeters = try c.decodeIfPresent(Double.self, forKey: .radiusMeters) ?? 500
        isEnabled = try c.decodeIfPresent(Bool.self, forKey: .isEnabled) ?? true
    }
}

// MARK: - CLLocationManagerDelegate (NSObject subclass — separate from @Observable store)

private final class GeofenceDelegate: NSObject, CLLocationManagerDelegate {
    weak var store: GeofenceStore?

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard let store, let zoneId = UUID(uuidString: region.identifier) else { return }
        Task { @MainActor [weak store] in
            guard let store else { return }
            let name = store.zones.first(where: { $0.id == zoneId })?.name ?? region.identifier
            store.lastExitZoneName = name
            store.distressAction?()
        }
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {}
}

// MARK: - GeofenceStore

@MainActor @Observable
final class GeofenceStore {

    private(set) var zones: [SafeZone] = []
    private(set) var monitoringAvailable: Bool = false
    var lastExitZoneName: String?

    /// Called when a region exit is detected. Set by PommeCoreViewModel to send distress beacon.
    var distressAction: (() -> Void)?

    private var locationManager: CLLocationManager?
    private var locationDelegate: GeofenceDelegate?

    private let storageURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("safezones.json")
    }()

    init() {
        load()
        setupLocationManager()
    }

    // MARK: - Zone Management

    func addZone(_ zone: SafeZone) {
        zones.append(zone)
        save()
        if zone.isEnabled { startMonitoring(zone) }
    }

    func updateZone(_ zone: SafeZone) {
        guard let idx = zones.firstIndex(where: { $0.id == zone.id }) else { return }
        let old = zones[idx]
        zones[idx] = zone
        save()
        stopMonitoring(old)
        if zone.isEnabled { startMonitoring(zone) }
    }

    func removeZone(_ zone: SafeZone) {
        stopMonitoring(zone)
        zones.removeAll { $0.id == zone.id }
        save()
    }

    func toggleZone(_ zone: SafeZone) {
        var updated = zone
        updated.isEnabled.toggle()
        updateZone(updated)
    }

    // MARK: - Location Manager Setup

    private func setupLocationManager() {
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            monitoringAvailable = false
            return
        }
        monitoringAvailable = true
        let delegate = GeofenceDelegate()
        delegate.store = self
        locationDelegate = delegate
        let mgr = CLLocationManager()
        mgr.delegate = delegate
        locationManager = mgr

        for zone in zones where zone.isEnabled { startMonitoring(zone) }
    }

    func requestAlwaysAuthorization() {
        #if os(iOS)
        locationManager?.requestAlwaysAuthorization()
        #endif
    }

    private func startMonitoring(_ zone: SafeZone) {
        locationManager?.startMonitoring(for: zone.region)
    }

    private func stopMonitoring(_ zone: SafeZone) {
        if let existing = locationManager?.monitoredRegions.first(where: { $0.identifier == zone.id.uuidString }) {
            locationManager?.stopMonitoring(for: existing)
        }
    }

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: storageURL),
              let decoded = try? JSONDecoder().decode([SafeZone].self, from: data) else { return }
        zones = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(zones) else { return }
        try? data.write(to: storageURL)
    }
}
