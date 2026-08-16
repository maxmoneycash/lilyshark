from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


class TDeckPreflightTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="lilyshark-preflight-")
        self.root = Path(self.temp_dir.name)
        (self.root / "dist").mkdir()
        (self.root / "scripts").mkdir()
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()

        shutil.copy2(
            REPO_ROOT / "scripts" / "smoke_tdeck.py",
            self.root / "scripts" / "smoke_tdeck.py",
        )
        self.image = self.root / "dist" / "lilyshark-tdeck.factory.bin"
        self.image.write_bytes(b"\xe9Lilyshark preflight fixture")
        digest = hashlib.sha256(self.image.read_bytes()).hexdigest()
        (self.root / "dist" / "SHA256SUMS").write_text(
            "0" * 64 + "  lilyshark-tdeck.bin\n"
            + digest
            + "  lilyshark-tdeck.factory.bin\n"
            + "f" * 64
            + "  lilyshark-tdeck.elf\n",
            encoding="utf-8",
        )

        uvx = self.bin_dir / "uvx"
        uvx.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        uvx.chmod(0o755)

        python = self.bin_dir / "python3"
        python.write_text(
            "#!/bin/sh\nexec " + repr(sys.executable) + " -S \"$@\"\n",
            encoding="utf-8",
        )
        python.chmod(0o755)

        self.environment = os.environ.copy()
        self.environment["LILYSHARK_REPO_DIR"] = str(self.root)
        self.environment["PATH"] = str(self.bin_dir) + os.pathsep + os.environ["PATH"]
        self.environment["PYTHONDONTWRITEBYTECODE"] = "1"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def snapshot(self) -> dict[str, str]:
        result: dict[str, str] = {}
        for path in sorted(candidate for candidate in self.root.rglob("*") if candidate.is_file()):
            result[str(path.relative_to(self.root))] = hashlib.sha256(path.read_bytes()).hexdigest()
        return result

    def run_preflight(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(REPO_ROOT / "scripts" / "preflight_tdeck.sh")],
            cwd=self.root,
            env=self.environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_factory_only_download_passes_without_pyserial_or_writes(self) -> None:
        before = self.snapshot()
        result = self.run_preflight()
        after = self.snapshot()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("SHA256SUMS matches the staged factory image", result.stdout)
        self.assertIn("first-boot checker ready (Python standard library)", result.stdout)
        self.assertIn("no local build to compare", result.stdout)
        self.assertEqual(before, after)

    def test_factory_checksum_mismatch_fails(self) -> None:
        self.image.write_bytes(self.image.read_bytes() + b"corrupt")
        result = self.run_preflight()

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("factory-image checksum mismatched", result.stdout)


if __name__ == "__main__":
    unittest.main()
