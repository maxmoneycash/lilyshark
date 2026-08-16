import hashlib
import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HEADER = REPO_ROOT / "include/lilyshark/ui/assets/lilyshark_wordmark_a8.h"
ASSET = REPO_ROOT / "src/ui/assets/lilyshark_wordmark_a8.c"
SVG = REPO_ROOT / "assets/brand/lilyshark-wordmark-pink.svg"

WIDTH = 264
HEIGHT = 128
EXPECTED_ALPHA_SHA256 = "25ca92eaef70d52d709213a4fcfaa97670089463075366cc66de006261c5177c"


class LogoAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.header = HEADER.read_text(encoding="utf-8")
        cls.asset = ASSET.read_text(encoding="utf-8")
        match = re.search(
            r"lilyshark_wordmark_a8_map\[\]\s*=\s*\{(.*?)\n\};",
            cls.asset,
            re.DOTALL,
        )
        if match is None:
            raise AssertionError("wordmark byte array is missing")
        cls.alpha = bytes(int(value, 16) for value in re.findall(r"0x([0-9a-f]{2})", match.group(1)))

    def test_descriptor_shape_and_format(self):
        self.assertIn("#define LILYSHARK_WORDMARK_A8_WIDTH 264U", self.header)
        self.assertIn("#define LILYSHARK_WORDMARK_A8_HEIGHT 128U", self.header)
        self.assertIn("#define LILYSHARK_WORDMARK_A8_STRIDE 264U", self.header)
        self.assertIn("#define LILYSHARK_WORDMARK_A8_DATA_SIZE 33792U", self.header)
        self.assertIn(".header.cf = LV_COLOR_FORMAT_A8", self.asset)
        self.assertIn(".data_size = sizeof(lilyshark_wordmark_a8_map)", self.asset)
        self.assertEqual(len(self.alpha), WIDTH * HEIGHT)

    def test_generated_asset_matches_source_revision(self):
        source_hash = hashlib.sha256(SVG.read_bytes()).hexdigest()
        self.assertIn("// Source SHA-256: {}".format(source_hash), self.asset)
        self.assertEqual(hashlib.sha256(self.alpha).hexdigest(), EXPECTED_ALPHA_SHA256)
        self.assertIn("// Alpha SHA-256: {}".format(EXPECTED_ALPHA_SHA256), self.asset)

    def test_mask_keeps_native_antialiasing_and_padding(self):
        nonzero = [
            (index % WIDTH, index // WIDTH, value)
            for index, value in enumerate(self.alpha)
            if value != 0
        ]
        self.assertTrue(nonzero)
        xs = [pixel[0] for pixel in nonzero]
        ys = [pixel[1] for pixel in nonzero]
        self.assertEqual((min(xs), min(ys), max(xs) + 1, max(ys) + 1), (2, 2, 262, 126))

        partial = [value for value in self.alpha if 0 < value < 255]
        self.assertGreaterEqual(len(set(partial)), 200)
        self.assertGreaterEqual(len(partial), 1800)
        self.assertIn(0, self.alpha)
        self.assertIn(255, self.alpha)

    def test_brand_color_is_runtime_selectable(self):
        self.assertIn("#define LILYSHARK_PINK_RGB888 0xFF4F9DU", self.header)
        self.assertNotIn("LV_COLOR_FORMAT_RGB", self.asset)


if __name__ == "__main__":
    unittest.main()
