import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import generate_most_wanted as gmw  # noqa: E402


class GenerateMostWantedTests(unittest.TestCase):
    def test_default_generation(self):
        output, markdown = gmw.generate_most_wanted(
            gmw.DEFAULT_EVENTS,
            gmw.DEFAULT_CELLS,
            gmw.DEFAULT_RULES,
        )
        self.assertIn("method", output)
        self.assertIn("most_wanted", output)
        self.assertGreater(len(output["most_wanted"]), 0)
        self.assertIn("Most-Wanted Cells", markdown)
        self.assertIn("Synthetic test data", markdown)
        self.assertEqual(output["method"]["source"], "synthetic-fixture")
        self.assertIn("| Cell (Geohash-5) |", markdown)

    def test_cli_execution_and_check(self):
        cmd = [sys.executable, str(SCRIPTS_DIR / "generate_most_wanted.py"), "--check"]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Most-wanted publications are up to date", proc.stdout)

    def test_cli_custom_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_md = Path(tmp) / "out.md"
            tmp_json = Path(tmp) / "out.json"
            cmd = [
                sys.executable,
                str(SCRIPTS_DIR / "generate_most_wanted.py"),
                "--output-md", str(tmp_md),
                "--output-json", str(tmp_json),
                "--limit", "5",
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(tmp_md.exists())
            self.assertTrue(tmp_json.exists())
            data = json.loads(tmp_json.read_text(encoding="utf-8"))
            self.assertEqual(len(data["most_wanted"]), 5)
            self.assertEqual(data["method"]["source"], "synthetic-fixture")


if __name__ == "__main__":
    unittest.main()
