"""Exercise the Mac app's recording lifetime against a pseudo-terminal."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "macOS Swift toolchain required")
class USBCaptureSessionTests(unittest.TestCase):
    def test_stop_disconnect_and_save_retry_keep_the_capture(self):
        with tempfile.TemporaryDirectory(prefix="lilyshark-usb-session-") as temp:
            work = Path(temp)
            arm = subprocess.run(["sysctl", "-n", "hw.optional.arm64"], capture_output=True, text=True).stdout.strip() == "1"
            arch = "arm64" if arm else "x86_64"
            package = ROOT / "ios/Packages/MeshtasticKit"
            build = subprocess.run(["swift", "build", "--package-path", str(package), "--arch", arch], capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stderr[-4000:])
            products = package / f".build/{arch}-apple-macosx/debug"
            module_dir = products / "Modules"
            objects = list((products / "MeshtasticKit.build").glob("*.swift.o"))
            if not objects or not module_dir.exists():
                spm_products = package / ".build/out/Products/Debug"
                if spm_products.exists():
                    module_dir = spm_products
                    if (spm_products / "MeshtasticKit.o").exists():
                        objects = [spm_products / "MeshtasticKit.o"]
                    elif (spm_products / "libMeshtasticKit.a").exists():
                        objects = [spm_products / "libMeshtasticKit.a"]
                if not objects:
                    objects = list((package / ".build").glob(f"**/{arch}/*.o"))
                    if not objects:
                        objects = list((package / ".build").glob("**/*.o"))
            self.assertTrue(objects, "Could not find compiled MeshtasticKit objects")
            binary = work / "session-check"
            compile = subprocess.run(["swiftc", "-parse-as-library", "-target", f"{arch}-apple-macosx15.0",
                "-I", str(module_dir), str(ROOT / "ios/Shared/Models/USBCaptureSession.swift"),
                str(Path(__file__).with_name("usb_session.swift")), *map(str, objects), "-o", str(binary)],
                capture_output=True, text=True)
            self.assertEqual(compile.returncode, 0, compile.stderr[-6000:])
            run = subprocess.run([str(binary), str(work)], capture_output=True, text=True, timeout=25)
            self.assertEqual(run.returncode, 0, run.stdout[-2000:] + run.stderr[-4000:])


if __name__ == "__main__":
    unittest.main()
