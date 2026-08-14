import importlib.util
import contextlib
import io
import os
from pathlib import Path
import pty
import select
import threading
import tty
import unittest


REPO = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SPEC = importlib.util.spec_from_file_location(
    "smoke_tdeck", REPO / "scripts" / "smoke_tdeck.py"
)
assert SPEC is not None and SPEC.loader is not None
smoke_tdeck = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke_tdeck)


class SerialSmokeTest(unittest.TestCase):
    def assess_fixture(self, name):
        return smoke_tdeck.assess_boot_log((FIXTURES / name).read_text())

    def test_complete_boot_passes(self):
        self.assertEqual(self.assess_fixture("pass.log"), [])

    def test_peripheral_failures_name_each_failed_or_missing_milestone(self):
        failures = self.assess_fixture("peripheral_failures.log")
        self.assertIn(
            "touch: reported 'Lilyshark touch: not found (0x00)'", failures
        )
        self.assertIn(
            "PCAP capture: reported 'Lilyshark SD capture: unavailable (no card)'",
            failures,
        )
        self.assertIn(
            "native capture: reported 'Lilyshark native capture: unavailable'",
            failures,
        )
        self.assertIn(
            "radio: reported 'Lilyshark radio: Meshtastic Default "
            "(recovering, error -707)'",
            failures,
        )
        self.assertIn('UI: missing "Lilyshark UI ready"', failures)

    def test_fatal_boot_reports_fatal_and_unreached_milestones(self):
        failures = self.assess_fixture("fatal.log")
        self.assertIn(
            "firmware: reported 'Lilyshark fatal: LVGL display allocation failed'",
            failures,
        )
        self.assertIn('radio: missing "Lilyshark radio:"', failures)
        self.assertIn('UI: missing "Lilyshark UI ready"', failures)

    def test_common_esp32_failures_cannot_follow_a_clean_boot(self):
        passing_log = (FIXTURES / "pass.log").read_text()
        for marker in smoke_tdeck.ESP32_FAILURE_MARKERS:
            with self.subTest(marker=marker):
                failures = smoke_tdeck.assess_boot_log(f"{passing_log}\n{marker}\n")
                self.assertIn(f"firmware: reported {marker!r}", failures)

    def test_restart_is_not_a_clean_boot(self):
        failures = self.assess_fixture("restart.log")
        self.assertEqual(
            failures,
            ["startup: observed 2 boot banners; the device restarted during capture"],
        )

    def test_auto_port_requires_exactly_one_candidate(self):
        self.assertEqual(
            smoke_tdeck.select_auto_port(["/dev/ttyACM0"]), "/dev/ttyACM0"
        )
        with self.assertRaisesRegex(ValueError, "found 0 eligible"):
            smoke_tdeck.select_auto_port([])
        with self.assertRaisesRegex(ValueError, "found 2 eligible"):
            smoke_tdeck.select_auto_port(
                ["/dev/ttyACM0", "/dev/cu.usbmodem1101"]
            )

    def test_serial_reader_captures_fixture_without_writing_to_device(self):
        expected = (FIXTURES / "pass.log").read_bytes()
        master_fd, slave_fd = pty.openpty()
        tty.setraw(slave_fd)
        port = os.ttyname(slave_fd)
        received_from_harness = []

        def write_fixture():
            remaining = memoryview(expected)
            while remaining:
                remaining = remaining[os.write(master_fd, remaining) :]
            readable, _, _ = select.select([master_fd], [], [], 0.1)
            if readable:
                received_from_harness.append(os.read(master_fd, 4096))

        writer = threading.Thread(target=write_fixture)
        writer.start()
        try:
            saved = io.BytesIO()
            with contextlib.redirect_stdout(io.StringIO()):
                captured, read_error = smoke_tdeck.read_serial(port, 0.2, saved)
        finally:
            writer.join()
            os.close(slave_fd)
            os.close(master_fd)

        self.assertIsNone(read_error)
        self.assertEqual(captured.encode(), expected)
        self.assertEqual(saved.getvalue(), expected)
        self.assertEqual(received_from_harness, [])


if __name__ == "__main__":
    unittest.main()
