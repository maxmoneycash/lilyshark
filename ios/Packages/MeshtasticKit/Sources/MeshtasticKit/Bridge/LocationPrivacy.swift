//
//  LocationPrivacy.swift
//  MeshtasticKit
//
//  The privacy fudge: how far from the truth a shared position is allowed to
//  be, and in which direction.
//
//  This is pure arithmetic and it lives here, in the package, because the app
//  target has no test bundle. It used to sit as a static method on
//  PommeCoreViewModel where nothing could reach it, and it was applied TWICE
//  on the phone-GPS path -- once in setLocationFromPhoneGPS and again inside
//  setAdvertLatLon. Because the offset is stored and stable rather than
//  re-rolled per call, the second application moved the point a second time
//  along the very same bearing: the reported position was up to twice the
//  configured radius away, always on one heading. That is worse than either
//  honest answer, since a fixed heading is something repeated sightings
//  average out rather than obscure.
//
//  A function that is applied a wrong number of times is a function nothing
//  was checking. Now something can.
//

import Foundation

/// A stable random offset applied to a position before it is shared.
///
/// The offset is chosen once and kept, not re-rolled per send. That is
/// deliberate: an offset that jittered on every update would let anyone
/// watching a series of reports average them back to the true position, which
/// is exactly what the radius is meant to prevent. The cost is that the error
/// has a constant bearing, which is why applying it twice is so damaging and
/// why `apply` is documented as once-only.
public struct LocationFudge: Equatable, Sendable {
    /// Direction of the offset, radians.
    public var angle: Double
    /// How much of the radius to use, 0...1.
    public var fraction: Double

    public init(angle: Double, fraction: Double) {
        self.angle = angle
        self.fraction = fraction
    }

    /// A fresh offset. Call when the operator asks for a new one, not per send.
    public static func random() -> LocationFudge {
        LocationFudge(
            angle: Double.random(in: 0..<(2 * .pi)),
            fraction: Double.random(in: 0...1)
        )
    }
}

public enum LocationPrivacy {
    /// Metres per degree of latitude. Constant enough at this scale that the
    /// ellipsoid does not matter for an offset whose whole purpose is to be
    /// imprecise.
    static let metresPerDegreeLatitude: Double = 111_320.0

    /// Offset a position by the fudge.
    ///
    /// **Apply this exactly once** to a true position, immediately before
    /// sharing it. Applying it to an already-fudged position doubles the
    /// offset along the same bearing rather than scattering it.
    ///
    /// A radius of zero means the operator has not asked for any fudge, and
    /// the position is returned untouched.
    public static func apply(
        latitude: Double,
        longitude: Double,
        radiusMetres: Double,
        fudge: LocationFudge
    ) -> (latitude: Double, longitude: Double) {
        guard radiusMetres > 0 else { return (latitude, longitude) }
        let distance = fudge.fraction * radiusMetres
        let latitudeOffset = (distance * cos(fudge.angle)) / metresPerDegreeLatitude
        // Degrees of longitude shrink towards the poles. Guard the cosine:
        // at a pole it reaches zero and the division would produce infinity,
        // which is not a place.
        let shrink = cos(latitude * .pi / 180)
        let longitudeOffset = abs(shrink) < 1e-9
            ? 0
            : (distance * sin(fudge.angle)) / (metresPerDegreeLatitude * shrink)
        return (latitude + latitudeOffset, longitude + longitudeOffset)
    }

    /// How far `apply` moves a position, in metres. The offset never exceeds
    /// the radius the operator configured.
    public static func offsetMetres(
        from latitude: Double,
        _ longitude: Double,
        to fudgedLatitude: Double,
        _ fudgedLongitude: Double
    ) -> Double {
        let north = (fudgedLatitude - latitude) * metresPerDegreeLatitude
        let east = (fudgedLongitude - longitude) * metresPerDegreeLatitude
            * cos(latitude * .pi / 180)
        return (north * north + east * east).squareRoot()
    }
}
