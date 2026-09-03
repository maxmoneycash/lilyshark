//
//  BLEConstants.swift
//  MeshCoreKit
//
//  Nordic UART service and characteristic UUIDs, BLE frame constants.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import CoreBluetooth

/// Nordic UART Service (NUS) UUIDs used by MeshCore devices.
public enum BLEConstants {
    /// NUS Service UUID
    public static let nusServiceUUID = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")

    /// RX Characteristic UUID — write to device
    public static let nusRXCharacteristicUUID = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")

    /// TX Characteristic UUID — notify from device
    public static let nusTXCharacteristicUUID = CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")

    /// BLE name prefix for MeshCore devices
    public static let deviceNamePrefix = "MeshCore-"

    /// CBCentralManager restore identifier for background state preservation
    public static let centralManagerRestoreIdentifier = "com.meshcore.centralmanager"

    /// BLE dispatch queue label
    public static let bleQueueLabel = "com.meshcore.ble"
}
