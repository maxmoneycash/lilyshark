//
//  LineOfSightCalculator.swift
//  MeshCoreKit
//
//  Core LoS analysis engine: profile analysis, clearance computation.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

public enum LineOfSightCalculator {

    /// Analyze a single path segment between two endpoints.
    public static func analyzeSegment(
        pointA: LoSEndpoint,
        pointB: LoSEndpoint,
        samples: [ElevationPoint],
        frequencyMHz: Double,
        kFactor: Double = FresnelZone.standardKFactor
    ) -> LoSSegmentResult {
        guard !samples.isEmpty else {
            return LoSSegmentResult(hasLineOfSight: false, minClearance: 0,
                                   minClearanceDistance: 0, fresnelClearancePercent: 0, samples: [])
        }

        let segmentStart = samples.first!.distanceFromStart
        let segmentEnd = samples.last!.distanceFromStart
        let segmentLength = segmentEnd - segmentStart

        var profileSamples: [ProfileSample] = []
        var worstClearance = Double.infinity
        var worstClearanceDistance: Double = 0
        var worstFresnelPercent: Double = 100

        for sample in samples {
            let dFromA = sample.distanceFromStart - segmentStart
            let dFromB = segmentLength - dFromA

            let los = FresnelZone.losHeight(
                heightA: pointA.totalHeight,
                heightB: pointB.totalHeight,
                distanceFromA: dFromA,
                totalDistance: segmentLength
            )

            let fresnel = FresnelZone.fresnelRadius(
                frequencyMHz: frequencyMHz,
                distanceFromA: dFromA,
                distanceFromB: dFromB
            )

            let bulge = FresnelZone.earthBulge(
                distanceFromA: dFromA,
                distanceFromB: dFromB,
                kFactor: kFactor
            )

            let clr = FresnelZone.clearance(
                losHeight: los,
                groundElevation: sample.elevation,
                earthBulge: bulge
            )

            let fresnelPct = FresnelZone.fresnelPercent(clearance: clr, fresnelRadius: fresnel)

            profileSamples.append(ProfileSample(
                distanceFromStart: sample.distanceFromStart,
                groundElevation: sample.elevation,
                losHeight: los,
                fresnelRadius: fresnel,
                earthBulge: bulge,
                clearance: clr,
                fresnelPercent: fresnelPct
            ))

            if clr < worstClearance {
                worstClearance = clr
                worstClearanceDistance = sample.distanceFromStart
                worstFresnelPercent = fresnelPct
            }
        }

        return LoSSegmentResult(
            hasLineOfSight: worstClearance >= 0,
            minClearance: worstClearance,
            minClearanceDistance: worstClearanceDistance,
            fresnelClearancePercent: worstFresnelPercent,
            samples: profileSamples
        )
    }

    /// Full LoS analysis. If relays are present, analyzes each hop independently.
    /// The direct A→B segment is always computed for display/comparison purposes.
    public static func analyze(
        profile: TerrainProfile,
        frequencyMHz: Double,
        kFactor: Double = FresnelZone.standardKFactor
    ) -> LoSResult {
        // Direct A→B analysis — always computed for display
        let directResult = analyzeSegment(
            pointA: profile.pointA,
            pointB: profile.pointB,
            samples: profile.samples,
            frequencyMHz: frequencyMHz,
            kFactor: kFactor
        )

        guard !profile.repeaters.isEmpty else {
            return LoSResult(
                profile: profile,
                directSegment: directResult,
                relaySegments: [],
                overallPass: directResult.hasLineOfSight && directResult.fresnelClearancePercent >= 60,
                frequencyMHz: frequencyMHz
            )
        }

        // Build ordered waypoints: A, R1, R2, …, B
        let waypoints: [LoSEndpoint] = [profile.pointA] + profile.repeaters + [profile.pointB]

        // Distance of each waypoint from A (used to slice the sample array per segment)
        let waypointDistances: [Double] = waypoints.map { wp in
            GeoMath.haversineDistance(
                lat1: profile.pointA.latitude, lon1: profile.pointA.longitude,
                lat2: wp.latitude, lon2: wp.longitude
            )
        }

        var relaySegments: [LoSSegmentResult] = []
        for i in 0..<(waypoints.count - 1) {
            let startDist = waypointDistances[i]
            let endDist   = waypointDistances[i + 1]

            let segSamples = profile.samples.filter {
                $0.distanceFromStart >= startDist && $0.distanceFromStart <= endDist
            }

            relaySegments.append(analyzeSegment(
                pointA: waypoints[i],
                pointB: waypoints[i + 1],
                samples: segSamples,
                frequencyMHz: frequencyMHz,
                kFactor: kFactor
            ))
        }

        let overallPass = relaySegments.allSatisfy {
            $0.hasLineOfSight && $0.fresnelClearancePercent >= 60
        }

        return LoSResult(
            profile: profile,
            directSegment: directResult,
            relaySegments: relaySegments,
            overallPass: overallPass,
            frequencyMHz: frequencyMHz
        )
    }
}
