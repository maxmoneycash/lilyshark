//
//  MeshCoreKitTests.swift
//  MeshCoreKit
//
//  Protocol frame validation tests.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import XCTest
@testable import MeshCoreKit

final class MeshCoreKitTests: XCTestCase {
    func testBuildAppStart() {
        let frame = MeshCoreProtocol.buildAppStart()
        XCTAssertEqual(frame[0], 0x01, "First byte should be appStart command")
        XCTAssertGreaterThan(frame.count, 1, "Frame should include app version and name")
    }

    func testBuildGetBattAndStorage() {
        let frame = MeshCoreProtocol.buildGetBattAndStorage()
        XCTAssertEqual(frame, Data([0x14]))
    }

    func testPublicKeyHash() {
        let keyData = Data(repeating: 0xAB, count: 32)
        let hash = MeshCoreCrypto.publicKeyHash(from: keyData)
        XCTAssertEqual(hash.count, 6)
    }
}
