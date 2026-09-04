import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SYNC = REPO_ROOT / "scripts" / "sync_docs_to_webapp.py"
DEST = REPO_ROOT / "webapp" / "public" / "docs"

sys.path.insert(0, str(REPO_ROOT / "scripts"))
import sync_docs_to_webapp as sync  # noqa: E402


class DocsSyncTest(unittest.TestCase):
    """The docs on the website must be byte-identical to the repo docs."""

    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable, str(SYNC)], check=True, capture_output=True)

    def test_manifest_covers_every_doc(self):
        manifest = json.loads((DEST / "manifest.json").read_text())
        self.assertEqual(len(manifest), len(sync.DOCS))
        for entry, (src_rel, doc_id, dest_rel) in zip(manifest, sync.DOCS):
            self.assertEqual(entry["id"], doc_id)
            self.assertEqual(entry["path"], f"/docs/{dest_rel}")
            self.assertEqual(entry["source"], src_rel)
            self.assertTrue(entry["title"])

    def test_published_copies_match_sources_byte_for_byte(self):
        for src_rel, _doc_id, dest_rel in sync.DOCS:
            self.assertEqual(
                (REPO_ROOT / src_rel).read_bytes(),
                (DEST / dest_rel).read_bytes(),
                f"{dest_rel} is stale; run scripts/sync_docs_to_webapp.py",
            )

    def test_assets_are_published_and_readable(self):
        """Every published asset exists and really is the format its name claims.

        The set is no longer only charts: the hardware page embeds photos, so
        each type is checked by its own signature rather than assuming SVG.
        """
        for _src_rel, dest_rel in sync.ASSETS:
            dest = DEST / dest_rel
            self.assertTrue(dest.exists(), f"missing {dest_rel}")
            head = dest.read_bytes()[:300]
            if dest_rel.endswith(".svg"):
                self.assertIn(b"<svg", head, f"{dest_rel} is not an SVG")
            elif dest_rel.endswith(".png"):
                self.assertTrue(head.startswith(b"\x89PNG\r\n"), f"{dest_rel} is not a PNG")
            else:
                self.fail(f"{dest_rel}: no signature check for this asset type")
            self.assertEqual(
                (REPO_ROOT / _src_rel).read_bytes(),
                dest.read_bytes(),
                f"{dest_rel} is stale; run scripts/sync_docs_to_webapp.py",
            )

    def test_titles_come_from_headings(self):
        manifest = {e["id"]: e for e in json.loads((DEST / "manifest.json").read_text())}
        self.assertIn("Quickstart", manifest["quickstart"]["title"])
        self.assertIn("Shelby", manifest["why-shelby"]["title"])


if __name__ == "__main__":
    unittest.main()


class DocsIndexTest(unittest.TestCase):
    """docs/README.md must list every document in docs/.

    The index had drifted to listing eight of eighteen files, plus neither of
    the two subdirectories. That is worse than having no index: a page that
    presents itself as a table of contents is read as complete, so the nine
    unlisted documents were effectively invisible rather than merely
    unindexed. Nothing catches that by itself -- a new file is simply never
    mentioned -- so this does.
    """

    INDEX = REPO_ROOT / "docs" / "README.md"

    def test_every_markdown_document_is_named_in_the_index(self):
        index_text = self.INDEX.read_text(encoding="utf-8")
        missing = []
        for path in sorted((REPO_ROOT / "docs").rglob("*.md")):
            if path == self.INDEX:
                continue
            relative = path.relative_to(REPO_ROOT / "docs")
            # Named anywhere on the page: as a link, or in the closing list.
            # Either counts -- the point is that a reader can find out it
            # exists, not that it appears in a particular table.
            if str(relative) not in index_text and path.name not in index_text:
                missing.append(str(relative))
        self.assertEqual(
            missing,
            [],
            "docs/README.md does not mention these files; add a row for each:\n  "
            + "\n  ".join(missing),
        )

    def test_every_link_in_the_index_resolves(self):
        import re

        index_text = self.INDEX.read_text(encoding="utf-8")
        broken = []
        for target in re.findall(r"\]\(([^)#]+\.md)\)", index_text):
            if target.startswith(("http://", "https://")):
                continue
            if not (self.INDEX.parent / target).resolve().exists():
                broken.append(target)
        self.assertEqual(broken, [], f"dead links in docs/README.md: {broken}")


class DiagramSourceTest(unittest.TestCase):
    """A rendered diagram must have a source in the repo.

    The HTML is committed so a reader needs no toolchain, which also means it
    can outlive the source it came from. A rendered file with nothing to
    regenerate it from is not documentation, it is a picture.
    """

    def test_each_rendered_diagram_has_a_source(self):
        rendered = REPO_ROOT / "webapp" / "public" / "docs" / "diagrams"
        sources = REPO_ROOT / "docs" / "diagrams"
        if not rendered.exists():
            self.skipTest("no diagrams rendered yet")
        orphans = []
        for html in sorted(rendered.glob("*.html")):
            # "lilyshark-architecture.html" -> "lilyshark.architecture.json"
            stem, _, kind = html.stem.rpartition("-")
            if not (sources / f"{stem}.{kind}.json").exists():
                orphans.append(html.name)
        self.assertEqual(
            orphans, [], f"rendered with no source in docs/diagrams/: {orphans}"
        )
