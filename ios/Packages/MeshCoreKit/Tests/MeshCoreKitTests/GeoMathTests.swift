//
//  GeoMathTests.swift
//  MeshCoreKitTests
//
//  Tests for geographic calculations.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import XCTest
@testable import MeshCoreKit

final class GeoMathTests: XCTestCase {

    // MARK: - Haversine Distance

    func testHaversineDistanceSFtoLA() {
        // San Francisco (37.7749, -122.4194) to Los Angeles (34.0522, -118.2437)
        let distance = GeoMath.haversineDistance(
            lat1: 37.7749, lon1: -122.4194,
            lat2: 34.0522, lon2: -118.2437
        )
        // Expected ~559 km
        XCTAssertEqual(distance / 1000, 559, accuracy: 5, "SF to LA should be ~559 km")
    }

    func testHaversineDistanceSamePoint() {
        let distance = GeoMath.haversineDistance(
            lat1: 28.5, lon1: -81.7,
            lat2: 28.5, lon2: -81.7
        )
        XCTAssertEqual(distance, 0, accuracy: 0.001)
    }

    func testHaversineDistanceShort() {
        // Two points ~1km apart
        let distance = GeoMath.haversineDistance(
            lat1: 28.5000, lon1: -81.7000,
            lat2: 28.5090, lon2: -81.7000
        )
        XCTAssertEqual(distance, 1000, accuracy: 10, "~0.009 degrees latitude should be ~1km")
    }

    // MARK: - Bearing

    func testBearingNorth() {
        let b = GeoMath.bearing(lat1: 28.0, lon1: -81.0, lat2: 29.0, lon2: -81.0)
        XCTAssertEqual(b, 0, accuracy: 1, "Due north should be ~0 degrees")
    }

    func testBearingEast() {
        let b = GeoMath.bearing(lat1: 28.0, lon1: -82.0, lat2: 28.0, lon2: -81.0)
        XCTAssertEqual(b, 90, accuracy: 1, "Due east should be ~90 degrees")
    }

    // MARK: - Intermediate Point

    func testIntermediatePointMidpoint() {
        let mid = GeoMath.intermediatePoint(
            lat1: 28.0, lon1: -82.0,
            lat2: 30.0, lon2: -80.0,
            fraction: 0.5
        )
        XCTAssertEqual(mid.latitude, 29.0, accuracy: 0.05)
        XCTAssertEqual(mid.longitude, -81.0, accuracy: 0.05)
    }

    func testIntermediatePointEndpoints() {
        let start = GeoMath.intermediatePoint(
            lat1: 28.0, lon1: -82.0,
            lat2: 30.0, lon2: -80.0,
            fraction: 0.0
        )
        XCTAssertEqual(start.latitude, 28.0, accuracy: 0.001)
        XCTAssertEqual(start.longitude, -82.0, accuracy: 0.001)

        let end = GeoMath.intermediatePoint(
            lat1: 28.0, lon1: -82.0,
            lat2: 30.0, lon2: -80.0,
            fraction: 1.0
        )
        XCTAssertEqual(end.latitude, 30.0, accuracy: 0.001)
        XCTAssertEqual(end.longitude, -80.0, accuracy: 0.001)
    }

    // MARK: - Sample Points

    func testSamplePointsCount() {
        let points = GeoMath.samplePoints(
            lat1: 28.0, lon1: -82.0,
            lat2: 30.0, lon2: -80.0,
            count: 50
        )
        XCTAssertEqual(points.count, 50)
    }

    func testSamplePointsEndpoints() {
        let points = GeoMath.samplePoints(
            lat1: 28.0, lon1: -82.0,
            lat2: 30.0, lon2: -80.0,
            count: 10
        )
        XCTAssertEqual(points.first?.latitude ?? 0, 28.0, accuracy: 0.001)
        XCTAssertEqual(points.last?.latitude ?? 0, 30.0, accuracy: 0.001)
    }

    // MARK: - Adaptive Sample Count

    func testAdaptiveSampleCountShort() {
        XCTAssertEqual(GeoMath.adaptiveSampleCount(distanceMeters: 500), 20)
    }

    func testAdaptiveSampleCountMedium() {
        XCTAssertEqual(GeoMath.adaptiveSampleCount(distanceMeters: 10_000), 100)
    }

    func testAdaptiveSampleCountLong() {
        XCTAssertEqual(GeoMath.adaptiveSampleCount(distanceMeters: 30_000), 200)
    }

    // MARK: - Format Distance

    func testFormatDistanceMeters() {
        XCTAssertEqual(GeoMath.formatDistance(500), "500 m")
    }

    func testFormatDistanceKilometers() {
        XCTAssertEqual(GeoMath.formatDistance(5500), "5.5 km")
    }
}
