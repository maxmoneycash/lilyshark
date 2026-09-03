//
//  TelemetryCloudSync.swift
//  PommeCore
//
//  Syncs telemetry history to CloudKit private database.
//  Each record is one contact's telemetry for one day.
//  Local JSON file remains the primary cache; CloudKit is the sync layer.
//
//  Created by Michael P. Bedworth on 04/07/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import Foundation
import CloudKit
import MeshCoreKit

@MainActor
final class TelemetryCloudSync {

    private let container = CKContainer(identifier: "iCloud.com.mbedworth.meshcore")
    private var database: CKDatabase { container.privateCloudDatabase }
    private let defaults = UserDefaults.standard

    private static let recordType = "TelemetryBatch"

    /// Contacts/days that have been modified locally since last upload.
    private var dirtyBatches: Set<String> = [] // "radioPrefix.contactHex.YYYY-MM-DD"

    /// Radio prefix for scoping (set when radio connects).
    var radioPrefix: String?

    /// Callback to merge downloaded data into RFMonitorStore.
    var onCloudDataReceived: ((_ contactKey: Data, _ snapshots: [TelemetrySnapshot]) -> Void)?

    private var isUploading = false

    // MARK: - Mark Dirty

    func markDirty(contactKey: Data) {
        guard let prefix = radioPrefix, !prefix.isEmpty else { return }
        guard iCloudSyncEnabled else { return }
        let dateStr = Self.dayString(from: Date())
        let batchKey = "\(prefix).\(contactKey.hexCompact).\(dateStr)"
        dirtyBatches.insert(batchKey)
    }

    // MARK: - Upload

    func uploadIfNeeded(telemetryHistory: [Data: [TelemetrySnapshot]]) {
        guard iCloudSyncEnabled, !dirtyBatches.isEmpty, !isUploading else { return }
        guard let prefix = radioPrefix, !prefix.isEmpty else { return }

        let batches = dirtyBatches
        dirtyBatches.removeAll()
        isUploading = true

        Task { @MainActor in
            defer { self.isUploading = false }
            await self.performUpload(batches: batches, telemetryHistory: telemetryHistory, radioPrefix: prefix)
        }
    }

    private func performUpload(batches: Set<String>, telemetryHistory: [Data: [TelemetrySnapshot]], radioPrefix: String) async {
        // Pre-compute day strings and filter snapshots on MainActor, then JSON-encode on background thread.
        let cutoff = Date().addingTimeInterval(-7 * 86400)
        let recordTypeName = Self.recordType
        struct BatchData: Sendable { var key: String; var contactHex: String; var dateStr: String; var date: Date; var snapshots: [TelemetrySnapshot] }
        var batchData: [BatchData] = []
        for batchKey in batches {
            let parts = batchKey.split(separator: ".")
            guard parts.count == 3 else { continue }
            let contactHex = String(parts[1])
            let dateStr = String(parts[2])
            guard let contactKey = Data(hexString: contactHex),
                  let snapshots = telemetryHistory[contactKey] else { continue }
            let daySnapshots = snapshots.filter { $0.timestamp > cutoff && Self.dayString(from: $0.timestamp) == dateStr }
            guard !daySnapshots.isEmpty else { continue }
            let date = Self.dateFromDayString(dateStr) ?? Date()
            batchData.append(BatchData(key: batchKey, contactHex: contactHex, dateStr: dateStr, date: date, snapshots: daySnapshots))
        }

        let records: [CKRecord] = await Task.detached(priority: .utility) {
            let encoder = JSONEncoder()
            return batchData.compactMap { batch in
                let record = CKRecord(recordType: recordTypeName, recordID: CKRecord.ID(recordName: batch.key))
                record["radioPrefix"] = radioPrefix as CKRecordValue
                record["contactKey"] = batch.contactHex as CKRecordValue
                record["date"] = batch.date as CKRecordValue
                record["snapshotCount"] = batch.snapshots.count as CKRecordValue
                if let data = try? encoder.encode(batch.snapshots) {
                    record["snapshots"] = data as CKRecordValue
                }
                return record
            }
        }.value

        guard !records.isEmpty else { return }

        // Upload in batches of 50
        for chunk in records.chunked(into: 50) {
            do {
                let (saves, _) = try await database.modifyRecords(saving: chunk, deleting: [], savePolicy: .changedKeys)
                DebugLogger.shared.log("TELEMETRY CLOUD: uploaded \(saves.count) batch records", level: .info)
            } catch let error as CKError where error.code == .serverRecordChanged {
                // Conflict — fetch server version, merge, retry
                await handleConflicts(records: chunk)
            } catch {
                DebugLogger.shared.log("TELEMETRY CLOUD: upload error — \(error.localizedDescription)", level: .warning)
                // Re-mark as dirty for next attempt
                for record in chunk {
                    dirtyBatches.insert(record.recordID.recordName)
                }
            }
        }
    }

    private func handleConflicts(records: [CKRecord]) async {
        for record in records {
            do {
                let serverRecord = try await database.record(for: record.recordID)
                // Merge: union snapshots by UUID
                if let serverData = serverRecord["snapshots"] as? Data,
                   let localData = record["snapshots"] as? Data,
                   let serverSnapshots = try? JSONDecoder().decode([TelemetrySnapshot].self, from: serverData),
                   let localSnapshots = try? JSONDecoder().decode([TelemetrySnapshot].self, from: localData) {
                    let merged = mergeSnapshots(local: localSnapshots, remote: serverSnapshots)
                    if let mergedData = try? JSONEncoder().encode(merged) {
                        serverRecord["snapshots"] = mergedData as CKRecordValue
                        serverRecord["snapshotCount"] = merged.count as CKRecordValue
                    }
                }
                let (_, _) = try await database.modifyRecords(saving: [serverRecord], deleting: [], savePolicy: .changedKeys)
                DebugLogger.shared.log("TELEMETRY CLOUD: resolved conflict for \(record.recordID.recordName)", level: .info)
            } catch {
                DebugLogger.shared.log("TELEMETRY CLOUD: conflict resolution failed — \(error.localizedDescription)", level: .warning)
            }
        }
    }

    // MARK: - Download

    func fetchFromCloud() {
        guard iCloudSyncEnabled else { return }
        guard let prefix = radioPrefix, !prefix.isEmpty else { return }

        Task { @MainActor in
            await self.performFetch(radioPrefix: prefix)
        }
    }

    private func performFetch(radioPrefix: String) async {
        let cutoff = Date().addingTimeInterval(-7 * 86400)
        let predicate = NSPredicate(format: "radioPrefix == %@ AND date > %@", radioPrefix, cutoff as NSDate)
        let query = CKQuery(recordType: Self.recordType, predicate: predicate)
        query.sortDescriptors = [NSSortDescriptor(key: "date", ascending: false)]

        do {
            let (results, _) = try await database.records(matching: query)
            var totalMerged = 0

            for (_, result) in results {
                switch result {
                case .success(let record):
                    guard let contactHex = record["contactKey"] as? String,
                          let contactKey = Data(hexString: contactHex),
                          let snapshotData = record["snapshots"] as? Data,
                          let snapshots = try? JSONDecoder().decode([TelemetrySnapshot].self, from: snapshotData)
                    else { continue }
                    onCloudDataReceived?(contactKey, snapshots)
                    totalMerged += snapshots.count
                case .failure(let error):
                    DebugLogger.shared.log("TELEMETRY CLOUD: record fetch error — \(error.localizedDescription)", level: .warning)
                }
            }

            if totalMerged > 0 {
                DebugLogger.shared.log("TELEMETRY CLOUD: fetched \(totalMerged) snapshots from \(results.count) batches", level: .info)
            }
        } catch {
            DebugLogger.shared.log("TELEMETRY CLOUD: fetch error — \(error.localizedDescription)", level: .warning)
        }
    }

    // MARK: - Migration (existing local data → CloudKit)

    func migrateIfNeeded(telemetryHistory: [Data: [TelemetrySnapshot]]) {
        guard iCloudSyncEnabled else { return }
        guard !defaults.bool(forKey: "telemetryCloudMigrated") else { return }
        guard let prefix = radioPrefix, !prefix.isEmpty else { return }
        guard !telemetryHistory.isEmpty else {
            defaults.set(true, forKey: "telemetryCloudMigrated")
            return
        }

        // Mark all existing data as dirty so next upload pushes everything
        let cutoff = Date().addingTimeInterval(-7 * 86400)
        for (contactKey, snapshots) in telemetryHistory {
            let contactHex = contactKey.hexCompact
            let days = Set(snapshots.filter { $0.timestamp > cutoff }.map { Self.dayString(from: $0.timestamp) })
            for day in days {
                dirtyBatches.insert("\(prefix).\(contactHex).\(day)")
            }
        }

        defaults.set(true, forKey: "telemetryCloudMigrated")
        DebugLogger.shared.log("TELEMETRY CLOUD: migration queued \(dirtyBatches.count) batches for upload", level: .info)

        uploadIfNeeded(telemetryHistory: telemetryHistory)
    }

    // MARK: - Merge Logic

    private func mergeSnapshots(local: [TelemetrySnapshot], remote: [TelemetrySnapshot]) -> [TelemetrySnapshot] {
        var byID: [UUID: TelemetrySnapshot] = [:]
        for s in remote { byID[s.id] = s }
        for s in local { byID[s.id] = s } // Local wins on UUID collision
        var merged = Array(byID.values).sorted { $0.timestamp < $1.timestamp }
        // Apply retention: max 500 per contact-day shouldn't happen, but cap anyway
        if merged.count > 500 {
            merged = Array(merged.suffix(500))
        }
        return merged
    }

    // MARK: - Helpers

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    private static func dayString(from date: Date) -> String {
        dayFormatter.string(from: date)
    }

    private static func dateFromDayString(_ str: String) -> Date? {
        dayFormatter.date(from: str)
    }
}

// MARK: - Array Chunking

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
#endif
