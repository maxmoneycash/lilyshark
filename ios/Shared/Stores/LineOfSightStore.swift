//
//  LineOfSightStore.swift
//  PommeCore
//
//  @Observable store for Line of Sight terrain analysis state.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import CoreLocation
import MeshCoreKit

/// Source for selecting an LoS endpoint.
enum LoSPointSource: String, CaseIterable {
    case gps = "My Location"
    case contact = "Contact"
    case mapPin = "Map Pin"
    case coordinates = "Coordinates"
}

/// Source for relay placement.
enum RepeaterSource {
    case slider
    case contact
    case coordinates
}

/// Configuration for a single relay hop.
struct RelayConfig: Identifiable {
    let id = UUID()
    var source: RepeaterSource = .slider
    var sliderFraction: Double = 0.5
    var contact: Contact?
    var coordinates: CLLocationCoordinate2D?
    var antennaHeight: Double = 7.0
}

@MainActor @Observable
final class LineOfSightStore {

    // MARK: - Point Selection

    var pointASource: LoSPointSource = .gps
    var pointBSource: LoSPointSource = .contact
    var pointAContact: Contact?
    var pointBContact: Contact?
    var pointAMapPin: CLLocationCoordinate2D?
    var pointBMapPin: CLLocationCoordinate2D?
    var pointACoordinates: CLLocationCoordinate2D?
    var pointBCoordinates: CLLocationCoordinate2D?

    // MARK: - Relays

    /// Ordered relay hops from A to B. Max 3.
    var relays: [RelayConfig] = []

    func addRelay() {
        guard relays.count < 3 else { return }
        // Default new relays to evenly-spaced positions
        let fraction: Double
        switch relays.count {
        case 0: fraction = 0.5
        case 1: fraction = relays[0].sliderFraction > 0.5 ? 0.25 : 0.75
        default: fraction = 0.5
        }
        relays.append(RelayConfig(source: .slider, sliderFraction: fraction))
    }

    func removeRelay(at index: Int) {
        guard relays.indices.contains(index) else { return }
        relays.remove(at: index)
    }

    // MARK: - Settings

    var antennaHeightA: Double = 7.0
    var antennaHeightB: Double = 7.0
    var frequencyMHz: Double = 910.525
    var manualFrequencyOverride = false

    // MARK: - State

    var isAnalyzing = false
    var currentResult: LoSResult?
    var errorMessage: String?

    // MARK: - Dependencies

    var userLocationProvider: (() -> CLLocation?)?

    // MARK: - Session Cache

    private var resultCache: [String: LoSResult] = [:]

    // MARK: - Public Methods

    func loadFromDeviceConfig(_ config: DeviceConfig) {
        guard !manualFrequencyOverride else { return }
        frequencyMHz = config.frequencyMHz
    }

    /// Pre-configure for analyzing path to a specific contact.
    func configureForContact(_ contact: Contact) {
        pointASource = .gps
        pointBSource = .contact
        pointBContact = contact
        currentResult = nil
        errorMessage = nil
    }

    /// Pre-configure for two map pins.
    func configureForMapPins(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) {
        pointASource = .mapPin
        pointBSource = .mapPin
        pointAMapPin = a
        pointBMapPin = b
        currentResult = nil
        errorMessage = nil
    }

    /// Resolve the configured points to lat/lon coordinates.
    func resolveCoordinates() -> (latA: Double, lonA: Double, latB: Double, lonB: Double)? {
        guard let a = resolvePoint(pointASource, contact: pointAContact, mapPin: pointAMapPin, coordinates: pointACoordinates),
              let b = resolvePoint(pointBSource, contact: pointBContact, mapPin: pointBMapPin, coordinates: pointBCoordinates) else {
            return nil
        }
        return (a.latitude, a.longitude, b.latitude, b.longitude)
    }

    /// Run the full LoS analysis.
    func runAnalysis() async {
        guard let coords = resolveCoordinates() else {
            errorMessage = "Select both points before analyzing."
            return
        }

        // Check cache
        let key = cacheKey(coords)
        if let cached = resultCache[key] {
            currentResult = cached
            return
        }

        isAnalyzing = true
        errorMessage = nil
        currentResult = nil

        do {
            // Resolve relay coordinates, sorting by distance from A
            let resolvedRelays: [(lat: Double, lon: Double, antennaHeight: Double)] = relays
                .compactMap { relay -> (lat: Double, lon: Double, antennaHeight: Double)? in
                    guard let coord = resolveRelayCoord(relay, coords: coords) else { return nil }
                    return (coord.latitude, coord.longitude, relay.antennaHeight)
                }
                .sorted {
                    GeoMath.haversineDistance(lat1: coords.latA, lon1: coords.lonA, lat2: $0.lat, lon2: $0.lon) <
                    GeoMath.haversineDistance(lat1: coords.latA, lon1: coords.lonA, lat2: $1.lat, lon2: $1.lon)
                }

            let profile = try await ElevationService.shared.buildTerrainProfile(
                latA: coords.latA, lonA: coords.lonA, antennaHeightA: antennaHeightA,
                latB: coords.latB, lonB: coords.lonB, antennaHeightB: antennaHeightB,
                relays: resolvedRelays
            )

            let result = LineOfSightCalculator.analyze(
                profile: profile,
                frequencyMHz: frequencyMHz
            )

            currentResult = result
            resultCache[key] = result
            isAnalyzing = false
        } catch {
            errorMessage = error.localizedDescription
            isAnalyzing = false
        }
    }

    func clearResults() {
        currentResult = nil
        errorMessage = nil
        resultCache.removeAll()
    }

    func clearCache() {
        resultCache.removeAll()
    }

    // MARK: - Private

    private func resolvePoint(_ source: LoSPointSource, contact: Contact?, mapPin: CLLocationCoordinate2D?, coordinates: CLLocationCoordinate2D?) -> CLLocationCoordinate2D? {
        switch source {
        case .gps:
            guard let loc = userLocationProvider?() else { return nil }
            return loc.coordinate
        case .contact:
            guard let c = contact, c.latitude != 0 || c.longitude != 0 else { return nil }
            return CLLocationCoordinate2D(latitude: c.latitude, longitude: c.longitude)
        case .mapPin:
            return mapPin
        case .coordinates:
            return coordinates
        }
    }

    func resolveRelayCoord(_ relay: RelayConfig, coords: (latA: Double, lonA: Double, latB: Double, lonB: Double)) -> CLLocationCoordinate2D? {
        switch relay.source {
        case .slider:
            let pt = GeoMath.intermediatePoint(
                lat1: coords.latA, lon1: coords.lonA,
                lat2: coords.latB, lon2: coords.lonB,
                fraction: relay.sliderFraction
            )
            return CLLocationCoordinate2D(latitude: pt.latitude, longitude: pt.longitude)
        case .contact:
            guard let c = relay.contact, c.latitude != 0 || c.longitude != 0 else { return nil }
            return CLLocationCoordinate2D(latitude: c.latitude, longitude: c.longitude)
        case .coordinates:
            return relay.coordinates
        }
    }

    private func cacheKey(_ c: (latA: Double, lonA: Double, latB: Double, lonB: Double)) -> String {
        var key = String(format: "%.4f,%.4f->%.4f,%.4f@%.1f|%.1f|%.1f",
                         c.latA, c.lonA, c.latB, c.lonB, frequencyMHz, antennaHeightA, antennaHeightB)
        for (i, relay) in relays.enumerated() {
            if let coord = resolveRelayCoord(relay, coords: c) {
                key += String(format: "|R%d:%.4f,%.4f@%.1f", i, coord.latitude, coord.longitude, relay.antennaHeight)
            }
        }
        return key
    }
}
