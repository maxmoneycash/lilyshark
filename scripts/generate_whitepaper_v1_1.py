#!/usr/bin/env python3
"""
generate_whitepaper_v1_1.py

Updates lilyshark-whitepaper.pdf to v1.1 by:
1. Updating Page 1 metadata: VERSION 1.1, DATE 2026-09-24, PAGES 64, PAGE 1 OF 64.
2. Updating running headers/footers on Pages 1-63: PAGE X OF 63 -> PAGE X OF 64.
3. Appending Page 64: §51 Related Networks (Appendix), folding in docs/related-networks.md.
4. Regenerating webapp/public/paper/page-*.webp for all 64 pages at 1400x1812.
"""

import os
import sys
import pymupdf
from PIL import Image

def generate_whitepaper(repo_root: str, pages_to_render=None):
    pdf_path = os.path.join(repo_root, "webapp/public/lilyshark-whitepaper.pdf")
    doc = pymupdf.open(pdf_path)
    print(f"Loaded {pdf_path}: {len(doc)} pages")

    # Colors
    PINK_BANNER = (1.0, 0.8, 0.9)        # rgb(255, 204, 230)
    PINK_ACCENT = (1.0, 0.31, 0.616)     # rgb(255, 79, 157)
    GREY_RULE = (0.721569, 0.721569, 0.721569)
    BLACK = (0.0, 0.0, 0.0)
    WHITE = (1.0, 1.0, 1.0)
    DARK_TEXT = (0.1, 0.1, 0.1)

    # 1. Update Page 1
    p1 = doc[0]

    # White out VERSION "1.0"
    p1.draw_rect(pymupdf.Rect(185.0, 476.0, 215.0, 490.0), color=WHITE, fill=WHITE)
    p1.insert_text(pymupdf.Point(185.48, 486.24), "1.1", fontname="cour", fontsize=8.4, color=BLACK)

    # White out DATE "2026-08-07"
    p1.draw_rect(pymupdf.Rect(310.0, 476.0, 375.0, 490.0), color=WHITE, fill=WHITE)
    p1.insert_text(pymupdf.Point(312.38, 486.24), "2026-09-24", fontname="cour", fontsize=8.4, color=BLACK)

    # White out PAGES "63"
    p1.draw_rect(pymupdf.Rect(437.0, 475.0, 465.0, 492.0), color=WHITE, fill=WHITE)
    p1.insert_text(pymupdf.Point(439.27, 487.32), "64", fontname="hebo", fontsize=9.0, color=(0.1, 0.1, 0.1))

    # White out top running header "PAGE 1 OF 63"
    p1.draw_rect(pymupdf.Rect(495.0, 27.0, 565.0, 40.0), color=WHITE, fill=WHITE)
    p1.insert_text(pymupdf.Point(497.22, 35.83), "PAGE 1 OF 64", fontname="helv", fontsize=7.5, color=(0.2, 0.2, 0.2))

    # White out bottom running footer "PAGE 1 OF 63"
    p1.draw_rect(pymupdf.Rect(495.0, 750.0, 565.0, 765.0), color=WHITE, fill=WHITE)
    p1.insert_text(pymupdf.Point(497.22, 759.50), "PAGE 1 OF 64", fontname="helv", fontsize=7.5, color=(0.2, 0.2, 0.2))

    # Update contents line 7
    p1.draw_rect(pymupdf.Rect(51.84, 719.0, 480.0, 743.0), color=WHITE, fill=WHITE)
    p1.insert_text(pymupdf.Point(71.42, 733.33), "39–51", fontname="cour", fontsize=7.2, color=BLACK)
    p1.insert_text(pymupdf.Point(102.09, 728.21), "Bridges, prior attempts, trajectory, conclusion and", fontname="cour", fontsize=7.2, color=BLACK)
    p1.insert_text(pymupdf.Point(102.09, 738.44), "references; related-networks appendix", fontname="cour", fontsize=7.2, color=BLACK)
    p1.insert_text(pymupdf.Point(409.73, 733.30), "52", fontname="cour", fontsize=7.2, color=BLACK)
    p1.insert_text(pymupdf.Point(427.41, 733.33), "Tab. 42–46", fontname="cour", fontsize=7.2, color=BLACK)

    # 2. Update Pages 2 through 63 running headers/footers
    for page_idx in range(1, 63):
        p = doc[page_idx]
        page_num = page_idx + 1
        # Top right header: "PAGE X OF 64"
        p.draw_rect(pymupdf.Rect(490.0, 27.0, 565.0, 40.0), color=WHITE, fill=WHITE)
        p.insert_text(pymupdf.Point(497.22, 35.83), f"PAGE {page_num} OF 64", fontname="helv", fontsize=7.5, color=(0.2, 0.2, 0.2))

        # Bottom right footer: "PAGE X OF 64"
        p.draw_rect(pymupdf.Rect(490.0, 750.0, 565.0, 765.0), color=WHITE, fill=WHITE)
        p.insert_text(pymupdf.Point(497.22, 759.50), f"PAGE {page_num} OF 64", fontname="helv", fontsize=7.5, color=(0.2, 0.2, 0.2))

    # 3. Create or replace Page 64
    if len(doc) == 63:
        p64 = doc.new_page(width=612.0, height=792.0)
    else:
        p64 = doc[63]
        # Clear page 64
        p64.draw_rect(pymupdf.Rect(0, 0, 612, 792), color=WHITE, fill=WHITE)

    # Background
    p64.draw_rect(pymupdf.Rect(0.0, 0.0, 612.0, 792.0), color=WHITE, fill=WHITE)

    # Top pink banner
    p64.draw_rect(pymupdf.Rect(0.0, 0.0, 612.0, 21.212), color=None, fill=PINK_BANNER)
    # Centered banner text
    banner_text = "THE  GROWTH  TRAP  IN  PROOF  OF  PHYSICAL  WORK"
    banner_w = pymupdf.get_text_length(banner_text, fontname="hebo", fontsize=7.5)
    p64.insert_text(pymupdf.Point((612.0 - banner_w) / 2, 14.5), banner_text, fontname="hebo", fontsize=7.5, color=BLACK)

    # Running header
    p64.insert_text(pymupdf.Point(51.84, 35.83), "§51 · RELATED NETWORKS", fontname="hebo", fontsize=7.5, color=(0.2, 0.2, 0.2))
    p64.insert_text(pymupdf.Point(240.0, 35.83), "PART V · FALSIFIERS AND METHOD", fontname="hebo", fontsize=7.5, color=BLACK)
    p64.insert_text(pymupdf.Point(497.22, 35.83), "PAGE 64 OF 64", fontname="helv", fontsize=7.5, color=(0.2, 0.2, 0.2))
    p64.draw_line(pymupdf.Point(51.84, 47.274), pymupdf.Point(560.16, 47.274), color=GREY_RULE, width=0.5)

    # Section badge
    badge_rect = pymupdf.Rect(51.84, 64.0, 78.0, 78.0)
    p64.draw_rect(badge_rect, color=BLACK, fill=BLACK)
    badge_num_w = pymupdf.get_text_length("51", fontname="hebo", fontsize=10.0)
    p64.insert_text(pymupdf.Point(51.84 + (78.0 - 51.84 - badge_num_w)/2, 74.5), "51", fontname="hebo", fontsize=10.0, color=WHITE)

    # Section title
    p64.insert_text(pymupdf.Point(86.0, 75.0), "Related networks", fontname="hebo", fontsize=15.0, color=BLACK)

    # Subtitle right-aligned
    subtitle = "OVERLAY NETWORKS AND PHYSICAL SCOPE"
    sub_w = pymupdf.get_text_length(subtitle, fontname="helv", fontsize=7.5)
    p64.insert_text(pymupdf.Point(560.16 - sub_w, 75.0), subtitle, fontname="helv", fontsize=7.5, color=(0.3, 0.3, 0.3))

    # Divider line under title
    p64.draw_line(pymupdf.Point(51.84, 84.0), pymupdf.Point(560.16, 84.0), color=BLACK, width=1.0)

    # Section 1: Scope Rule
    cur_y = 96.0
    p64.insert_text(pymupdf.Point(51.84, cur_y), "THE SCOPE RULE", fontname="hebo", fontsize=8.0, color=BLACK)
    cur_y += 12.0

    scope_text = (
        "Every load-bearing measurement in this paper -- R = 7.36 rebroadcasts per delivered message, reach collapse from "
        "68.6% to 25.8% as nodes are added, the 6,721-node transit saturation ceiling, and the airtime cost of on-chain "
        "settlement -- is a consequence of shared radio spectrum: one collision domain, finite airtime, and transmit power "
        "as a regulated physical resource. Proof-of-physical-work economics exist because the physical layer is scarce "
        "and locally verifiable against physics.\n\n"
        "An overlay network running over the commercial internet inherits the internet's physical layer. Its scarce resource "
        "is trust, topology, or storage -- not spectrum or airtime. That is a distinct and adjacent economics problem, outside "
        "the scope of a paper analyzing what a shared LoRa channel can carry."
    )
    rect_scope = pymupdf.Rect(51.84, cur_y, 560.16, cur_y + 72.0)
    p64.insert_textbox(rect_scope, scope_text, fontname="times-roman", fontsize=8.2, color=DARK_TEXT)
    cur_y += 88.0

    # Section 2: Table of networks
    p64.insert_text(pymupdf.Point(51.84, cur_y), "THE NETWORKS PEOPLE ASK ABOUT", fontname="hebo", fontsize=8.0, color=BLACK)
    cur_y += 12.0

    # Table layout
    table_top = cur_y
    col_x = [51.84, 130.0, 205.0, 350.0, 560.16]
    headers = ["NETWORK", "LAYER", "WHY OUTSIDE THE EVIDENCE", "CONTRIBUTION TO THE THESIS"]

    # Header background
    p64.draw_rect(pymupdf.Rect(col_x[0], table_top, col_x[-1], table_top + 14.0), color=None, fill=(0.94, 0.94, 0.94))
    p64.draw_line(pymupdf.Point(col_x[0], table_top), pymupdf.Point(col_x[-1], table_top), color=BLACK, width=0.75)
    p64.draw_line(pymupdf.Point(col_x[0], table_top + 14.0), pymupdf.Point(col_x[-1], table_top + 14.0), color=BLACK, width=0.75)

    for i, h in enumerate(headers):
        p64.insert_text(pymupdf.Point(col_x[i] + 3.0, table_top + 10.0), h, fontname="hebo", fontsize=6.8, color=BLACK)

    cur_y = table_top + 14.0

    entries = [
        (
            "Freenet (2023)",
            "P2P app platform\n(Internet overlay)",
            "No radio, no airtime constraints, no physical-work proof. Peer discovery end-to-end over IP.",
            "Shares small-world / greedy routing over keyspace with Reticulum; key routing prior art (§13)."
        ),
        (
            "Hyphanet (orig.)",
            "Distributed datastore\n(Internet overlay)",
            "Censorship-resistant storage over internet. No spectrum or radio layer to analyze.",
            "Twenty-year survival without a token provides empirical evidence for tokenless incentives (§20)."
        ),
        (
            "I2P / Tor",
            "Anonymity overlay\n(Internet routing)",
            "Anonymity economics, not physical spectrum capacity or wireless transit.",
            "Establishes baselines for routing privacy and Sybil-resistant topology; orthogonal to radio."
        ),
        (
            "Yggdrasil",
            "Encrypted IPv6 mesh\n(Overlay / Any link)",
            "Runs over arbitrary existing links; routing scheme rather than a radio network.",
            "Candidate routing layer for radio meshes; closest to in-scope of all candidate overlays."
        ),
        (
            "Veilid",
            "P2P app framework\n(cDc overlay)",
            "App-layer framework over standard IP; same structural profile as Freenet rewrite.",
            "Parallel state model and cryptographic identity; subject to internet transport assumptions."
        ),
        (
            "NNCP",
            "Delay-tolerant relay\n(Transport-agnostic)",
            "Store-and-forward batch messaging; no economics layer to analyze.",
            "Philosophically aligned with the pointer/resolve design (Lilyshark off-grid loop is delay-tolerant)."
        ),
        (
            "Nostr",
            "Signed-note protocol\n(App / WebSockets)",
            "Relay-based note distribution over internet; no physical work to verify.",
            "Relay economics rhyme with gateway compensation; lacks physical observation verification."
        )
    ]

    row_height = 27.5
    for idx, (net, layer, why, contrib) in enumerate(entries):
        row_bg = (0.98, 0.98, 0.98) if idx % 2 == 1 else WHITE
        p64.draw_rect(pymupdf.Rect(col_x[0], cur_y, col_x[-1], cur_y + row_height), color=None, fill=row_bg)

        # Network name
        p64.insert_text(pymupdf.Point(col_x[0] + 3.0, cur_y + 11.0), net, fontname="hebo", fontsize=7.2, color=BLACK)

        # Layer
        rect_layer = pymupdf.Rect(col_x[1] + 2.0, cur_y + 2.0, col_x[2] - 2.0, cur_y + row_height - 1.0)
        p64.insert_textbox(rect_layer, layer, fontname="helv", fontsize=6.5, color=(0.2, 0.2, 0.2))

        # Why outside
        rect_why = pymupdf.Rect(col_x[2] + 3.0, cur_y + 2.0, col_x[3] - 2.0, cur_y + row_height - 1.0)
        p64.insert_textbox(rect_why, why, fontname="times-roman", fontsize=6.8, color=DARK_TEXT)

        # Contribution
        rect_contrib = pymupdf.Rect(col_x[3] + 3.0, cur_y + 2.0, col_x[4] - 2.0, cur_y + row_height - 1.0)
        p64.insert_textbox(rect_contrib, contrib, fontname="times-roman", fontsize=6.8, color=DARK_TEXT)

        cur_y += row_height
        p64.draw_line(pymupdf.Point(col_x[0], cur_y), pymupdf.Point(col_x[-1], cur_y), color=(0.88, 0.88, 0.88), width=0.5)

    p64.draw_line(pymupdf.Point(col_x[0], cur_y), pymupdf.Point(col_x[-1], cur_y), color=BLACK, width=0.75)
    cur_y += 12.0

    # Section 3: Hybrid Case
    p64.insert_text(pymupdf.Point(51.84, cur_y), "THE INTERESTING HYBRID, HONESTLY STATED", fontname="hebo", fontsize=8.0, color=BLACK)
    cur_y += 12.0

    hybrid_text = (
        "The open architectural question these networks raise is whether overlay protocols can run over mesh radio transports. "
        "Reticulum is transport-agnostic today (5 bps to gigabit); Freenet's contract model or Yggdrasil's routing could in "
        "principle ride LoRa links just as Reticulum does. If an overlay protocol is deployed over radio, the paper's airtime "
        "arithmetic applies to it immediately: a Freenet contract update or Yggdrasil route announcement competing for a ~200-byte "
        "LoRa payload budget faces the identical R = 7.36 flood tax measured in §29."
    )
    rect_hybrid = pymupdf.Rect(51.84, cur_y, 560.16, cur_y + 60.0)
    p64.insert_textbox(rect_hybrid, hybrid_text, fontname="times-roman", fontsize=8.0, color=DARK_TEXT)
    cur_y += 66.0

    # Section 4: The One Sentence callout box
    box_rect = pymupdf.Rect(51.84, cur_y, 560.16, cur_y + 50.0)
    p64.draw_rect(box_rect, color=BLACK, fill=WHITE, width=0.5)
    # Pink left border
    p64.draw_rect(pymupdf.Rect(51.84, cur_y, 55.34, cur_y + 50.0), color=PINK_ACCENT, fill=PINK_ACCENT)

    # Callout title
    p64.insert_text(pymupdf.Point(62.0, cur_y + 13.0), "THE ONE SENTENCE", fontname="hebo", fontsize=7.2, color=PINK_ACCENT)

    # Callout text
    one_sentence = (
        "Overlays solve trust over infinite wires; meshes solve reach over finite air. "
        "Conflating the two produces tokens that pay for internet bandwidth while claiming to build radio infrastructure."
    )
    rect_callout = pymupdf.Rect(62.0, cur_y + 18.0, 552.0, cur_y + 46.0)
    p64.insert_textbox(rect_callout, one_sentence, fontname="hebo", fontsize=8.2, color=BLACK)

    # Running footer
    p64.draw_line(pymupdf.Point(51.84, 744.726), pymupdf.Point(560.16, 744.726), color=GREY_RULE, width=0.5)
    p64.insert_text(pymupdf.Point(51.84, 759.50), "§51 · RELATED NETWORKS", fontname="hebo", fontsize=7.5, color=(0.2, 0.2, 0.2))
    p64.insert_text(pymupdf.Point(238.22, 759.50), "LILYSHARK MESH RADIO RESEARCH", fontname="hebo", fontsize=7.5, color=PINK_ACCENT)
    p64.insert_text(pymupdf.Point(497.22, 759.50), "PAGE 64 OF 64", fontname="helv", fontsize=7.5, color=(0.2, 0.2, 0.2))

    # Bottom pink banner
    p64.draw_rect(pymupdf.Rect(0.0, 770.788, 612.0, 792.0), color=None, fill=PINK_BANNER)
    p64.insert_text(pymupdf.Point((612.0 - banner_w) / 2, 784.0), banner_text, fontname="hebo", fontsize=7.5, color=BLACK)

    # Save PDF
    import shutil
    out_pdf = os.path.join(repo_root, "webapp/public/lilyshark-whitepaper.pdf")
    tmp_pdf = os.path.join(repo_root, "webapp/public/lilyshark-whitepaper.tmp.pdf")
    doc.save(tmp_pdf, deflate=True)
    shutil.move(tmp_pdf, out_pdf)
    print(f"Saved updated PDF with {len(doc)} pages to {out_pdf}")

    # Copy to webapp/dist if dist exists
    dist_pdf = os.path.join(repo_root, "webapp/dist/lilyshark-whitepaper.pdf")
    if os.path.exists(os.path.dirname(dist_pdf)):
        shutil.copyfile(out_pdf, dist_pdf)
        print(f"Copied to {dist_pdf}")

    # Render all 64 pages to WebP
    paper_dir = os.path.join(repo_root, "webapp/public/paper")
    os.makedirs(paper_dir, exist_ok=True)
    print(f"Rendering all {len(doc)} pages to WebP in {paper_dir}...")

    scale = 1400.0 / 612.0 # 2.287581699...
    matrix = pymupdf.Matrix(scale, scale)

    for i, page in enumerate(doc):
        page_num = i + 1
        if pages_to_render and page_num not in pages_to_render:
            continue
        webp_path = os.path.join(paper_dir, f"page-{page_num:03d}.webp")
        pix = page.get_pixmap(matrix=matrix)
        # Convert pixmap to PIL Image and save WebP
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img.save(webp_path, "WEBP", quality=88)
        if page_num % 10 == 0 or page_num == len(doc) or pages_to_render:
            print(f"  Rendered page {page_num}/{len(doc)} ({pix.width}x{pix.height})")

    print("Complete!")

def check_whitepaper(repo_root: str) -> bool:
    pdf_path = os.path.join(repo_root, "webapp/public/lilyshark-whitepaper.pdf")
    if not os.path.exists(pdf_path):
        print(f"Error: PDF not found: {pdf_path}")
        return False
    doc = pymupdf.open(pdf_path)
    if len(doc) != 64:
        print(f"Error: expected 64 pages, got {len(doc)}")
        return False

    # Check Page 1
    p1_text = doc[0].get_text()
    for needle in ["1.1", "2026-09-24", "64"]:
        if needle not in p1_text:
            print(f"Error: expected '{needle}' on Page 1")
            return False

    # Check Page 64
    p64_text = doc[63].get_text()
    for needle in [
        "Related networks",
        "THE SCOPE RULE",
        "THE NETWORKS PEOPLE ASK ABOUT",
        "THE INTERESTING HYBRID",
        "THE ONE SENTENCE",
        "Freenet",
        "Hyphanet",
        "I2P",
        "Yggdrasil",
        "Veilid",
        "NNCP",
        "Nostr"
    ]:
        if needle not in p64_text:
            print(f"Error: expected '{needle}' on Page 64")
            return False

    # Check all 64 WebP renders exist
    paper_dir = os.path.join(repo_root, "webapp/public/paper")
    for page_num in range(1, 65):
        webp = os.path.join(paper_dir, f"page-{page_num:03d}.webp")
        if not os.path.exists(webp) or os.path.getsize(webp) == 0:
            print(f"Error: missing or empty WebP render: {webp}")
            return False

    # Check WhitepaperTab.tsx has PAGES = 64
    tab_tsx = os.path.join(repo_root, "webapp/src/components/WhitepaperTab.tsx")
    with open(tab_tsx, "r", encoding="utf-8") as f:
        content = f.read()
        if "const PAGES = 64;" not in content:
            print("Error: WhitepaperTab.tsx does not specify PAGES = 64")
            return False

    print("Whitepaper v1.1 check passed (64 pages, all renders present, metadata verified).")
    return True

if __name__ == "__main__":
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        if not check_whitepaper(repo_root):
            sys.exit(1)
        sys.exit(0)
    only_pages = None
    for arg in sys.argv[1:]:
        if arg.startswith("--only="):
            only_pages = [int(p) for p in arg.split("=")[1].split(",")]
    generate_whitepaper(repo_root, pages_to_render=only_pages)
