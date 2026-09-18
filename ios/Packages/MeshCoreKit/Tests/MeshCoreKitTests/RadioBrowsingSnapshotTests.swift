import XCTest
import CryptoKit
@testable import MeshCoreKit

final class RadioBrowsingSnapshotTests: XCTestCase {
    private let key = String(repeating: "ab", count: 32)
    private func snapshot(key: String? = nil, transport: RadioBrowsingSnapshot.Transport = .meshCore) -> RadioBrowsingSnapshot {
        let contact = Contact(publicKey: Data(repeating: 3, count: 32), name: "Saved contact", latitude: 37.8, longitude: -122.3)
        return RadioBrowsingSnapshot(publicKey: key ?? self.key, name: "Saved radio", transport: transport,
            savedAt: Date(timeIntervalSince1970: 1000), contacts: [contact],
            channels: [MeshChannel(index: 1, name: "Private group", flags: 1, secret: Data(repeating: 7, count: 32))],
            positions: [contact.publicKeyPrefix: .init(latitude: 0, longitude: 0, viaMQTT: true)],
            observations: [contact.publicKeyPrefix: .init(source: .packet, snr: -1.5, rssi: -100, hops: 2, lastHeard: 900, viaMQTT: true)])
    }
    func testRoundTripPreservesReportedDataWithoutChannelSecretsOrInventedFreshness() throws {
        let original = snapshot()
        let decoded = try JSONDecoder().decode(RadioBrowsingSnapshot.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(decoded.publicKey, key)
        XCTAssertEqual(decoded.contacts, original.contacts)
        XCTAssertEqual(decoded.positions, original.positions)
        XCTAssertEqual(decoded.observations, original.observations)
        XCTAssertEqual(decoded.savedAt, Date(timeIntervalSince1970: 1000))
        XCTAssertEqual(decoded.observations.values.first?.lastHeard, 900)
        XCTAssertNil(decoded.channels.first?.secret)
        XCTAssertEqual(decoded.channels.first?.name, "Private group")
    }
    func testIdentityMustMatchItsProtocolAndCannotBeEmptyZeroOrPath() {
        XCTAssertTrue(snapshot().hasValidIdentity)
        XCTAssertTrue(snapshot(key: "1234abcd", transport: .meshtastic).hasValidIdentity)
        XCTAssertFalse(snapshot(key: "1234abcd").hasValidIdentity)
        XCTAssertFalse(snapshot(transport: .meshtastic).hasValidIdentity)
        XCTAssertFalse(snapshot(key: String(repeating: "0", count: 64)).hasValidIdentity)
        XCTAssertFalse(snapshot(key: "../../private").hasValidIdentity)
        XCTAssertFalse(snapshot(key: "").hasValidIdentity)
        XCTAssertEqual(snapshot().storagePrefix, String(key.prefix(12)))
        XCTAssertEqual(snapshot(key: "1234abcd", transport: .meshtastic).storagePrefix, "1234abcd")
    }
    func testSnapshotCannotBeSavedIntoAnotherRadiosDirectory() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MessageStore(directory: directory, encryptionKey: nil)
        XCTAssertFalse(store.saveBrowsingSnapshot(snapshot()))
        XCTAssertNil(store.loadBrowsingSnapshot(publicKey: key))
    }

    func testEncryptedSnapshotSurvivesRestartAndChecksFullIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent(snapshot().storagePrefix)
        let encryptionKey = SymmetricKey(size: .bits256)
        let writer = MessageStore(directory: directory, encryptionKey: encryptionKey)
        XCTAssertTrue(writer.saveBrowsingSnapshot(snapshot()))
        let bytes = try Data(contentsOf: directory.appendingPathComponent("radio-browsing.bin"))
        XCTAssertNil(String(data: bytes, encoding: .utf8)?.range(of: "Saved contact"))
        let reopened = MessageStore(directory: directory, encryptionKey: encryptionKey)
        XCTAssertEqual(reopened.loadBrowsingSnapshot(publicKey: key)?.contacts.first?.name, "Saved contact")
        let samePrefixDifferentRadio = String(key.prefix(12)) + String(repeating: "cd", count: 26)
        XCTAssertNil(reopened.loadBrowsingSnapshot(publicKey: samePrefixDifferentRadio))
        XCTAssertNil(MessageStore(directory: directory, encryptionKey: SymmetricKey(size: .bits256)).loadBrowsingSnapshot(publicKey: key))
    }

    func testMissingEncryptionAndPlaintextCacheFailClosed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent(snapshot().storagePrefix)
        let store = MessageStore(directory: directory, encryptionKey: nil)
        XCTAssertFalse(store.saveBrowsingSnapshot(snapshot()))
        let file = directory.appendingPathComponent("radio-browsing.bin")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        try JSONEncoder().encode(snapshot()).write(to: file)
        XCTAssertNil(MessageStore(directory: directory, encryptionKey: SymmetricKey(size: .bits256)).loadBrowsingSnapshot(publicKey: key))
    }
}
