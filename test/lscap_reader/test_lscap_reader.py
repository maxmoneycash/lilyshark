import io
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import lscap  # noqa: E402


FILE_HEADER = bytes.fromhex(
    "4c53435001000100180050000000000040420f0000000000"
)
LEGACY_FILE_HEADER = bytes.fromhex(
    "4c53435001000000180050000000000040420f0000000000"
)

# This is the byte-exact version 1 record emitted by the C++ writer golden test.
GOLDEN_RECORD = bytes.fromhex(
    "4c53465250000100030005000807060504030201"
    "1817161514131211242322213433323124f40000"
    "444342415453525164636261feffffff25fcb8ff"
    "727124148281fdfffc0705090101010303000000"
    "deadbe"
)

RECORD_STRUCT = struct.Struct("<4sHHHHQQIIIIIIihhHHHhbBBBBBBBB3s")


def make_record(
    payload=b"LSFR\x00\xff",
    *,
    header_size=80,
    layout_version=1,
    original_length=None,
    sequence=9,
    modulation=0xFE,
    direction=0xFD,
    crc_state=0xFC,
    metadata_flags=0x85,
    extension=b"",
):
    if original_length is None:
        original_length = len(payload)
    header = RECORD_STRUCT.pack(
        b"LSFR",
        header_size,
        layout_version,
        len(payload),
        original_length,
        sequence,
        10,
        0x80000001,
        910_525_000,
        62_500,
        4_800,
        2_400,
        123,
        -345,
        -1_234,
        -56,
        8,
        0x1424,
        2,
        -7,
        -9,
        7,
        5,
        3,
        1,
        modulation,
        direction,
        crc_state,
        metadata_flags,
        b"\x01\x02\x03",
    )
    return header + extension + payload


def read_capture(data):
    stream = io.BytesIO(data)
    file_header = lscap.read_file_header(stream)
    return file_header, list(lscap.iter_records(stream, file_header))


class CaptureReaderTests(unittest.TestCase):
    def test_valid_multi_record_golden_bytes_preserve_values(self):
        data = FILE_HEADER + GOLDEN_RECORD + make_record()
        file_header, records = read_capture(data)

        self.assertEqual(file_header["record_header_size"], 80)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["offset"], 24)
        self.assertEqual(records[0]["bandwidth_hz"], 62_500)
        self.assertEqual(records[0]["frequency_error_hz"], -2)
        self.assertEqual(records[0]["rssi_dbm_x10"], -987)
        self.assertEqual(records[0]["snr_db_x10"], -72)
        self.assertEqual(records[0]["radio_status"], -3)
        self.assertEqual(records[0]["tx_power_dbm"], -4)
        self.assertEqual(records[0]["modulation"], 1)
        self.assertEqual(records[0]["modulation_name"], "lora")
        self.assertEqual(records[0]["direction"], 1)
        self.assertEqual(records[0]["crc_state"], 3)
        self.assertEqual(records[0]["metadata_flags"], 3)
        self.assertFalse(records[0]["synthetic"])
        self.assertEqual(
            records[0]["metadata_flag_names"], ["implicit_header", "inverted_iq"]
        )

        self.assertEqual(records[1]["offset"], 107)
        self.assertEqual(records[1]["payload_hex"], b"LSFR\x00\xff".hex())
        self.assertEqual(records[1]["present_fields"], 0x80000001)
        self.assertEqual(records[1]["present_field_names"], ["timestamp"])
        self.assertEqual(records[1]["unknown_present_field_bits"], 0x80000000)
        self.assertEqual(records[1]["modulation"], 0xFE)
        self.assertIsNone(records[1]["modulation_name"])
        self.assertEqual(records[1]["direction"], 0xFD)
        self.assertIsNone(records[1]["direction_name"])
        self.assertEqual(records[1]["crc_state"], 0xFC)
        self.assertIsNone(records[1]["crc_state_name"])
        self.assertEqual(records[1]["metadata_flags"], 0x85)
        self.assertEqual(
            records[1]["metadata_flag_names"], ["implicit_header", "synthetic"]
        )
        self.assertEqual(records[1]["unknown_metadata_flag_bits"], 0x80)
        self.assertTrue(records[1]["synthetic"])
        self.assertEqual(records[1]["reserved_hex"], "010203")

    def test_version_one_zero_does_not_assign_the_later_synthetic_flag(self):
        header, records = read_capture(
            LEGACY_FILE_HEADER + make_record(metadata_flags=0x04)
        )
        self.assertEqual(header["minor_version"], 0)
        self.assertFalse(records[0]["synthetic"])
        self.assertEqual(records[0]["metadata_flag_names"], [])
        self.assertEqual(records[0]["unknown_metadata_flag_bits"], 0x04)

    def test_bundled_samples_are_version_one_one_and_synthetic(self):
        for name in ("sample-mesh-traffic.lscap", "field-capture-0846.lscap"):
            with self.subTest(name=name):
                with (REPO_ROOT / "samples" / name).open("rb") as stream:
                    header = lscap.read_file_header(stream)
                    records = list(lscap.iter_records(stream, header))
                self.assertEqual(header["minor_version"], lscap.FORMAT_MINOR)
                self.assertEqual(len(records), 24)
                self.assertTrue(all(record["synthetic"] for record in records))

    def test_maximum_length_frame(self):
        payload = bytes(range(255))
        _, records = read_capture(
            FILE_HEADER + make_record(payload, original_length=65_535)
        )
        self.assertEqual(records[0]["captured_length"], 255)
        self.assertEqual(records[0]["original_length"], 65_535)
        self.assertEqual(records[0]["payload_hex"], payload.hex())

    def test_compatible_header_extensions_are_preserved(self):
        file_header = bytearray(FILE_HEADER)
        file_header[8:10] = (26).to_bytes(2, "little")
        file_header[10:12] = (82).to_bytes(2, "little")
        data = bytes(file_header) + b"\xaa\xbb" + make_record(
            b"x", header_size=82, extension=b"\xcc\xdd"
        )

        parsed_header, records = read_capture(data)
        self.assertEqual(parsed_header["header_extension_hex"], "aabb")
        self.assertEqual(records[0]["offset"], 26)
        self.assertEqual(records[0]["header_extension_hex"], "ccdd")
        self.assertEqual(records[0]["payload_hex"], "78")

    def test_rejects_malformed_file_headers(self):
        cases = [(FILE_HEADER[:17], "incomplete header")]

        wrong_magic = bytearray(FILE_HEADER)
        wrong_magic[:4] = b"NOPE"
        cases.append((bytes(wrong_magic), "invalid magic"))

        unsupported_major = bytearray(FILE_HEADER)
        unsupported_major[4:6] = (2).to_bytes(2, "little")
        cases.append((bytes(unsupported_major), "unsupported major version 2"))

        short_file_header = bytearray(FILE_HEADER)
        short_file_header[8:10] = (23).to_bytes(2, "little")
        cases.append((bytes(short_file_header), "invalid header size 23"))

        short_record_header = bytearray(FILE_HEADER)
        short_record_header[10:12] = (79).to_bytes(2, "little")
        cases.append((bytes(short_record_header), "invalid record header size 79"))

        extended_but_truncated = bytearray(FILE_HEADER)
        extended_but_truncated[8:10] = (25).to_bytes(2, "little")
        cases.append((bytes(extended_but_truncated), "incomplete declared header"))

        for data, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(lscap.CaptureFormatError, message):
                    read_capture(data)

    def test_rejects_invalid_record_headers_and_lengths(self):
        valid = bytearray(make_record(b"abc"))
        cases = []

        bad_magic = bytearray(valid)
        bad_magic[:4] = b"NOPE"
        cases.append((bad_magic, "invalid magic"))

        short_header = bytearray(valid)
        short_header[4:6] = (79).to_bytes(2, "little")
        cases.append((short_header, "invalid header size 79"))

        mismatched_header = bytearray(valid)
        mismatched_header[4:6] = (81).to_bytes(2, "little")
        cases.append((mismatched_header, "does not match file header value 80"))

        unsupported_layout = bytearray(valid)
        unsupported_layout[6:8] = (2).to_bytes(2, "little")
        cases.append((unsupported_layout, "unsupported record layout version 2"))

        excessive_capture = bytearray(valid)
        excessive_capture[8:10] = (256).to_bytes(2, "little")
        excessive_capture[10:12] = (256).to_bytes(2, "little")
        cases.append((excessive_capture, "invalid captured length 256"))

        original_too_short = bytearray(valid)
        original_too_short[10:12] = (2).to_bytes(2, "little")
        cases.append((original_too_short, "original length 2 is smaller"))

        for record, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(
                    lscap.CaptureFormatError,
                    rf"record 0 at offset 24 \(0x18\): .*{message}",
                ):
                    read_capture(FILE_HEADER + record)

    def test_incomplete_record_header_reports_record_offset(self):
        data = FILE_HEADER + GOLDEN_RECORD + make_record()[:12]
        with self.assertRaisesRegex(
            lscap.CaptureFormatError,
            r"record 1 at offset 107 \(0x6B\): incomplete header",
        ):
            read_capture(data)

    def test_incomplete_payload_reports_record_offset_without_resync(self):
        record = make_record(b"aaLSFRbb")
        record = (
            record[:8]
            + (10).to_bytes(2, "little")
            + (10).to_bytes(2, "little")
            + record[12:]
        )
        with self.assertRaisesRegex(
            lscap.CaptureFormatError,
            r"record 0 at offset 24 \(0x18\): incomplete payload; "
            r"expected 10 bytes, found 8",
        ):
            read_capture(FILE_HEADER + record)

    def test_incomplete_extended_record_header_reports_record_offset(self):
        file_header = bytearray(FILE_HEADER)
        file_header[10:12] = (82).to_bytes(2, "little")
        record = make_record(b"", header_size=82) + b"\xaa"
        with self.assertRaisesRegex(
            lscap.CaptureFormatError,
            r"record 0 at offset 24 \(0x18\): incomplete declared header",
        ):
            read_capture(bytes(file_header) + record)


class CaptureCliTests(unittest.TestCase):
    def run_cli(self, *arguments):
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "lscap.py"), *arguments],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_validate_and_both_dump_formats(self):
        data = FILE_HEADER + GOLDEN_RECORD + make_record()
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory) / "meshcore.lscap"
            capture.write_bytes(data)

            validated = self.run_cli("validate", str(capture))
            self.assertEqual(validated.returncode, 0, validated.stderr)
            self.assertIn("2 records, 9 payload bytes", validated.stdout)
            self.assertIn("1 synthetic record", validated.stdout)

            dumped = self.run_cli("dump", str(capture))
            self.assertEqual(dumped.returncode, 0, dumped.stderr)
            lines = [json.loads(line) for line in dumped.stdout.splitlines()]
            self.assertEqual(
                [line["type"] for line in lines],
                ["file_header", "frame", "frame"],
            )
            self.assertEqual(lines[1]["rssi_dbm_x10"], -987)

            pretty = self.run_cli("dump", "--pretty", str(capture))
            self.assertEqual(pretty.returncode, 0, pretty.stderr)
            document = json.loads(pretty.stdout)
            self.assertEqual(document["file_header"]["major_version"], 1)
            self.assertEqual(len(document["records"]), 2)

    def test_ndjson_emits_complete_records_before_truncated_tail_error(self):
        data = FILE_HEADER + GOLDEN_RECORD + make_record()[:-2]
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory) / "truncated.lscap"
            capture.write_bytes(data)

            result = self.run_cli("dump", str(capture))
            self.assertEqual(result.returncode, 1)
            complete_lines = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(
                [line["type"] for line in complete_lines], ["file_header", "frame"]
            )
            self.assertIn("record 1 at offset 107 (0x6B)", result.stderr)
            self.assertIn("incomplete payload", result.stderr)

            validated = self.run_cli("validate", str(capture))
            self.assertEqual(validated.returncode, 1)
            self.assertEqual(validated.stdout, "")
            self.assertIn("record 1 at offset 107 (0x6B)", validated.stderr)
            self.assertIn("incomplete payload", validated.stderr)


if __name__ == "__main__":
    unittest.main()
