//
//  LocationSuggestion.swift
//  PommeCore
//
//  One-shot country detection for regional preset filtering.
//  Uses the last known location from CoreLocation (no new permission prompt).
//  Result is cached in UserDefaults — detection runs at most once per device.
//  macOS returns nil; callers show a manual region picker instead.
//

import Foundation
#if os(iOS) && !targetEnvironment(macCatalyst)
import CoreLocation
#endif

enum LocationSuggestion {
    private static let cacheKey = "detectedCountryCode"

    /// Cached country code from a previous successful detection, or nil.
    static var cachedCountryCode: String? {
        UserDefaults.standard.string(forKey: cacheKey)
    }

    /// Returns the cached country code immediately if present, otherwise detects
    /// once using the last known location (iOS only). Stores result in UserDefaults.
    static func detectIfNeeded() async -> String? {
        if let cached = cachedCountryCode { return cached }

        #if os(iOS) && !targetEnvironment(macCatalyst)
        let manager = CLLocationManager()
        guard manager.authorizationStatus == .authorizedWhenInUse
                || manager.authorizationStatus == .authorizedAlways,
              let location = manager.location else { return nil }

        guard let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location),
              let code = placemarks.first?.isoCountryCode else { return nil }

        UserDefaults.standard.set(code, forKey: cacheKey)
        return code
        #else
        return nil
        #endif
    }

    /// Clears the cached country code so detection will run again next time.
    static func clearCache() {
        UserDefaults.standard.removeObject(forKey: cacheKey)
    }
}
