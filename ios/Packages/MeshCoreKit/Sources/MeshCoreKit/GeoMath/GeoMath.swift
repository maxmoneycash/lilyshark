//
//  GeoMath.swift
//  MeshCoreKit
//
//  Geographic calculations: haversine distance, bearing, great-circle interpolation.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

public enum GeoMath {

    /// Earth radius in meters (WGS-84 mean).
    public static let earthRadius: Double = 6_371_000.0

    /// Haversine distance between two points in meters.
    public static func haversineDistance(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ) -> Double {
        let dLat = (lat2 - lat1) * .pi / 180.0
        let dLon = (lon2 - lon1) * .pi / 180.0
        let rLat1 = lat1 * .pi / 180.0
        let rLat2 = lat2 * .pi / 180.0

        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(rLat1) * cos(rLat2) *
                sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadius * c
    }

    /// Initial bearing from point 1 to point 2 in degrees (0-360).
    public static func bearing(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ) -> Double {
        let rLat1 = lat1 * .pi / 180.0
        let rLat2 = lat2 * .pi / 180.0
        let dLon = (lon2 - lon1) * .pi / 180.0

        let y = sin(dLon) * cos(rLat2)
        let x = cos(rLat1) * sin(rLat2) - sin(rLat1) * cos(rLat2) * cos(dLon)
        let theta = atan2(y, x)
        return theta.truncatingRemainder(dividingBy: 2 * .pi) * 180.0 / .pi
    }

    /// Intermediate point at fraction f (0..1) along the great circle from A to B.
    public static func intermediatePoint(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double,
        fraction: Double
    ) -> (latitude: Double, longitude: Double) {
        let rLat1 = lat1 * .pi / 180.0
        let rLon1 = lon1 * .pi / 180.0
        let rLat2 = lat2 * .pi / 180.0
        let rLon2 = lon2 * .pi / 180.0

        let d = haversineDistance(lat1: lat1, lon1: lon1, lat2: lat2, lon2: lon2) / earthRadius
        guard d > 0 else { return (lat1, lon1) }

        let a = sin((1 - fraction) * d) / sin(d)
        let b = sin(fraction * d) / sin(d)

        let x = a * cos(rLat1) * cos(rLon1) + b * cos(rLat2) * cos(rLon2)
        let y = a * cos(rLat1) * sin(rLon1) + b * cos(rLat2) * sin(rLon2)
        let z = a * sin(rLat1) + b * sin(rLat2)

        let lat = atan2(z, sqrt(x * x + y * y)) * 180.0 / .pi
        let lon = atan2(y, x) * 180.0 / .pi
        return (lat, lon)
    }

    /// Generate evenly-spaced sample coordinates along a great-circle path.
    public static func samplePoints(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double,
        count: Int
    ) -> [(latitude: Double, longitude: Double)] {
        guard count >= 2 else { return [(lat1, lon1)] }
        return (0..<count).map { i in
            let fraction = Double(i) / Double(count - 1)
            return intermediatePoint(lat1: lat1, lon1: lon1, lat2: lat2, lon2: lon2, fraction: fraction)
        }
    }

    /// Adaptive sample count based on path distance.
    public static func adaptiveSampleCount(distanceMeters: Double) -> Int {
        switch distanceMeters {
        case ..<1_000:     return 20
        case ..<5_000:     return 50
        case ..<20_000:    return 100
        case ..<50_000:    return 200
        default:           return min(500, Int(distanceMeters / 100))
        }
    }

    /// Format distance for display: meters for short, km for long.
    public static func formatDistance(_ meters: Double) -> String {
        if meters < 1_000 {
            return String(format: "%.0f m", meters)
        } else {
            return String(format: "%.1f km", meters / 1_000)
        }
    }

    /// Format elevation for display.
    public static func formatElevation(_ meters: Double) -> String {
        String(format: "%.0f m", meters)
    }
}
