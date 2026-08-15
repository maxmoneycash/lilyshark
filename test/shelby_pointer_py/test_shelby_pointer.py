import contextlib
import hashlib
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import lscap  # noqa: E402
import shelby_pointer  # noqa: E402


# Byte-exact output of the C++ encoder (test/shelby_pointer) for the fields
# below, also pinned in docs/shelby-pointer-format.md as the format's test
# vector. The TypeScript webapp reader is checked against the same bytes.
GOLDEN_POINTER = bytes.fromhex(
    "53484c420105a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"
    "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf0104070a0d10"
    "1316191c1f2225282b2e3134373a3d404346494c4f52"
    "55585b5e0000100080d8db7000000100"
)
GOLDEN_COMMITMENT = bytes(range(0xA0, 0xC0))
GOLDEN_OWNER = bytes(((i * 3 + 1) & 0xFF) for i in range(32))
GOLDEN_EXPIRY = 1893456000  # 2030-01-01T00:00:00Z

LSCAP_FILE_HEADER = bytes.fromhex(
    "4c53435001000000180050000000000040420f0000000000"
)


def make_capture(payloads):
    """Build a minimal valid .lscap holding one record per payload."""
    out = bytearray(LSCAP_FILE_HEADER)
    for sequence, payload in enumerate(payloads):
        out += lscap.RECORD_HEADER.pack(
            b"LSFR", 80, 1, len(payload), len(payload), sequence,
            1_000_000 * (sequence + 1), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, b"\x00\x00\x00",
        )
        out += payload
    return bytes(out)


def run_cli(argv):
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        code = shelby_pointer.main(argv)
    return code, stdout.getvalue(), stderr.getvalue()


class GoldenVectorTest(unittest.TestCase):
    def test_decode_matches_cxx_encoder_output(self):
        pointer = shelby_pointer.decode_pointer(GOLDEN_POINTER)
        self.assertEqual(pointer["version"], 1)
        self.assertEqual(pointer["flags"], 0x05)
        self.assertTrue(pointer["encrypted"])
        self.assertTrue(pointer["capture"])
        self.assertFalse(pointer["chunked"])
        self.assertEqual(pointer["commitment_hex"], GOLDEN_COMMITMENT.hex())
        self.assertEqual(pointer["owner_hex"], GOLDEN_OWNER.hex())
        self.assertEqual(pointer["size_bytes"], 1 << 20)
        self.assertEqual(pointer["expires_at_unix"], GOLDEN_EXPIRY)
        self.assertEqual(pointer["chunk_index"], 0)
        self.assertEqual(pointer["chunk_count"], 1)

    def test_encode_reproduces_cxx_bytes_exactly(self):
        encoded = shelby_pointer.encode_pointer(
            flags=0x05,
            commitment=GOLDEN_COMMITMENT,
            owner=GOLDEN_OWNER,
            size_bytes=1 << 20,
            expires_at_unix=GOLDEN_EXPIRY,
        )
        self.assertEqual(encoded, GOLDEN_POINTER)
        self.assertEqual(len(encoded), shelby_pointer.ENCODED_SIZE)


class CodecTest(unittest.TestCase):
    def test_chunked_round_trip(self):
        encoded = shelby_pointer.encode_pointer(
            flags=shelby_pointer.FLAG_CHUNKED | shelby_pointer.FLAG_CAPTURE,
            commitment=GOLDEN_COMMITMENT,
            owner=GOLDEN_OWNER,
            size_bytes=7 * 200,
            expires_at_unix=GOLDEN_EXPIRY,
            chunk_index=3,
            chunk_count=7,
        )
        pointer = shelby_pointer.decode_pointer(encoded)
        self.assertTrue(pointer["chunked"])
        self.assertEqual(pointer["chunk_index"], 3)
        self.assertEqual(pointer["chunk_count"], 7)

    def assertRejected(self, data, reason):
        with self.assertRaises(shelby_pointer.ShelbyPointerError) as caught:
            shelby_pointer.decode_pointer(data)
        self.assertEqual(caught.exception.reason, reason)

    def test_rejections_match_cxx_result_codes(self):
        self.assertRejected(GOLDEN_POINTER[:40], "buffer_too_small")
        self.assertRejected(bytes(82), "no_magic")

        bad_version = bytearray(GOLDEN_POINTER)
        bad_version[4] = 99
        self.assertRejected(bytes(bad_version), "unsupported_version")

        zero_count = bytearray(GOLDEN_POINTER)
        zero_count[80] = zero_count[81] = 0
        self.assertRejected(bytes(zero_count), "malformed")

        index_past_end = bytearray(GOLDEN_POINTER)
        index_past_end[5] |= shelby_pointer.FLAG_CHUNKED
        index_past_end[78] = 2  # chunk_index 2 of chunk_count... 1: fix count too
        index_past_end[80] = 2
        self.assertRejected(bytes(index_past_end), "malformed")

        # chunk_count > 1 without the chunked flag: a receiver could mistake
        # one part of a split blob for a whole one.
        no_flag = bytearray(GOLDEN_POINTER)
        no_flag[80] = 4
        self.assertRejected(bytes(no_flag), "malformed")

        # The reverse: chunked flag set on a single-chunk pointer.
        stray_flag = bytearray(GOLDEN_POINTER)
        stray_flag[5] |= shelby_pointer.FLAG_CHUNKED
        self.assertRejected(bytes(stray_flag), "malformed")

    def test_encode_rejects_impossible_chunking(self):
        with self.assertRaises(shelby_pointer.ShelbyPointerError):
            shelby_pointer.encode_pointer(
                flags=0, commitment=GOLDEN_COMMITMENT, owner=GOLDEN_OWNER,
                size_bytes=1, expires_at_unix=GOLDEN_EXPIRY, chunk_count=0,
            )

    def test_find_pointer_behind_protocol_header(self):
        header = bytes(range(16))
        found = shelby_pointer.find_pointer(header + GOLDEN_POINTER + b"tail!")
        self.assertIsNotNone(found)
        offset, pointer = found
        self.assertEqual(offset, 16)
        self.assertEqual(pointer["size_bytes"], 1 << 20)

    def test_find_pointer_absent(self):
        self.assertIsNone(shelby_pointer.find_pointer(bytes(96)))
        self.assertIsNone(shelby_pointer.find_pointer(b""))


class CliTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self.blob = self.dir / "field-notes.bin"
        self.blob.write_bytes(b"lilyshark " * 500)  # 5000 bytes
        self.owner = "0x" + GOLDEN_OWNER.hex()

    def emit(self, *extra):
        code, stdout, _ = run_cli([
            "emit", str(self.blob), "--owner", self.owner,
            "--expires", str(GOLDEN_EXPIRY), "--out-dir", str(self.dir), *extra,
        ])
        self.assertEqual(code, 0)
        return json.loads(stdout)

    def test_emit_parse_verify_round_trip(self):
        result = self.emit("--capture")
        pointer_info = result["pointers"][0]
        self.assertEqual(
            pointer_info["commitment_hex"],
            hashlib.sha256(self.blob.read_bytes()).hexdigest(),
        )
        self.assertEqual(pointer_info["size_bytes"], 5000)
        self.assertTrue(pointer_info["capture"])

        code, stdout, _ = run_cli(["parse", pointer_info["file"]])
        self.assertEqual(code, 0)
        parsed = json.loads(stdout)
        self.assertEqual(parsed["offset"], 0)
        self.assertEqual(parsed["pointer"]["owner_hex"], GOLDEN_OWNER.hex())

        code, stdout, _ = run_cli(["verify", pointer_info["file"], str(self.blob)])
        self.assertEqual(code, 0, stdout)
        self.assertIn("ok:", stdout)

    def test_verify_rejects_wrong_bytes(self):
        result = self.emit()
        self.blob.write_bytes(b"different bytes")
        code, _, stderr = run_cli(["verify", result["pointers"][0]["file"], str(self.blob)])
        self.assertEqual(code, 1)
        self.assertIn("commitment mismatch", stderr)

    def test_verify_rejects_chunked_pointer(self):
        result = self.emit("--chunk-size", "1000")
        code, _, stderr = run_cli(["verify", result["pointers"][0]["file"], str(self.blob)])
        self.assertEqual(code, 1)
        self.assertIn("chunk", stderr)

    def test_chunked_emit_announces_every_chunk(self):
        result = self.emit("--chunk-size", "1000")
        self.assertEqual(len(result["pointers"]), 5)
        for index, info in enumerate(result["pointers"]):
            self.assertEqual(info["chunk_index"], index)
            self.assertEqual(info["chunk_count"], 5)
            self.assertTrue(info["chunked"])
            # Every emitted pointer must be decodable by its own rules.
            decoded = shelby_pointer.decode_pointer(Path(info["file"]).read_bytes())
            self.assertEqual(decoded["chunk_index"], index)

    def test_scan_capture_reports_carrying_frames(self):
        header = bytes(range(12))
        payloads = [
            bytes(range(96)),                       # ordinary traffic
            header + GOLDEN_POINTER,                # pointer behind a header
            GOLDEN_POINTER[:40],                    # truncated: not a pointer
        ]
        capture = self.dir / "field.lscap"
        capture.write_bytes(make_capture(payloads))

        code, stdout, stderr = run_cli(["scan", str(capture)])
        self.assertEqual(code, 0, stderr)
        hits = [json.loads(line) for line in stdout.splitlines()]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["frame_index"], 1)
        self.assertEqual(hits[0]["payload_offset"], 12)
        self.assertEqual(hits[0]["pointer"]["commitment_hex"], GOLDEN_COMMITMENT.hex())
        self.assertIn("1 Shelby pointer(s)", stderr)


class SampleCaptureTest(unittest.TestCase):
    """The committed demo capture must keep carrying exactly one pointer."""

    SAMPLE = REPO_ROOT / "samples" / "sample-mesh-traffic.lscap"

    def test_sample_scans_to_one_pointer_at_sequence_9(self):
        code, stdout, _ = run_cli(["scan", str(self.SAMPLE)])
        self.assertEqual(code, 0)
        hits = [json.loads(line) for line in stdout.splitlines()]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["sequence"], 9)
        self.assertEqual(hits[0]["payload_offset"], 16)
        self.assertTrue(hits[0]["pointer"]["capture"])

    def test_sample_is_regenerated_deterministically(self):
        import generate_sample_capture  # noqa: PLC0415 -- scripts dir on sys.path

        self.assertEqual(self.SAMPLE.read_bytes(), generate_sample_capture.build())


if __name__ == "__main__":
    unittest.main()
