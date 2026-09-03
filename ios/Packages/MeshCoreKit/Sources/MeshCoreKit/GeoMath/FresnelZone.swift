//
//  FresnelZone.swift
//  MeshCoreKit
//
//  RF calculations: Fresnel zone radius, earth bulge, atmospheric refraction.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

public enum FresnelZone {

    /// Speed of light in m/s.
    public static let speedOfLight: Double = 299_792_458.0

    /// Standard atmospheric refraction K factor (4/3 earth radius model).
    public static let standardKFactor: Double = 4.0 / 3.0

    /// First Fresnel zone radius at a point along the path.
    ///
    /// Formula: r = sqrt(n * lambda * d1 * d2 / (d1 + d2))
    /// where n=1 for first Fresnel zone, lambda = c/f
    public static func fresnelRadius(
        frequencyMHz: Double,
        distanceFromA: Double,  // meters
        distanceFromB: Double   // meters
    ) -> Double {
        guard frequencyMHz > 0, distanceFromA > 0, distanceFromB > 0 else { return 0 }
        let lambda = speedOfLight / (frequencyMHz * 1_000_000.0)
        return sqrt(lambda * distanceFromA * distanceFromB / (distanceFromA + distanceFromB))
    }

    /// Earth bulge height at a point along the path.
    ///
    /// Formula: h = (d1 * d2) / (2 * K * R)
    /// Accounts for earth curvature making the ground "higher" at midpoints.
    public static func earthBulge(
        distanceFromA: Double,  // meters
        distanceFromB: Double,  // meters
        kFactor: Double = standardKFactor
    ) -> Double {
        guard kFactor > 0 else { return 0 }
        return (distanceFromA * distanceFromB) / (2.0 * kFactor * GeoMath.earthRadius)
    }

    /// Line of sight height at a given distance, linearly interpolated between antenna tips.
    public static func losHeight(
        heightA: Double,       // total height at A (ground + antenna) meters ASL
        heightB: Double,       // total height at B meters ASL
        distanceFromA: Double, // meters
        totalDistance: Double   // meters
    ) -> Double {
        guard totalDistance > 0 else { return heightA }
        let fraction = distanceFromA / totalDistance
        return heightA + fraction * (heightB - heightA)
    }

    /// Clearance at a point: LoS height minus effective ground height.
    /// Positive = clear, negative = obstructed.
    public static func clearance(
        losHeight: Double,
        groundElevation: Double,
        earthBulge: Double
    ) -> Double {
        losHeight - (groundElevation + earthBulge)
    }

    /// Fresnel clearance percentage: how much of the first Fresnel zone is clear.
    /// >= 60% is considered adequate for reliable RF propagation.
    /// >= 100% means the full first Fresnel zone is unobstructed.
    public static func fresnelPercent(clearance: Double, fresnelRadius: Double) -> Double {
        guard fresnelRadius > 0 else { return clearance >= 0 ? 100 : 0 }
        return (clearance / fresnelRadius) * 100.0
    }

    /// Maximum first Fresnel zone radius for a path (occurs at midpoint).
    /// Useful for quick "worst case" Fresnel zone size estimation.
    public static func maxFresnelRadius(frequencyMHz: Double, totalDistance: Double) -> Double {
        fresnelRadius(frequencyMHz: frequencyMHz,
                      distanceFromA: totalDistance / 2,
                      distanceFromB: totalDistance / 2)
    }

    /// Wavelength in meters for a given frequency in MHz.
    public static func wavelength(frequencyMHz: Double) -> Double {
        guard frequencyMHz > 0 else { return 0 }
        return speedOfLight / (frequencyMHz * 1_000_000.0)
    }
}
