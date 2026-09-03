//
//  MeshCoreCrypto.swift
//  MeshCoreKit
//
//  AES-256-GCM message encryption at rest with per-radio Keychain keys.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import CryptoKit

public enum MeshCoreCrypto {

    /// Compute a 6-byte public key hash used as a contact identifier.
    public static func publicKeyHash(from publicKey: Data) -> Data {
        let hash = SHA256.hash(data: publicKey)
        return Data(hash.prefix(6))
    }
}
