import re
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
SIM = REPO / "src/sim_main.cpp"
THEME = REPO / "include/theme.h"
PALETTE = REPO / "experiments/ios6/js/palette.js"
KIT = REPO / "experiments/ios6/js/kit.js"
SCREENS = REPO / "experiments/ios6/js/screens.js"
LAB = REPO / "experiments/ios6/js/lab.js"
INDEX = REPO / "experiments/ios6/index.html"
README = REPO / "experiments/ios6/README.md"

IOS6_CPP = re.compile(r"constexpr std::uint32_t kIos6(\w+) = 0x([0-9a-fA-F]+);")
CHAT_CPP = re.compile(r"constexpr lv_coord_t k(Chat\w+) = (-?\d+);")
JS_COLOR = re.compile(r"(\w+):\s*0x([0-9a-fA-F]+)")
JS_LAYOUT = re.compile(r"(Chat\w+|SCREEN_WIDTH|SCREEN_HEIGHT|StatusH|NavH|DockH):\s*(-?\d+)")
JS_WIDTH = re.compile(r"Ios6\.SCREEN_WIDTH = (\d+);")
JS_HEIGHT = re.compile(r"Ios6\.SCREEN_HEIGHT = (\d+);")
SCREEN_ORDER = re.compile(
    r"Ios6\.SCREEN_ORDER = \[(.*?)\]",
    re.DOTALL,
)
SCREEN_ID = re.compile(r'id:\s*"([a-z]+)"')


def rgb565(red, green, blue):
    return ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3)


def from565(packed):
    red = round(((packed >> 11) & 31) * 255 / 31)
    green = round(((packed >> 5) & 63) * 255 / 63)
    blue = round((packed & 31) * 255 / 31)
    return red, green, blue


class Ios6LabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sim = SIM.read_text(encoding="utf-8")
        cls.theme = THEME.read_text(encoding="utf-8")
        cls.palette = PALETTE.read_text(encoding="utf-8")
        cls.kit = KIT.read_text(encoding="utf-8")
        cls.screens = SCREENS.read_text(encoding="utf-8")
        cls.lab = LAB.read_text(encoding="utf-8")
        cls.index = INDEX.read_text(encoding="utf-8")

    def test_lab_files_are_present(self):
        for path in (PALETTE, KIT, SCREENS, LAB, INDEX, README):
            self.assertTrue(path.is_file(), path)

    def test_panel_size_matches_theme_and_touch(self):
        self.assertIn("screen_width = 320", self.theme)
        self.assertIn("screen_height = 240", self.theme)
        self.assertEqual(JS_WIDTH.search(self.palette).group(1), "320")
        self.assertEqual(JS_HEIGHT.search(self.palette).group(1), "240")
        touch = (REPO / "include/lilyshark/device/touch.h").read_text(encoding="utf-8")
        self.assertIn("kTDeckTouchWidth = 320", touch)
        self.assertIn("kTDeckTouchHeight = 240", touch)

    def test_ios6_colors_match_firmware(self):
        firmware = {name: int(value, 16) for name, value in IOS6_CPP.findall(self.sim)}
        lab = {name: int(value, 16) for name, value in JS_COLOR.findall(self.palette)}
        self.assertGreaterEqual(len(firmware), 20)
        missing = [name for name in firmware if name not in lab]
        self.assertEqual(missing, [])
        for name, value in firmware.items():
            self.assertEqual(lab[name], value, name)

    def test_chat_layout_matches_firmware(self):
        firmware = {name: int(value) for name, value in CHAT_CPP.findall(self.sim)}
        lab = {name: int(value) for name, value in JS_LAYOUT.findall(self.palette)}
        needed = (
            "ChatTabY",
            "ChatTabH",
            "ChatRuleY",
            "ChatOlderY",
            "ChatOlderH",
            "ChatOlderBtnX",
            "ChatOlderBtnW",
            "ChatNewerBtnX",
            "ChatNewerBtnW",
            "ChatMsgY",
            "ChatMetaY",
            "ChatSendX",
            "ChatSendY",
            "ChatSendW",
            "ChatSendH",
        )
        for name in needed:
            self.assertIn(name, firmware, name)
            self.assertEqual(lab[name], firmware[name], name)

    def test_screen_order_matches_registered_screens(self):
        order = [
            token.strip().strip('"')
            for token in SCREEN_ORDER.search(self.palette).group(1).split(",")
            if token.strip()
        ]
        registered = SCREEN_ID.findall(self.screens)
        self.assertEqual(order, registered)
        self.assertEqual(
            order,
            ["lock", "home", "field", "messages", "nodes", "radio", "settings", "kit"],
        )

    def test_index_loads_the_lab_scripts(self):
        for name in ("palette.js", "kit.js", "screens.js", "lab.js"):
            self.assertIn("js/" + name, self.index)
        self.assertIn('id="panel"', self.index)
        self.assertIn('width="320"', self.index)
        self.assertIn('height="240"', self.index)

    def test_rgb565_matches_the_kit(self):
        self.assertIn("((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)", self.kit)
        lily = rgb565(0xFF, 0x4F, 0x9D)
        self.assertEqual(lily, 0xFA73)
        self.assertEqual(from565(lily), (255, 77, 156))
        white = rgb565(255, 255, 255)
        self.assertEqual(white, 0xFFFF)
        self.assertEqual(from565(white), (255, 255, 255))
        black = rgb565(0, 0, 0)
        self.assertEqual(black, 0)
        self.assertEqual(from565(black), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
