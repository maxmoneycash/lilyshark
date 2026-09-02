import json
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

# Frozen from agent/ios6-chat-ui @ 2ae8e70. Main no longer carries this
# chrome (a15bd3e moved it off). The lab is the sketchbook; do not pin
# these against the terminal chat still in src/sim_main.cpp.
KIT_COLORS = {
    "Backdrop": 0xDBE4F1,
    "NavTop": 0x8BA7C7,
    "NavBottom": 0x31537C,
    "NavEdge": 0x2B486B,
    "BlueTop": 0xB9E3FF,
    "BlueBottom": 0x68B4F6,
    "BlueEdge": 0x5E95C9,
    "GrayTop": 0xFFFFFF,
    "GrayBottom": 0xD9D9D9,
    "GrayEdge": 0xB7B7B7,
    "BarTop": 0xCBD3DD,
    "BarBottom": 0x81909E,
    "BarEdge": 0x69717B,
    "InputTop": 0xE1E1E1,
    "InputBottom": 0xFFFFFF,
    "SendTop": 0x8FC2FF,
    "SendBottom": 0x1D58C4,
    "SendEdge": 0x3568BA,
    "ButtonTop": 0xFFFFFF,
    "ButtonBottom": 0xD9E0E8,
    "ButtonEdge": 0xA9B2BC,
    "ButtonInk": 0x506994,
    "Meta": 0x8C97A5,
    "Ink": 0x000000,
    "White": 0xFFFFFF,
}

KIT_LAYOUT = {
    "ChatTabY": 26,
    "ChatTabH": 16,
    "ChatRuleY": 44,
    "ChatOlderY": 3,
    "ChatOlderH": 18,
    "ChatOlderBtnX": 4,
    "ChatOlderBtnW": 50,
    "ChatNewerBtnX": 266,
    "ChatNewerBtnW": 50,
    "ChatMsgY": 46,
    "ChatMetaY": 168,
    "ChatSendX": 262,
    "ChatSendY": 186,
    "ChatSendW": 52,
    "ChatSendH": 30,
    "ChatBubblePad": 13,
    "ChatBubbleGap": 3,
    "ChatNameH": 11,
    "ChatDeliveredH": 10,
}

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

    def test_firmware_on_this_tree_is_the_terminal_chat(self):
        self.assertNotIn("kIos6Backdrop", self.sim)
        self.assertIn("agent/ios6-chat-ui", README.read_text(encoding="utf-8"))

    def test_palette_keeps_the_ios6_kit(self):
        lab = {name: int(value, 16) for name, value in JS_COLOR.findall(self.palette)}
        for name, value in KIT_COLORS.items():
            self.assertIn(name, lab, name)
            self.assertEqual(lab[name], value, name)

    def test_chat_layout_keeps_the_ios6_kit(self):
        lab = {name: int(value) for name, value in JS_LAYOUT.findall(self.palette)}
        for name, value in KIT_LAYOUT.items():
            self.assertEqual(lab[name], value, name)

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
        for name in ("palette.js", "kit.js", "compare.js", "screens.js", "lab.js"):
            self.assertIn("js/" + name, self.index)
        self.assertIn('id="panel"', self.index)
        self.assertIn('id="compare-mode"', self.index)
        self.assertIn('id="messages-chrome"', self.index)
        self.assertIn('width="320"', self.index)
        self.assertIn('height="240"', self.index)

    def test_nav_buttons_are_blue_glass(self):
        self.assertIn("function navButton", self.kit)
        self.assertIn("0xa9c4e0", self.kit)
        self.assertIn("function sectionHeader", self.kit)

    def test_messages_fit_three_content_sized_bubbles(self):
        self.assertIn("ChatBubbleGap", self.palette)
        self.assertIn("measureWidth", self.kit)
        self.assertIn("messagesVisible", self.lab)
        self.assertIn("everyoneBubbles", self.lab)
        self.assertIn('"Older"', self.screens)
        self.assertIn("anyone on LongFast", self.screens)
        self.assertGreaterEqual(self.screens.count("mine:"), 2)
        bubble = KIT_LAYOUT["ChatBubblePad"] + 12
        cursor = KIT_LAYOUT["ChatMetaY"] - 6
        painted = 0
        for header, delivered in (
            (0, KIT_LAYOUT["ChatDeliveredH"]),
            (KIT_LAYOUT["ChatNameH"], 0),
            (KIT_LAYOUT["ChatNameH"], 0),
        ):
            if cursor - bubble - header - delivered < KIT_LAYOUT["ChatMsgY"]:
                break
            cursor = cursor - delivered - bubble - header - KIT_LAYOUT["ChatBubbleGap"]
            painted += 1
        self.assertGreaterEqual(painted, 3)

    def test_messages_status_chrome_leaves_the_older_band(self):
        self.assertIn("function navStatusChrome", self.kit)
        self.assertIn("messagesStatusChrome", self.lab)
        self.assertIn("navStatusChrome", self.screens)
        self.assertEqual(KIT_LAYOUT["ChatOlderY"], 3)
        self.assertIn("ChatOlderY: 3", self.palette)

    def test_dock_paints_icon_reflections(self):
        self.assertIn("function dock", self.kit)
        self.assertIn("scale(1, -0.55)", self.kit)
        self.assertIn("iconLift", self.kit)

    def test_home_uses_linen_and_signal_bars(self):
        self.assertIn("function linen", self.kit)
        self.assertIn("function signalBars", self.kit)
        self.assertIn("function iconGloss", self.kit)
        self.assertIn("function battery", self.kit)

    def test_lock_has_a_camera_well(self):
        self.assertIn("cameraX", self.screens)
        self.assertIn('go("settings")', self.screens)
        self.assertIn("The camera well on the right opens Capture.", self.screens)

    def test_loop_file_keeps_the_agent_running(self):
        loop_path = REPO / "experiments/ios6/LOOP.json"
        self.assertTrue(loop_path.is_file(), loop_path)
        loop = json.loads(loop_path.read_text(encoding="utf-8"))
        self.assertIn("queue", loop)
        self.assertIn("done_when", loop)
        self.assertIn("hard_rules", loop)
        self.assertTrue(loop["hard_rules"], "hard_rules must tell the next agent not to wait")
        self.assertNotIn("src/sim_main.cpp", "".join(loop.get("queue", [])))

    def test_compare_is_a_pixel_diff_not_a_guess(self):
        compare = KIT.parent.joinpath("compare.js").read_text(encoding="utf-8")
        self.assertIn("countMismatch", compare)
        self.assertIn("onion", compare)
        readme = README.read_text(encoding="utf-8")
        self.assertIn("reference/chat.png", readme)
        self.assertIn("ios6-pixel-perfect-kit", readme)

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
