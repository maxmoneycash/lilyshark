import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import field_receipts  # noqa: E402
import lscap  # noqa: E402


# WITNESS-VECTOR-1, pinned byte-exact in docs/protocol/field-receipts.md.
# The TypeScript and C++ implementations are checked against the same bytes.
GOLDEN_PAYLOAD = bytes(range(0xA0, 0xC0))
GOLDEN_FREQ_HZ = 906_862_500
GOLDEN_UNIX_SECONDS = 1_893_456_000  # 2030-01-01T00:00:00Z
GOLDEN_PREIMAGE = bytes.fromhex(
    "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5"
    "b6b7b8b9babbbcbdbebf78d00d36e087e101"
)
GOLDEN_KEY_HEX = "94ed6915ddbbfb1b5c2557f5ecb61cfe3783f40be380323af53beb8c3b610125"

# .lscap 1.1 file header: synthetic provenance (metadata bit 2) is defined.
FILE_HEADER_1_1 = lscap.FILE_HEADER.pack(b"LSCP", 1, 1, 24, 80, 0, 1_000_000, 0)

CRC_VALID = 2
CRC_INVALID = 3
PRESENT_REQUIRED = 0b11  # timestamp + center frequency
SYNTHETIC_FLAG = 1 << 2


def make_record(
    payload,
    *,
    sequence=0,
    timestamp_us=0,
    present_fields=PRESENT_REQUIRED,
    center_frequency_hz=906_875_000,
    original_length=None,
    crc_state=CRC_VALID,
    metadata_flags=0,
):
    header = lscap.RECORD_HEADER.pack(
        b"LSFR", 80, 1, len(payload),
        len(payload) if original_length is None else original_length,
        sequence, timestamp_us, present_fields, center_frequency_hz,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        crc_state, metadata_flags, b"\x00\x00\x00",
    )
    return header + payload


def make_capture(records):
    return FILE_HEADER_1_1 + b"".join(records)


def run_cli(argv):
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        code = field_receipts.main(argv)
    return code, stdout.getvalue(), stderr.getvalue()


class GoldenVectorTest(unittest.TestCase):
    def test_preimage_matches_published_bytes_exactly(self):
        preimage = field_receipts.witness_preimage(
            GOLDEN_PAYLOAD, GOLDEN_FREQ_HZ, GOLDEN_UNIX_SECONDS
        )
        self.assertEqual(preimage, GOLDEN_PREIMAGE)
        self.assertEqual(len(preimage), len(GOLDEN_PAYLOAD) + 8)

    def test_key_matches_published_vector_exactly(self):
        key = field_receipts.witness_key(
            GOLDEN_PAYLOAD, GOLDEN_FREQ_HZ, GOLDEN_UNIX_SECONDS
        )
        self.assertEqual(key.hex(), GOLDEN_KEY_HEX)
        # The key is the plain SHA-256 of the preimage, nothing layered on.
        self.assertEqual(key, hashlib.sha256(GOLDEN_PREIMAGE).digest())

    def test_module_constants_agree_with_the_doc(self):
        self.assertEqual(field_receipts.VECTOR_PAYLOAD, GOLDEN_PAYLOAD)
        self.assertEqual(field_receipts.VECTOR_FREQ_HZ, GOLDEN_FREQ_HZ)
        self.assertEqual(field_receipts.VECTOR_UNIX_SECONDS, GOLDEN_UNIX_SECONDS)
        self.assertEqual(field_receipts.VECTOR_KEY_HEX, GOLDEN_KEY_HEX)

    def test_vector_command_self_tests_and_prints_the_key(self):
        code, stdout, stderr = run_cli(["vector"])
        self.assertEqual(code, 0, stderr)
        report = json.loads(stdout)
        self.assertEqual(report["name"], "WITNESS-VECTOR-1")
        self.assertEqual(report["witness_key_hex"], GOLDEN_KEY_HEX)
        self.assertEqual(report["preimage_hex"], GOLDEN_PREIMAGE.hex())
        self.assertEqual(report["self_test"], "ok")


class RoundingTest(unittest.TestCase):
    """Round-half-up to 25 kHz: 12,499 Hz above a step stays, 12,500 goes up."""

    STEP = 906_850_000  # a multiple of 25 kHz

    def test_below_at_and_above_the_half_way_boundary(self):
        rf = field_receipts.round_frequency_hz
        self.assertEqual(rf(self.STEP + 12_499), self.STEP)
        self.assertEqual(rf(self.STEP + 12_500), self.STEP + 25_000)
        self.assertEqual(rf(self.STEP + 12_501), self.STEP + 25_000)

    def test_exact_multiples_are_unchanged(self):
        rf = field_receipts.round_frequency_hz
        for freq in (0, 906_875_000, 869_525_000):
            self.assertEqual(rf(freq), freq)

    def test_just_below_a_step_rounds_up_to_it(self):
        self.assertEqual(
            field_receipts.round_frequency_hz(self.STEP - 12_500), self.STEP
        )


class BucketTest(unittest.TestCase):
    def test_buckets_are_floor_division_by_sixty(self):
        tb = field_receipts.time_bucket
        self.assertEqual(tb(0), 0)
        self.assertEqual(tb(59), 0)
        self.assertEqual(tb(60), 1)
        self.assertEqual(tb(119), 1)
        self.assertEqual(tb(120), 2)
        self.assertEqual(tb(GOLDEN_UNIX_SECONDS), 31_557_600)

    def test_adjacent_buckets_yield_different_keys(self):
        # Two receivers one second apart across a bucket edge miss each
        # other — the accepted loss the spec documents.
        before = field_receipts.witness_key(b"\x01", 906_875_000, 119)
        after = field_receipts.witness_key(b"\x01", 906_875_000, 120)
        self.assertNotEqual(before, after)
        # Within one bucket, receive-time jitter does not matter.
        same = field_receipts.witness_key(b"\x01", 906_875_000, 61)
        self.assertEqual(same, before)


class EligibilityTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write_capture(self, records, name="test.lscap"):
        path = self.dir / name
        path.write_bytes(make_capture(records))
        return path

    def test_only_eligible_frames_emit_keys(self):
        epoch = 1_893_456_000
        records = [
            make_record(b"\x11\x22", sequence=0, timestamp_us=1_000_000),
            make_record(b"\x33", sequence=1, timestamp_us=2_000_000,
                        crc_state=CRC_INVALID),
            make_record(b"\x44", sequence=2, timestamp_us=3_000_000,
                        crc_state=0),  # unknown
            make_record(b"\x55", sequence=3, timestamp_us=4_000_000,
                        metadata_flags=SYNTHETIC_FLAG),
            make_record(b"", sequence=4, timestamp_us=5_000_000),
            make_record(b"\x66", sequence=5, timestamp_us=6_000_000,
                        original_length=4),  # truncated
            make_record(b"\x77", sequence=6, timestamp_us=7_000_000,
                        present_fields=0),  # required fields absent
            make_record(b"\x88\x99", sequence=7, timestamp_us=8_000_000),
        ]
        capture = self.write_capture(records)

        code, stdout, stderr = run_cli(["keys", str(capture), "--epoch", str(epoch)])
        self.assertEqual(code, 0, stderr)
        lines = stdout.splitlines()
        self.assertEqual(len(lines), 2)

        seq0, key0 = lines[0].split()
        seq7, key7 = lines[1].split()
        self.assertEqual((seq0, seq7), ("0", "7"))
        self.assertEqual(
            key0,
            field_receipts.witness_key(b"\x11\x22", 906_875_000, epoch + 1).hex(),
        )
        self.assertEqual(
            key7,
            field_receipts.witness_key(b"\x88\x99", 906_875_000, epoch + 8).hex(),
        )
        # Synthetic frames are refused loudly, not silently dropped.
        self.assertIn("refused 1 synthetic frame", stderr)

    def test_verbose_lines_expose_the_derivation_inputs(self):
        epoch = 1_893_456_000
        capture = self.write_capture(
            [make_record(b"\xaa\xbb", timestamp_us=1_000_000,
                         center_frequency_hz=906_862_500)]
        )
        code, stdout, _ = run_cli(
            ["keys", str(capture), "--epoch", str(epoch), "-v"]
        )
        self.assertEqual(code, 0)
        frame = json.loads(stdout.splitlines()[0])
        self.assertEqual(frame["payload_hex"], "aabb")
        self.assertEqual(frame["freq_hz"], 906_862_500)
        self.assertEqual(frame["rounded_freq_hz"], 906_875_000)
        self.assertEqual(frame["unix_seconds"], epoch + 1)
        self.assertEqual(frame["time_bucket"], (epoch + 1) // 60)
        self.assertEqual(
            frame["witness_key_hex"],
            field_receipts.witness_key(b"\xaa\xbb", 906_862_500, epoch + 1).hex(),
        )

    def test_all_synthetic_capture_is_refused_with_nonzero_exit(self):
        capture = self.write_capture(
            [
                make_record(b"\x01", sequence=i, timestamp_us=(i + 1) * 1_000_000,
                            metadata_flags=SYNTHETIC_FLAG)
                for i in range(3)
            ]
        )
        code, stdout, stderr = run_cli(
            ["keys", str(capture), "--epoch", "1893456000"]
        )
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertIn("refused 3 synthetic frames", stderr)
        self.assertIn("no eligible frames", stderr)

    def test_missing_epoch_makes_every_frame_ineligible(self):
        capture = self.write_capture([make_record(b"\x01", timestamp_us=1_000_000)])
        code, stdout, stderr = run_cli(["keys", str(capture)])
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertIn("--epoch", stderr)


class SampleCaptureTest(unittest.TestCase):
    """The bundled sample is all-synthetic: it must hit the refusal path."""

    SAMPLE = REPO_ROOT / "samples" / "sample-mesh-traffic.lscap"

    def test_sample_refuses_all_24_synthetic_frames(self):
        code, stdout, stderr = run_cli(
            ["keys", str(self.SAMPLE), "--epoch", "1893456000"]
        )
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertIn("refused 24 synthetic frames", stderr)
        self.assertIn("no eligible frames", stderr)


if __name__ == "__main__":
    unittest.main()
