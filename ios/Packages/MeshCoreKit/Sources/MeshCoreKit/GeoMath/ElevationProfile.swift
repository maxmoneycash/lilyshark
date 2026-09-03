//
//  ElevationProfile.swift
//  MeshCoreKit
//
//  Data models for Line of Sight terrain analysis.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// A single elevation sample along a terrain path.
public struct ElevationPoint: Sendable {
    public let latitude: Double
    public let longitude: Double
    public let elevation: Double          // meters above sea level
    public let distanceFromStart: Double  // meters along the path

    public init(latitude: Double, longitude: Double, elevation: Double, distanceFromStart: Double) {
        self.latitude = latitude
        self.longitude = longitude
        self.elevation = elevation
        self.distanceFromStart = distanceFromStart
    }
}

/// An endpoint (or relay point) in the LoS analysis.
public struct LoSEndpoint: Sendable {
    public let latitude: Double
    public let longitude: Double
    public let groundElevation: Double  // meters ASL
    public let antennaHeight: Double    // meters above ground

    public var totalHeight: Double { groundElevation + antennaHeight }

    public init(latitude: Double, longitude: Double, groundElevation: Double, antennaHeight: Double) {
        self.latitude = latitude
        self.longitude = longitude
        self.groundElevation = groundElevation
        self.antennaHeight = antennaHeight
    }
}

/// Result of LoS analysis for a single path segment.
public struct LoSSegmentResult: Sendable {
    public let hasLineOfSight: Bool
    public let minClearance: Double            // meters (negative = obstructed)
    public let minClearanceDistance: Double     // meters from segment start
    public let fresnelClearancePercent: Double  // % of first Fresnel zone clear at worst point
    public let samples: [ProfileSample]        // per-sample computed values

    public init(hasLineOfSight: Bool, minClearance: Double, minClearanceDistance: Double,
                fresnelClearancePercent: Double, samples: [ProfileSample]) {
        self.hasLineOfSight = hasLineOfSight
        self.minClearance = minClearance
        self.minClearanceDistance = minClearanceDistance
        self.fresnelClearancePercent = fresnelClearancePercent
        self.samples = samples
    }
}

/// Per-sample computed values for rendering the terrain profile.
public struct ProfileSample: Sendable {
    public let distanceFromStart: Double  // meters (x-axis position)
    public let groundElevation: Double    // meters ASL (terrain height)
    public let losHeight: Double          // meters ASL (line of sight at this x)
    public let fresnelRadius: Double      // meters (first Fresnel zone radius)
    public let earthBulge: Double         // meters (earth curvature effect)
    public let clearance: Double          // meters (positive = clear, negative = blocked)
    public let fresnelPercent: Double     // % of Fresnel zone clear

    public init(distanceFromStart: Double, groundElevation: Double, losHeight: Double,
                fresnelRadius: Double, earthBulge: Double, clearance: Double, fresnelPercent: Double) {
        self.distanceFromStart = distanceFromStart
        self.groundElevation = groundElevation
        self.losHeight = losHeight
        self.fresnelRadius = fresnelRadius
        self.earthBulge = earthBulge
        self.clearance = clearance
        self.fresnelPercent = fresnelPercent
    }
}

/// Complete terrain profile between two endpoints, with zero or more relay points.
public struct TerrainProfile: Sendable {
    public let pointA: LoSEndpoint
    public let pointB: LoSEndpoint
    /// Relay points in order from A to B.
    public let repeaters: [LoSEndpoint]
    public let samples: [ElevationPoint]
    public let totalDistance: Double  // meters

    /// Convenience for single-repeater access.
    public var repeater: LoSEndpoint? { repeaters.first }

    public init(pointA: LoSEndpoint, pointB: LoSEndpoint, repeaters: [LoSEndpoint] = [],
                samples: [ElevationPoint], totalDistance: Double) {
        self.pointA = pointA
        self.pointB = pointB
        self.repeaters = repeaters
        self.samples = samples
        self.totalDistance = totalDistance
    }
}

/// Complete LoS analysis result.
public struct LoSResult: Sendable {
    public let profile: TerrainProfile
    /// Analysis of the direct A→B path (always computed for display).
    public let directSegment: LoSSegmentResult
    /// Analysis of each relay hop: [A→R1, R1→R2, …, Rn→B]. Empty when no relays.
    public let relaySegments: [LoSSegmentResult]
    public let overallPass: Bool
    public let frequencyMHz: Double

    /// Convenience for single-repeater access.
    public var segmentAtoRepeater: LoSSegmentResult? { relaySegments.first }
    public var segmentRepeaterToB: LoSSegmentResult? {
        guard relaySegments.count >= 2 else { return nil }
        return relaySegments.last
    }

    public init(profile: TerrainProfile, directSegment: LoSSegmentResult,
                relaySegments: [LoSSegmentResult], overallPass: Bool, frequencyMHz: Double) {
        self.profile = profile
        self.directSegment = directSegment
        self.relaySegments = relaySegments
        self.overallPass = overallPass
        self.frequencyMHz = frequencyMHz
    }
}
