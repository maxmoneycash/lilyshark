//
//  FresnelZoneTests.swift
//  MeshCoreKitTests
//
//  Tests for RF calculations: Fresnel zone, earth bulge, clearance.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import XCTest
@testable import MeshCoreKit

final class FresnelZoneTests: XCTestCase {

    // MARK: - Fresnel Radius

    func testFresnelRadiusMidpoint906MHz() {
        // At midpoint of a 10km path at 906 MHz
        // lambda = 299792458 / 906e6 = 0.3309 m
        // r = sqrt(0.3309 * 5000 * 5000 / 10000) = sqrt(826.5) = ~28.7m
        let radius = FresnelZone.fresnelRadius(
            frequencyMHz: 906.0,
            distanceFromA: 5000,
            distanceFromB: 5000
        )
        XCTAssertEqual(radius, 28.7, accuracy: 1.0, "Fresnel radius at midpoint of 10km path at 906MHz")
    }

    func testFresnelRadiusAtEndpoints() {
        // At the endpoints, Fresnel radius should be 0
        let atA = FresnelZone.fresnelRadius(frequencyMHz: 906, distanceFromA: 0, distanceFromB: 10000)
        XCTAssertEqual(atA, 0, accuracy: 0.001)
    }

    func testFresnelRadiusOffCenter() {
        // At 1/4 of a 10km path
        let radius = FresnelZone.fresnelRadius(
            frequencyMHz: 906,
            distanceFromA: 2500,
            distanceFromB: 7500
        )
        // Should be smaller than midpoint
        let midRadius = FresnelZone.fresnelRadius(frequencyMHz: 906, distanceFromA: 5000, distanceFromB: 5000)
        XCTAssertLessThan(radius, midRadius)
        XCTAssertGreaterThan(radius, 0)
    }

    // MARK: - Earth Bulge

    func testEarthBulgeMidpoint10km() {
        // At midpoint of 10km path with K=4/3
        // h = (5000 * 5000) / (2 * 4/3 * 6371000) = 25e6 / 16988667 = ~1.47m
        let bulge = FresnelZone.earthBulge(distanceFromA: 5000, distanceFromB: 5000)
        XCTAssertEqual(bulge, 1.47, accuracy: 0.1, "Earth bulge at midpoint of 10km path")
    }

    func testEarthBulgeAtEndpoints() {
        let atA = FresnelZone.earthBulge(distanceFromA: 0, distanceFromB: 10000)
        XCTAssertEqual(atA, 0, accuracy: 0.001)
    }

    func testEarthBulgeLongPath() {
        // 50km path midpoint: significant earth bulge
        let bulge = FresnelZone.earthBulge(distanceFromA: 25000, distanceFromB: 25000)
        XCTAssertGreaterThan(bulge, 30, "50km path should have significant earth bulge")
    }

    // MARK: - LoS Height

    func testLosHeightMidpoint() {
        let los = FresnelZone.losHeight(heightA: 100, heightB: 200, distanceFromA: 5000, totalDistance: 10000)
        XCTAssertEqual(los, 150, accuracy: 0.001)
    }

    func testLosHeightEndpoints() {
        let atA = FresnelZone.losHeight(heightA: 100, heightB: 200, distanceFromA: 0, totalDistance: 10000)
        XCTAssertEqual(atA, 100, accuracy: 0.001)

        let atB = FresnelZone.losHeight(heightA: 100, heightB: 200, distanceFromA: 10000, totalDistance: 10000)
        XCTAssertEqual(atB, 200, accuracy: 0.001)
    }

    // MARK: - Clearance

    func testClearancePositive() {
        let clr = FresnelZone.clearance(losHeight: 150, groundElevation: 100, earthBulge: 1.5)
        XCTAssertEqual(clr, 48.5, accuracy: 0.001, "150 - (100 + 1.5) = 48.5")
    }

    func testClearanceNegative() {
        let clr = FresnelZone.clearance(losHeight: 100, groundElevation: 110, earthBulge: 1.5)
        XCTAssertLessThan(clr, 0, "LoS below ground should be negative clearance")
    }

    // MARK: - Fresnel Percent

    func testFresnelPercentFull() {
        let pct = FresnelZone.fresnelPercent(clearance: 30, fresnelRadius: 30)
        XCTAssertEqual(pct, 100, accuracy: 0.001)
    }

    func testFresnelPercent60() {
        let pct = FresnelZone.fresnelPercent(clearance: 18, fresnelRadius: 30)
        XCTAssertEqual(pct, 60, accuracy: 0.001)
    }

    func testFresnelPercentObstructed() {
        let pct = FresnelZone.fresnelPercent(clearance: -5, fresnelRadius: 30)
        XCTAssertLessThan(pct, 0)
    }

    // MARK: - Max Fresnel Radius

    func testMaxFresnelRadius() {
        let maxR = FresnelZone.maxFresnelRadius(frequencyMHz: 906, totalDistance: 10000)
        let midR = FresnelZone.fresnelRadius(frequencyMHz: 906, distanceFromA: 5000, distanceFromB: 5000)
        XCTAssertEqual(maxR, midR, accuracy: 0.001, "Max Fresnel should equal midpoint Fresnel")
    }

    // MARK: - Wavelength

    func testWavelength906MHz() {
        let lambda = FresnelZone.wavelength(frequencyMHz: 906)
        XCTAssertEqual(lambda, 0.331, accuracy: 0.001, "906 MHz wavelength should be ~0.331m")
    }
}
