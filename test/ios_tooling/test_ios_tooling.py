"""Regression checks for the source-registration and icon checks used by CI."""
import importlib.util
from io import BytesIO
from pathlib import Path
import unittest
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[2]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

source = load("add_ios_source")
icon = load("generate_app_icon")

class SourceMembershipTests(unittest.TestCase):
    def project(self, path="Example.swift", tree='"<group>"', sources=True):
        build_id = "BUILD0000000000000000001"
        file_id = "FILE00000000000000000001"
        group_id = "GROUP0000000000000000001"
        phase_id = "PHASE0000000000000000001"
        return f'''{file_id} /* Example.swift */ = {{isa = PBXFileReference; path = "{path}"; sourceTree = {tree}; }};
{build_id} /* Example.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {file_id} /* Example.swift */; }};
{group_id} /* App */ = {{isa = PBXGroup; children = ({file_id} /* Example.swift */,); path = Shared/App; sourceTree = "<group>"; }};
{phase_id} /* Sources */ = {{isa = PBXSourcesBuildPhase; files = ({build_id + " /* Example.swift in Sources */," if sources else ""}); }};'''

    def test_group_path_cannot_certify_a_file_in_another_directory(self):
        paths = source.compiled_swift_paths(self.project(), ROOT / "ios")
        self.assertIn(ROOT / "ios/Shared/App/Example.swift", paths)
        self.assertNotIn(ROOT / "ios/Shared/Views/Example.swift", paths)

    def test_source_root_reference_ignores_visual_group(self):
        paths = source.compiled_swift_paths(self.project("Shared/Views/Example.swift", "SOURCE_ROOT"), ROOT / "ios")
        self.assertIn(ROOT / "ios/Shared/Views/Example.swift", paths)

    def test_file_reference_without_build_phase_is_not_compiled(self):
        self.assertEqual(source.compiled_swift_paths(self.project(sources=False), ROOT / "ios"), set())

class IconPixelsTests(unittest.TestCase):
    def png(self, image, optimize=False, metadata=False):
        output = BytesIO()
        info = PngImagePlugin.PngInfo()
        if metadata:
            info.add_text("description", "Losslessly optimized")
        image.save(output, format="PNG", optimize=optimize, pnginfo=info)
        return output.getvalue()

    def test_lossless_optimization_keeps_the_artwork(self):
        image = Image.new("RGB", (16, 16), "pink")
        original = self.png(image)
        optimized = self.png(image, optimize=True, metadata=True)
        self.assertNotEqual(original, optimized)
        self.assertTrue(icon.same_pixels(original, optimized))

    def test_one_changed_pixel_is_a_real_mismatch(self):
        image = Image.new("RGB", (16, 16), "pink")
        original = self.png(image)
        image.putpixel((7, 9), (0, 0, 0))
        self.assertFalse(icon.same_pixels(original, self.png(image)))

    def test_transparency_is_a_real_mismatch(self):
        image = Image.new("RGBA", (16, 16), (255, 0, 0, 255))
        original = self.png(image)
        image.putpixel((0, 0), (255, 0, 0, 0))
        self.assertFalse(icon.same_pixels(original, self.png(image)))

if __name__ == "__main__":
    unittest.main()
