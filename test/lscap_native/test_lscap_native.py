"""Compile and exercise the native reader against the pinned .lscap wire format."""
import json
import csv
import re
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def record(payload=b"abc", timestamp=1_000_000, fields=(1 << 0) | (1 << 10), synthetic=False, header_size=80):
    header = bytearray(header_size)
    struct.pack_into("<4sHHHHQQI", header, 0, b"LSFR", header_size, 1, len(payload), len(payload), 7, timestamp, fields)
    struct.pack_into("<i", header, 52, -12345)
    struct.pack_into("<hh", header, 56, -975, -32)
    struct.pack_into("<Hhb", header, 64, 1, -17, -8)
    header[73:77] = bytes([1, 1, 2, 4 if synthetic else 0])
    return bytes(header) + payload


def capture(*records, minor=1, file_size=24, record_size=80):
    return struct.pack("<4sHHHHIII", b"LSCP", 1, minor, file_size, record_size, 0, 1_000_000, 0) + bytes(file_size - 24) + b"".join(records)


def radio_record(payload, profile=5, truncated=False):
    item = bytearray(record(payload))
    struct.pack_into("<H", item, 64, profile)
    if truncated:
        struct.pack_into("<H", item, 10, len(payload) + 1)
    return item


def lxmf_fixture(name):
    source = (ROOT / "test/lxmf/fixtures.h").read_text()
    body = re.search(rf"{name}\[\] = \{{([\s\S]*?)\}};", source).group(1)
    return bytes(int(value, 16) for value in re.findall(r"0x([0-9a-f]{2})", body))


def opportunistic(stored_message):
    # Reticulum PLAIN DATA, context NONE; destination is in the outer header.
    return b"\x40\x08\x00" + stored_message[:16] + b"\x00" + stored_message[16:]


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "macOS Swift toolchain required")
class NativeCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix="lilyshark-native-reader-")
        cls.binary = Path(cls.work.name) / "reader"
        subprocess.run(["swiftc", "-parse-as-library", str(ROOT / "ios/Shared/Models/LSCapParser.swift"),
                        str(ROOT / "ios/Shared/Models/CaptureAnalysis.swift"), str(Path(__file__).with_name("reader.swift")),
                        str(ROOT / "ios/Shared/Models/CaptureFilter.swift"), str(ROOT / "ios/Shared/Models/CaptureDissection.swift"),
                        str(ROOT / "ios/Shared/Models/CaptureLXMF.swift"),
                        str(ROOT / "ios/Shared/Models/SpectrumHistory.swift"),
                        str(ROOT / "ios/Packages/MeshtasticKit/Sources/MeshtasticKit/Analyzer/LSKLine.swift"),
                        str(ROOT / "ios/Packages/MeshtasticKit/Sources/MeshtasticKit/Analyzer/LSKCaptureRecorder.swift"),
                        "-o", str(cls.binary)], check=True, capture_output=True, text=True)

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def parse(self, data, succeeds=True, sliced=False, args=()):
        source = Path(self.work.name) / "fixture.lscap"
        source.write_bytes(data)
        result = subprocess.run([str(self.binary), str(source)] + (["--slice"] if sliced else []) + list(args), capture_output=True, text=True)
        if not succeeds:
            self.assertEqual(result.returncode, 1, result.stderr[-1000:])
            return
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        return json.loads(result.stdout)

    def test_unaligned_records_signed_metadata_and_nonzero_data_indices(self):
        data = capture(record(), record(b"12345", timestamp=2_000_000, synthetic=True))
        for sliced in (False, True):
            result = self.parse(data, sliced=sliced)
            a, b = result["frames"]
            self.assertEqual([a["payload"], b["payload"]], ["616263", "3132333435"])
            self.assertEqual((a["rssi"], a["snr"], a["frequencyError"], a["status"], a["txPower"]), (-97.5, -3.2, -12345, -17, -8))
            self.assertNotEqual(a["id"], b["id"])
            self.assertEqual(b["time"], "+1.000 s")
            self.assertEqual(result["synthetic"], 1)

    def test_extended_headers_and_payload_magic_are_not_record_boundaries(self):
        result = self.parse(capture(record(b"LSFR", header_size=84), record(b"z", header_size=84), file_size=28, record_size=84))
        self.assertEqual(len(result["frames"]), 2)
        self.assertEqual(result["trailing"], 0)

    def test_recovery_stops_at_corruption_and_does_not_scan_ahead(self):
        good = record()
        for tail in (record(b"cut")[:-1], b"LSFR", b"xxxx" + record()[4:], record()[0:6] + b"\x02\x00" + record()[8:]):
            result = self.parse(capture(good, tail, good))
            # The incomplete payload variant would consume the next record's first byte;
            # put it at EOF separately below.
            if tail == record(b"cut")[:-1]:
                result = self.parse(capture(good, tail))
            self.assertEqual(len(result["frames"]), 1)
            self.assertGreater(result["trailing"], 0)
            self.assertIn("byte", result["recovery"])

    def test_invalid_file_headers_fail_without_out_of_bounds_access(self):
        base = bytearray(capture())
        cases = [b"", b"BAD!" + bytes(base[4:])]
        for offset, value in [(4, 2), (8, 0), (8, 23), (8, 65535), (10, 0), (10, 79)]:
            item = base.copy(); struct.pack_into("<H", item, offset, value); cases.append(item)
        item = base.copy(); struct.pack_into("<I", item, 16, 0); cases.append(item)
        for item in cases:
            self.parse(item, succeeds=False)

    def test_record_lengths_and_layout_are_validated_before_payload_access(self):
        for offset, value in [(4, 79), (4, 84), (6, 2), (8, 256), (10, 1)]:
            item = bytearray(record()); struct.pack_into("<H", item, offset, value)
            result = self.parse(capture(item))
            self.assertEqual(result["frames"], [])
            self.assertTrue(result["recovery"])

    def test_older_browser_exports_remain_readable(self):
        item = bytearray(record())
        item[4:8] = bytes(4)
        result = self.parse(capture(item))
        self.assertEqual(result["frames"][0]["payload"], "616263")
        self.assertEqual(result["trailing"], 0)

    def test_missing_metadata_legacy_provenance_and_chart_identity(self):
        result = self.parse(capture(record(fields=0, synthetic=True), record(), record(synthetic=True)))
        self.assertEqual(result["frames"][0]["protocol"], "Unknown")
        self.assertEqual(result["frames"][0]["time"], "Time not recorded")
        self.assertEqual(result["untimed"], 1)
        self.assertEqual(len({p["id"] for p in result["points"]}), 2)
        self.assertEqual(sum(p["count"] for p in result["points"]), 2)
        legacy = self.parse(capture(record(synthetic=True), minor=0))
        self.assertFalse(legacy["frames"][0]["synthetic"])

    def test_real_repository_captures_match_the_host_reader(self):
        for path in (ROOT / "samples").glob("*.lscap"):
            expected = subprocess.run(["python3", str(ROOT / "scripts/lscap.py"), "dump", str(path)], capture_output=True, text=True, check=True)
            records = [json.loads(line) for line in expected.stdout.splitlines()][1:]
            actual = self.parse(path.read_bytes())["frames"]
            self.assertEqual(len(actual), len(records))
            for a, b in zip(actual, records):
                self.assertEqual(a["payload"], b["payload_hex"])
                self.assertEqual(a["sequence"], str(b["sequence"]))

    def test_import_limits_are_enforced(self):
        self.parse(capture(record(b"") * 100_001), succeeds=False)
        self.parse(bytes(32 * 1024 * 1024 + 1), succeeds=False)

    def test_filtered_export_preserves_opaque_headers_versions_and_record_bytes(self):
        destination = Path(self.work.name) / "export.lscap"
        for minor in (0, 1, 2):
            keep = bytearray(record(b"\x00\x01\xff", timestamp=2_000_000, header_size=84))
            keep[77:84] = bytes([1, 2, 3, 4, 5, 6, 7])
            struct.pack_into("<H", keep, 64, 5)
            data = bytearray(capture(record(header_size=84), keep, minor=minor, file_size=28, record_size=84))
            data[24:28] = b"abcd"
            result = self.parse(data, args=["--profile", "Reticulum", "--export", str(destination)])
            self.assertEqual(result["frames"][0]["time"], "+1.000 s")
            self.assertEqual(destination.read_bytes(), data[:28] + keep)
        legacy = bytearray(record()); legacy[4:8] = bytes(4)
        data = capture(legacy)
        self.parse(data, args=["--export", str(destination)])
        self.assertEqual(destination.read_bytes(), data)

    def test_recovered_export_omits_damaged_tail_and_csv_keeps_unknown_metadata_blank(self):
        destination = Path(self.work.name) / "export.lscap"
        sheet = Path(self.work.name) / "export.csv"
        good = record(b"\x00\x01", fields=0)
        self.parse(capture(good, b"LSFR"), args=["--export", str(destination), "--csv", str(sheet)])
        self.assertEqual(destination.read_bytes(), capture(good))
        with sheet.open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(rows[0]["payload_hex"], "0x0001")
        for key in ("timestamp_us", "frequency_hz", "rssi_dbm", "snr_db"):
            self.assertEqual(rows[0][key], "")

    def test_combined_filters_and_network_origin_take_precedence(self):
        network = bytearray(record(b"\xde\xad\xbe\xef", synthetic=True))
        network[76] |= 8
        network[75] = 3
        struct.pack_into("<H", network, 10, 10)
        data = capture(record(), record(synthetic=True), network)
        args = ["--origin", "Network relayed", "--crc", "invalid", "--direction", "rx", "--query", "DE AD", "--truncated-only"]
        result = self.parse(data, args=args)
        self.assertEqual(len(result["frames"]), 1)
        self.assertEqual(result["frames"][0]["origin"], "Network relayed")
        self.assertEqual(self.parse(data, args=["--query", "not hex"])["frames"], [])
        self.assertEqual(len(self.parse(data, args=["--origin", "Synthetic"])["frames"]), 1)
        self.assertEqual(self.parse(capture(network, minor=0))["frames"][0]["origin"], "Unspecified")

    def test_payload_search_matches_whole_bytes_and_custom_profiles_stay_distinct(self):
        custom = bytearray(record(b"\x12\x34")); struct.pack_into("<H", custom, 64, 99)
        data = capture(record(b"\x01\x23\x40"), custom)
        result = self.parse(data, args=["--query", "12 34"])
        self.assertEqual([f["payload"] for f in result["frames"]], ["1234"])
        self.assertEqual(result["frames"][0]["protocol"], "Custom")
        self.assertEqual(self.parse(data, args=["--query", "abc"])["frames"], [])
        self.assertEqual(len(self.parse(data, args=["--profile", "Custom"])["frames"]), 1)

    def test_structural_decoders_are_profile_gated_and_never_read_past_payload(self):
        for profile in (1, 2, 5):
            records = []
            for length in range(256):
                payload = bytes((i * 37 + length) % 256 for i in range(length))
                item = bytearray(record(payload)); struct.pack_into("<H", item, 64, profile)
                records.append(item)
            result = self.parse(capture(*records))
            for item in result["frames"]:
                for field in item["fields"]:
                    self.assertGreaterEqual(field["offset"], 0)
                    self.assertLessEqual(field["offset"] + field["length"], len(item["payload"]) // 2)
        unknown = self.parse(capture(record(bytes(32), fields=0)))["frames"][0]
        self.assertEqual(unknown["fields"], [])

    def test_meshtastic_header_fields_and_invalid_sender(self):
        payload = struct.pack("<III4B", 0xffffffff, 0xa1b2c3d4, 0x12345678, 0x6b, 0x12, 0x34, 0x56)
        frame = self.parse(capture(record(payload)))["frames"][0]
        values = {field["name"]: field["value"] for field in frame["fields"]}
        self.assertEqual(values["Source"], "!a1b2c3d4")
        self.assertEqual(values["Destination"], "Broadcast")
        self.assertEqual(values["Hop start"], "3")
        self.assertEqual(values["Packet ID"], "0x12345678")
        self.assertEqual(frame["problem"], "")
        bad = bytearray(payload); bad[4:8] = bytes(4)
        self.assertIn("Zero", self.parse(capture(record(bad)))["frames"][0]["problem"])

    def test_meshcore_and_reticulum_match_pinned_web_header_fixtures(self):
        root = ROOT / "webapp/src/lib/dissect/fixtures"
        for filename, profile in (("meshcore", 2), ("rnode", 5)):
            for fixture in json.loads((root / f"{filename}.json").read_text())["fixtures"]:
                # This pass implements structural headers; semantic announce
                # validation/reassembly is deliberately a separate capability.
                if fixture["name"].startswith("announce-"):
                    continue
                payload = bytes.fromhex(fixture["hex"])
                item = bytearray(record(payload))
                struct.pack_into("<H", item, 64, profile)
                if fixture.get("truncated") or fixture.get("opts", {}).get("truncated"):
                    struct.pack_into("<H", item, 10, len(payload) + 1)
                frame = self.parse(capture(item))["frames"][0]
                self.assertEqual(bool(frame["problem"]), fixture["result"] == "malformed", fixture["name"])
                fields = {field["name"]: field for field in frame["fields"]}
                expected = fixture.get("expect", {})
                for key, label in (("acknowledgementChecksum", "Acknowledgement checksum"),
                                   ("transportCodeOne", "Transport code 1"), ("channelHash", "Channel hash")):
                    if key in expected and expected[key] is not None:
                        self.assertEqual(int(fields[label]["value"], 16), int(str(expected[key]), 0), fixture["name"])
                if filename == "rnode" and "Destination hash" in fields:
                    dest = fields["Destination hash"]
                    self.assertEqual(dest["value"], payload[dest["offset"]:dest["offset"] + 16].hex())
                    if "hops" in expected:
                        self.assertEqual(fields["Hops"]["value"], str(expected["hops"]), fixture["name"])

    def test_spectrum_retunes_bounds_and_peak_hold(self):
        subprocess.run([str(self.binary), "--spectrum-self-test"], check=True, capture_output=True)

    def test_reticulum_announces_match_shared_semantic_fixture_ranges(self):
        fixtures = json.loads((ROOT / "webapp/src/lib/dissect/fixtures/rnode.json").read_text())["fixtures"]
        frames = self.parse(capture(*(radio_record(bytes.fromhex(f["hex"]), truncated=f.get("opts", {}).get("truncated", False)) for f in fixtures)))["frames"]
        labels = {"publicKeyRange": "Announce public key", "nameHashRange": "Announce name hash",
                  "randomHashRange": "Announce random hash", "ratchetRange": "Announce ratchet",
                  "signatureRange": "Announce signature", "appDataRange": "Announce application data"}
        for fixture, frame in zip(fixtures, frames):
            fields = {f["name"]: f for f in frame["fields"]}
            expected = fixture.get("expectAnnounce")
            self.assertEqual("Announce signature" in fields, expected is not None, fixture["name"])
            if expected is None:
                continue
            self.assertIn("not verified", fields["Announce signature"]["value"])
            for key, label in labels.items():
                if key not in expected:
                    continue
                if expected[key] is None:
                    self.assertNotIn(label, fields, fixture["name"])
                else:
                    for dimension in ("offset", "length"):
                        self.assertEqual(fields[label][dimension], expected[key][dimension], (fixture["name"], label))
            for key, label in (("nameHashHex", "Announce name hash"), ("randomHashHex", "Announce random hash")):
                if key in expected:
                    self.assertEqual(fields[label]["value"], expected[key])
            if expected.get("appDataPreview"):
                self.assertIn(expected["appDataPreview"], fields["Announce application data"]["value"])

    def test_truncated_announce_never_claims_complete_semantic_fields(self):
        fixtures = json.loads((ROOT / "webapp/src/lib/dissect/fixtures/rnode.json").read_text())["fixtures"]
        payload = bytes.fromhex(next(f["hex"] for f in fixtures if f["name"] == "announce-ratchet-and-app-data"))
        frames = self.parse(capture(*(radio_record(payload[:n], truncated=True) for n in range(len(payload) + 1))))["frames"]
        for frame in frames:
            self.assertFalse(any(f["name"].startswith("Announce ") for f in frame["fields"]))
            self.assertIn("truncated", frame["problem"])

    def test_reference_lxmf_messages_keep_order_ranges_and_unverified_signatures(self):
        names = ["kLxmfRNodeReference", "kLxmfRNodeStamped"]
        frames = self.parse(capture(*(radio_record(lxmf_fixture(name)) for name in names)))["frames"]
        for name, frame in zip(names, frames):
            fields = {f["name"]: f for f in frame["fields"]}
            self.assertIn("Field note", fields["LXMF title"]["value"])
            self.assertIn("Heard on 913.125 MHz", fields["LXMF content"]["value"])
            self.assertEqual(fields["LXMF timestamp"]["value"], "1771200000.5 seconds since Unix epoch")
            self.assertEqual(fields["LXMF source hash"]["value"], "fae321c442e3c9bdcd7a3e79d850e03c")
            self.assertEqual(fields["LXMF signature"]["offset"], 36)
            self.assertEqual(fields["LXMF signature"]["length"], 64)
            self.assertIn("not verified", fields["LXMF signature"]["value"])
            self.assertEqual("LXMF stamp" in fields, name.endswith("Stamped"))
            if name.endswith("Stamped"):
                self.assertIn("32 bytes present", fields["LXMF stamp"]["value"])
                self.assertIn("not verified", fields["LXMF stamp"]["value"])
            raw = bytes.fromhex(frame["payload"])
            for field in frame["fields"]:
                self.assertGreaterEqual(field["offset"], 0)
                self.assertLessEqual(field["offset"] + field["length"], len(raw))
            self.assertIn(b"Field note", raw[fields["LXMF title"]["offset"]:fields["LXMF title"]["offset"] + fields["LXMF title"]["length"]])

    def test_lxmf_nil_empty_bounded_text_and_nested_fields(self):
        names = ["kLxmfEmpty", "kLxmfNils", "kLxmfLongContent", "kLxmfControlBytes", "kLxmfNestedFields"]
        frames = [self.parse(lxmf_fixture(name), args=["--lxmf-stored"]) for name in names]
        values = [{f["name"]: f["value"] for f in frame["fields"]} for frame in frames]
        self.assertEqual(values[0]["LXMF title"], "Empty (0 bytes)")
        self.assertEqual(values[0]["LXMF timestamp"], "0.0 seconds since Unix epoch")
        self.assertEqual(values[1]["LXMF title"], "Not included (nil)")
        self.assertEqual(values[1]["LXMF fields"], "Not included (nil)")
        self.assertEqual(values[2]["LXMF content"], '"' + "L" * 192 + '" · 300 bytes · preview truncated')
        self.assertIn("A·B·C D", values[3]["LXMF content"])
        self.assertEqual(values[4]["LXMF fields"], "2 entries · contents not interpreted")

    def test_lxmf_refuses_wrong_protocol_context_encryption_and_damaged_records(self):
        payload = lxmf_fixture("kLxmfRNodeReference")
        records = [radio_record(payload, profile=profile) for profile in (1, 2, 0)]
        records.append(radio_record(payload, truncated=True))
        for offset, value in [(1, 0), (1, 0x0a), (1, 0x89), (0, 0x41), (19, 1), (2, 128)]:
            modified = bytearray(payload); modified[offset] = value
            records.append(radio_record(modified))
        for name in ("kLxmfRNodeReference", "kLxmfRNodeStamped"):
            raw = lxmf_fixture(name)
            records.extend(radio_record(raw[:n]) for n in range(len(raw)))
            records.append(radio_record(raw + b"\x00"))
        frames = self.parse(capture(*records))["frames"]
        for frame in frames:
            self.assertFalse(any(f["name"].startswith("LXMF ") for f in frame["fields"]))

    def test_lxmf_hostile_lengths_nesting_and_numeric_timestamps(self):
        header = bytes(96)
        invalid = [b"\xdd\xff\xff\xff\xff", b"\x94\x01\xc6\xff\xff\xff\xff",
                   b"\x94\x01\xc0\xc0\x81\x01" + b"\x91" * 20000 + b"\x00",
                   b"\x94\xc3\xc0\xc0\x80", b"\x94\x01\xc0\xc0\x00",
                   b"\x95\x01\xc0\xc0\x80\x81\x00\x00"]
        for timestamp in [b"\xcf" + bytes([255]) * 8, b"\xd3" + bytes([127]) * 8,
                          b"\xcb" + struct.pack(">d", float("nan")), b"\xcb" + struct.pack(">d", float("inf"))]:
            invalid.append(b"\x94" + timestamp + b"\xc0\xc0\x80")
        frames = [self.parse(header + body, args=["--lxmf-stored"]) for body in invalid]
        for frame in frames:
            self.assertFalse(any(f["name"].startswith("LXMF ") for f in frame["fields"]))
        timestamps = [(b"\xcc\xff", 255), (b"\xcd\x01\x00", 256), (b"\xce" + struct.pack(">I", 2**32-1), 2**32-1),
                      (b"\xcf" + struct.pack(">Q", 2**53-1), 2**53-1), (b"\xd0\xff", -1),
                      (b"\xd1\xff\xfe", -2), (b"\xd2" + struct.pack(">i", -65536), -65536),
                      (b"\xd3" + struct.pack(">q", -(2**53-1)), -(2**53-1)),
                      (b"\xca" + struct.pack(">f", 1.5), 1.5)]
        frames = self.parse(capture(*(radio_record(opportunistic(header + b"\x94" + stamp + b"\xc0\xc0\x80")) for stamp, _ in timestamps)))["frames"]
        for (_, expected), frame in zip(timestamps, frames):
            value = next(f["value"] for f in frame["fields"] if f["name"] == "LXMF timestamp")
            self.assertEqual(float(value.split()[0]), expected)

    def test_lxmf_preview_does_not_split_a_multibyte_character(self):
        content = ("A" * 191 + "🦈B").encode()
        packed = bytes(96) + b"\x94\x00\xc0\xc4" + bytes([len(content)]) + content + b"\x80"
        fields = self.parse(packed, args=["--lxmf-stored"])["fields"]
        value = next(f["value"] for f in fields if f["name"] == "LXMF content")
        self.assertEqual(value, '"' + "A" * 191 + '" · 196 bytes · preview truncated')

    def test_shelby_pointer_uses_firmware_golden_bytes_and_reports_a_candidate(self):
        source = (ROOT / "test/shelby_pointer_py/test_shelby_pointer.py").read_text()
        encoded = re.search(r'GOLDEN_POINTER = bytes.fromhex\(([\s\S]*?)\)', source).group(1)
        pointer = bytes.fromhex("".join(re.findall(r'"([0-9a-f]+)"', encoded)))
        records = [radio_record(b"prefix" + pointer + b"tail", profile=p) for p in (0, 1, 2, 5)]
        frames = self.parse(capture(*records))["frames"]
        for frame in frames:
            fields = {f["name"]: f for f in frame["fields"]}
            self.assertEqual(fields["Shelby pointer"]["offset"], 6)
            self.assertIn("not verified", fields["Shelby pointer"]["value"])
            self.assertEqual(fields["Blob commitment"]["value"], "0x" + bytes(range(0xa0, 0xc0)).hex())
            self.assertEqual(fields["Owner account"]["value"], "0x" + bytes((i * 3 + 1) % 256 for i in range(32)).hex())
            self.assertEqual(fields["Blob size"]["value"], "1048576 bytes")
            self.assertEqual(fields["Blob expiry"]["value"], "1893456000 seconds since Unix epoch")
            self.assertEqual(fields["Blob encrypted"]["value"], "Yes")
            self.assertEqual(fields["Blob commitment"]["offset"], 12)
        invalid = [pointer[:n] for n in range(82)]
        for offset, value in [(4, 99), (80, 0), (80, 4), (78, 1), (5, 7)]:
            raw = bytearray(pointer); raw[offset] = value; invalid.append(raw)
        frames = self.parse(capture(*(radio_record(raw, profile=0) for raw in invalid)))["frames"]
        self.assertTrue(all(not frame["fields"] for frame in frames))
        chunked = bytearray(pointer); chunked[5] |= 2; chunked[78] = 3; chunked[80] = 7
        fields = self.parse(capture(radio_record(chunked, profile=0)))["frames"][0]["fields"]
        self.assertEqual(next(f["value"] for f in fields if f["name"] == "Chunk count"), "7")

    def test_usb_recording_recreates_repository_capture_byte_for_byte(self):
        sample = ROOT / "samples/sample-mesh-traffic.lscap"
        dumped = subprocess.run(["python3", str(ROOT / "scripts/lscap.py"), "dump", str(sample)],
                                check=True, capture_output=True, text=True)
        records = [json.loads(line) for line in dumped.stdout.splitlines()][1:]
        fields = {"seq": "sequence", "ts": "timestamp_us", "pf": "present_fields", "freq": "center_frequency_hz",
                  "bw": "bandwidth_hz", "br": "bit_rate_bps", "fdev": "frequency_deviation_hz", "air": "airtime_us",
                  "ferr": "frequency_error_hz", "rssi_x10": "rssi_dbm_x10", "snr_x10": "snr_db_x10",
                  "pre": "preamble_symbols", "sync": "sync_word", "prof": "profile_id", "rstat": "radio_status",
                  "txp": "tx_power_dbm", "sf": "spreading_factor", "cr": "coding_rate_denominator", "ch": "channel_index",
                  "ridx": "radio_index", "mod": "modulation", "dir": "direction", "crc": "crc_state",
                  "mflags": "metadata_flags", "olen": "original_length", "hex": "payload_hex"}
        lines = []
        for record in records:
            body = {key: record[value] for key, value in fields.items()}
            body.update(src=1, dst=2, proto="Meshtastic", port=0, hops=0, kind="DATA", sim=record["synthetic"])
            lines.append("LSK F " + json.dumps(body))
        destination = Path(self.work.name) / "usb.lscap"
        result = self.parse(("\n".join(lines) + "\n").encode(), args=["--record-lines", "--export", str(destination)])
        self.assertEqual(len(result["frames"]), len(records))
        self.assertEqual(destination.read_bytes(), sample.read_bytes())


if __name__ == "__main__":
    unittest.main()
