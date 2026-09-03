//
//  BLEBackgroundHandler.swift
//  MeshCoreKit
//
//  CoreBluetooth state restoration and background BLE session management.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import CoreBluetooth
import os.log

/// Handles BLE background mode state restoration and reconnection logic.
///
/// This handler ensures the app can maintain BLE connectivity when suspended or terminated
/// by iOS. It works in conjunction with `BLEManager` to re-establish connections after
/// the system restores the app's CBCentralManager state.
public final class BLEBackgroundHandler {
    private static let logger = Logger(subsystem: "com.pommecore", category: "BLEBackground")

    /// Process restored peripherals from `centralManager(_:willRestoreState:)`.
    ///
    /// When iOS relaunches the app due to a BLE event, this method handles
    /// re-establishing the delegate chain and re-subscribing to NUS notifications.
    public static func handleRestoredPeripherals(
        _ peripherals: [CBPeripheral],
        delegate: CBPeripheralDelegate
    ) -> CBPeripheral? {
        guard let peripheral = peripherals.first else {
            logger.info("No peripherals to restore")
            return nil
        }

        peripheral.delegate = delegate

        if peripheral.state == .connected {
            logger.info("Restored connected peripheral: \(peripheral.name ?? "unknown")")

            // Re-discover services to re-subscribe to TX notifications
            if let services = peripheral.services,
               let nusService = services.first(where: { $0.uuid == BLEConstants.nusServiceUUID }) {
                // Service already discovered — re-discover characteristics
                peripheral.discoverCharacteristics(
                    [BLEConstants.nusRXCharacteristicUUID, BLEConstants.nusTXCharacteristicUUID],
                    for: nusService
                )
            } else {
                // Need full service discovery
                peripheral.discoverServices([BLEConstants.nusServiceUUID])
            }
        } else {
            logger.info("Restored peripheral not connected (state: \(peripheral.state.rawValue))")
        }

        return peripheral
    }
}
