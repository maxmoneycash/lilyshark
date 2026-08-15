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

    def test_chart_assets_are_published(self):
        for _src_rel, dest_rel in sync.ASSETS:
            dest = DEST / dest_rel
            self.assertTrue(dest.exists(), f"missing {dest_rel}")
            self.assertIn("<svg", dest.read_text()[:300])

    def test_titles_come_from_headings(self):
        manifest = {e["id"]: e for e in json.loads((DEST / "manifest.json").read_text())}
        self.assertIn("Quickstart", manifest["quickstart"]["title"])
        self.assertIn("Shelby", manifest["why-shelby"]["title"])


if __name__ == "__main__":
    unittest.main()
