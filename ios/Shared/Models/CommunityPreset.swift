//
//  CommunityPreset.swift
//  PommeCore
//
//  Codable model for community-contributed regional radio presets fetched from
//  the open-source repo. Validated on decode — invalid entries are dropped silently.
//

import Foundation

struct CommunityPresetManifest: Codable {
    let version: Int
    let presets: [CommunityPreset]
}

struct CommunityPreset: Codable {
    let name: String
    let region: String
    let frequencyKHz: Double
    let bandwidth: Double
    let spreadingFactor: UInt8
    let codingRate: UInt8
    let contributor: String?
    let url: String?

    var isValid: Bool {
        frequencyKHz > 0 &&
        (7...12).contains(spreadingFactor) &&
        Self.validBandwidths.contains(bandwidth) &&
        (5...8).contains(codingRate)
    }

    var asRadioPreset: RadioPreset {
        RadioPreset(name: name, region: region, frequencyKHz: frequencyKHz,
                    bandwidth: bandwidth, spreadingFactor: spreadingFactor, codingRate: codingRate)
    }

    private static let validBandwidths: Set<Double> = [
        7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500
    ]
}
