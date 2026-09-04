//
//  LocationPrivacyTests.swift
//  MeshtasticKitTests
//
//  The property that matters: applying the fudge twice is not the same as
//  applying it once, and the difference is not small. That is exactly what
//  the phone-GPS path did -- fudge in setLocationFromPhoneGPS, then fudge
//  again inside setAdvertLatLon -- and because the offset is stable rather
//  than re-rolled, both applications pushed the point the same way.
//

import XCTest
@testable import MeshtasticKit

final class LocationPrivacyTests: XCTestCase {

    /// San Francisco, where this radio actually is.
    private let latitude = 37.7785
    private let longitude = -122.4218

    /// A fixed offset, so these tests do not depend on a random draw.
    private let fudge = LocationFudge(angle: .pi / 3, fraction: 0.8)

    func testAZeroRadiusLeavesThePositionAlone() {
        let (lat, lon) = LocationPrivacy.apply(
            latitude: latitude, longitude: longitude, radiusMetres: 0, fudge: fudge
        )
        XCTAssertEqual(lat, latitude)
        XCTAssertEqual(lon, longitude)
    }

    func testTheOffsetNeverExceedsTheConfiguredRadius() {
        // Whatever the operator sets is a promise about the worst case, so it
        // holds for every direction, not the one that happens to be convenient.
        for step in 0..<36 {
            let angle = Double(step) * .pi / 18
            for fraction in [0.0, 0.25, 0.5, 0.99, 1.0] {
                let f = LocationFudge(angle: angle, fraction: fraction)
                let (lat, lon) = LocationPrivacy.apply(
                    latitude: latitude, longitude: longitude, radiusMetres: 500, fudge: f
                )
                let moved = LocationPrivacy.offsetMetres(
                    from: latitude, longitude, to: lat, lon
                )
                XCTAssertLessThanOrEqual(
                    moved, 500.5,
                    "angle \(angle) fraction \(fraction) moved \(moved) m, past the 500 m radius"
                )
            }
        }
    }

    func testTheOffsetUsesTheRequestedFractionOfTheRadius() {
        let (lat, lon) = LocationPrivacy.apply(
            latitude: latitude, longitude: longitude, radiusMetres: 500, fudge: fudge
        )
        let moved = LocationPrivacy.offsetMetres(from: latitude, longitude, to: lat, lon)
        XCTAssertEqual(moved, 400, accuracy: 1.0, "0.8 of a 500 m radius")
    }

    func testApplyingTheFudgeTwiceDoublesTheOffset() {
        // The bug, stated as a test. Both applications push along the same
        // bearing because the offset is stored rather than re-rolled, so the
        // result is not "more scattered" -- it is twice as far away, in a
        // fixed direction that repeated sightings would average out rather
        // than obscure.
        let once = LocationPrivacy.apply(
            latitude: latitude, longitude: longitude, radiusMetres: 500, fudge: fudge
        )
        let twice = LocationPrivacy.apply(
            latitude: once.latitude, longitude: once.longitude,
            radiusMetres: 500, fudge: fudge
        )

        let onceMoved = LocationPrivacy.offsetMetres(
            from: latitude, longitude, to: once.latitude, once.longitude
        )
        let twiceMoved = LocationPrivacy.offsetMetres(
            from: latitude, longitude, to: twice.latitude, twice.longitude
        )

        XCTAssertEqual(twiceMoved, onceMoved * 2, accuracy: 2.0)
        XCTAssertGreaterThan(
            twiceMoved, 500,
            "twice the fudge breaks the radius the operator configured"
        )
    }

    func testTheOffsetIsStableAcrossCalls() {
        // Not re-rolled per send. An offset that jittered would let anyone
        // watching a series of reports average them back to the truth, which
        // is the thing the radius exists to prevent.
        let first = LocationPrivacy.apply(
            latitude: latitude, longitude: longitude, radiusMetres: 500, fudge: fudge
        )
        let second = LocationPrivacy.apply(
            latitude: latitude, longitude: longitude, radiusMetres: 500, fudge: fudge
        )
        XCTAssertEqual(first.latitude, second.latitude)
        XCTAssertEqual(first.longitude, second.longitude)
    }

    func testAPoleDoesNotProduceAnInfiniteLongitude() {
        // Degrees of longitude shrink to nothing at a pole; dividing by that
        // cosine would return infinity, which is not a place. Unlikely on the
        // Bay Area mesh, and cheap to be right about.
        let (lat, lon) = LocationPrivacy.apply(
            latitude: 90, longitude: 0, radiusMetres: 500, fudge: fudge
        )
        XCTAssertTrue(lat.isFinite)
        XCTAssertTrue(lon.isFinite)
    }

    func testARandomFudgeStaysInRange() {
        for _ in 0..<200 {
            let f = LocationFudge.random()
            XCTAssertTrue(f.angle >= 0 && f.angle < 2 * .pi)
            XCTAssertTrue(f.fraction >= 0 && f.fraction <= 1)
        }
    }
}
