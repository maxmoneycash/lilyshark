import { useRef, useState } from "react";

/**
 * Browser flasher for the T-Deck family. The esp-web-tools element is loaded
 * by flash/index.html from /flash/install-button.js; the firmware image,
 * manifest, fonts, and hero photo stay as static files under public/flash/.
 *
 * The version/size/hash below describe the exact binary this page serves.
 * They are updated by hand today — if the image in public/flash/ changes,
 * change all three together (scripts/build_release.sh is the right home for
 * automating that).
 */
const FIRMWARE = {
  version: "v0.1.0-alpha.8",
  file: "lilyshark-tdeck.factory.bin",
  bytes: "1,000,080",
  offset: "0x0",
  sha256: "ad7e833f85ae1d94a43b55157d4b8d641b4740a1dbd82fc66e391dd898cb68eb",
  manifest: "/flash/manifest.json",
};

/** Original line-art of the T-Deck family: body, screen, keyboard, GPS bump. */
function DeckIcon({ gps }: { gps: boolean }) {
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="10" y="6" width="100" height="68" rx="9" />
      <rect x="20" y="16" width="58" height="28" rx="3" />
      {gps ? <circle cx="92" cy="22" r="5" /> : null}
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((col) => (
          <circle
            key={`${row}-${col}`}
            cx={24 + col * 8}
            cy={54 + row * 7}
            r="1.8"
            fill="currentColor"
            stroke="none"
          />
        )),
      )}
    </svg>
  );
}

/** Small original glyphs for the step circles and buttons. */
const Glyph = {
  download: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5" />
      <path d="M4 15.5h12" />
    </svg>
  ),
  usb: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6.5" y="2.5" width="7" height="6" rx="1.5" />
      <path d="M10 8.5v6m0 0l-3-2.2m3 2.2l3-2.2" />
      <circle cx="10" cy="17" r="1.4" />
    </svg>
  ),
  bolt: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2.5L4.5 11H9l-1 6.5L14.5 9H10l1-6.5z" />
    </svg>
  ),
  copy: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10h1.5" />
    </svg>
  ),
  code: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
    </svg>
  ),
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${copied ? "copied" : ""}`}
      title={copied ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable — the command text stays selectable */
        }
      }}
    >
      {copied ? "✓" : Glyph.copy}
    </button>
  );
}

const DEVICES = [
  {
    id: "tdeck-plus",
    name: "T-Deck Plus",
    chip: "ESP32-S3 · SX1262 · GPS",
    gps: true,
    heading: "Lilyshark for T-Deck Plus.",
    tagline:
      "LILYGO's pocket computer with a GPS on board — the full analyzer, with a fix for the nodes map.",
  },
  {
    id: "tdeck",
    name: "T-Deck",
    chip: "ESP32-S3 · SX1262",
    gps: false,
    heading: "Lilyshark for T-Deck.",
    tagline:
      "The same image on the original board. Every radio and capture tool works; only the GPS fix is absent.",
  },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

const CHECKLIST = [
  "Live LoRa traffic feed",
  "Packet inspector, raw bytes included",
  "Spectrum scan and band surveys",
  "Node tracking with signal history",
  "Capture to microSD — .lscap and PCAP",
  "No account, no cloud, works offline",
  "Open source, GPL-3.0",
];

const STEPS = [
  { glyph: Glyph.download, name: "Pick a build", hint: "the image below is the current alpha" },
  { glyph: Glyph.usb, name: "Connect USB", hint: "data cable, device powered on" },
  { glyph: Glyph.bolt, name: "Flash", hint: "one click, about a minute" },
];

export function FlashPage() {
  const [device, setDevice] = useState<DeviceId>("tdeck-plus");
  const ctaRef = useRef<HTMLDivElement>(null);
  const selected = DEVICES.find((d) => d.id === device) ?? DEVICES[0];

  const pick = (id: DeviceId) => {
    setDevice(id);
    ctaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="flash-page">
      <div className="topbar">
        <div className="brand">
          <a href="/">◊ LILYSHARK</a>
        </div>
        <nav className="toplinks">
          <a href="/">Analyzer</a>
          <a href="https://github.com/maxmoneycash/lilyshark">Source</a>
        </nav>
      </div>

      <div className="lede">
        <h1>Flash your board.</h1>
        <p className="sub">
          Lilyshark turns a LILYGO T-Deck into a handheld LoRa packet sniffer
          and RF analyzer. Pick a board, plug it in, click once — no toolchain,
          nothing to compile.
        </p>
        <p className="code-note">
          In-browser flashing needs <b>Chrome</b> or <b>Edge</b> on a computer.
          The direct download works in any browser.
        </p>
      </div>

      <section className="devices" aria-label="Supported devices">
        {DEVICES.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`device-card ${d.id === device ? "selected" : ""}`}
            onClick={() => pick(d.id)}
          >
            <span className="art">
              <DeckIcon gps={d.gps} />
            </span>
            <span className="device-name">{d.name}</span>
            <span className="device-chip">{d.chip}</span>
          </button>
        ))}
      </section>

      <div className="hero">
        <img
          src="/flash/hero-tdeck.png"
          alt="A T-Deck Plus running Lilyshark's guided first run, beside the web analyzer"
        />
        <div className="hero-caption">
          <span>
            <b>{selected.name}</b> · first run, on hardware
          </span>
        </div>
      </div>

      <div className="product" ref={ctaRef}>
        <h2>{selected.heading}</h2>
        <p className="tagline">{selected.tagline}</p>

        <ul className="checklist">
          {CHECKLIST.map((item) => (
            <li key={item}>
              <span className="tick">✓</span>
              {item}
            </li>
          ))}
        </ul>

        <div className="cta">
          <esp-web-install-button manifest={FIRMWARE.manifest}>
            <button slot="activate" className="flash-btn" type="button">
              {Glyph.bolt}
              <span className="cta-text">
                Flash in browser
                <span className="cta-sub">Web Serial · Chrome / Edge</span>
              </span>
            </button>
            <span slot="unsupported" className="unsupported">
              In-browser flashing needs Web Serial — open this page in Chrome or
              Edge on a computer. The download links below work anywhere.
            </span>
            <span slot="not-allowed" className="not-allowed">
              Serial access is blocked here; check the browser's site
              permissions.
            </span>
          </esp-web-install-button>
        </div>

        <div className="secondary">
          <a className="outline-btn" href={`/flash/${FIRMWARE.file}`}>
            {Glyph.download} Download .bin
          </a>
          <a
            className="outline-btn"
            href="https://github.com/maxmoneycash/lilyshark"
          >
            {Glyph.code} Source
          </a>
        </div>

        <p className="meta">
          {selected.name} · {FIRMWARE.version} · image <b>{FIRMWARE.file}</b> ·{" "}
          {FIRMWARE.bytes} bytes · written at {FIRMWARE.offset}
          <br />
          sha256 <b className="hash">{FIRMWARE.sha256}</b>
        </p>
      </div>

      <div className="card">
        <div className="eyebrow">How it goes</div>
        <h3>Three steps, one cable.</h3>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.name}>
              <div className="glyph">{s.glyph}</div>
              <div className="name">{s.name}</div>
              <div className="hint">{s.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">Verify</div>
        <h3>Check your image.</h3>
        <p className="card-sub">
          The checksum in the install panel is computed from the exact file
          this page flashes. To confirm a copy you downloaded separately — or
          to audit what was flashed — run:
        </p>
        <div className="cmd-label">DOWNLOADED IMAGE</div>
        <div className="cmd-row">
          <code className="verify-cmd">shasum -a 256 {FIRMWARE.file}</code>
          <CopyButton text={`shasum -a 256 ${FIRMWARE.file}`} />
        </div>
        <div className="cmd-label">AGAINST THE PUBLISHED SUMS</div>
        <div className="cmd-row">
          <code className="verify-cmd">
            curl -sL https://github.com/maxmoneycash/lilyshark/raw/main/dist/SHA256SUMS
          </code>
          <CopyButton text="curl -sL https://github.com/maxmoneycash/lilyshark/raw/main/dist/SHA256SUMS" />
        </div>
        <p className="verify-note">
          The output must match the sha256 above. Prefer proof over trust?
          Build the image yourself with the{" "}
          <a href="https://github.com/maxmoneycash/lilyshark">
            reproducible-build instructions
          </a>{" "}
          and compare hashes.
        </p>
      </div>

      <details>
        <summary>IF THE DEVICE NEVER APPEARS</summary>
        <div>
          <span>
            · Swap the cable first — most "broken" flashes are charge-only
            cables.
          </span>
          <span>
            · Force the bootloader: hold the trackball center down, press the
            reset button, release both, then click install again.
          </span>
          <span>
            · Close other tabs or serial monitors using the port; only one
            program can hold it.
          </span>
          <span>
            · The image is unbrickable to experiment with: it writes the full
            flash from byte zero, so a failed attempt is cured by flashing
            again.
          </span>
        </div>
      </details>

      <details>
        <summary>WHAT GETS INSTALLED</summary>
        <div>
          <span>
            The same factory image the repository builds: the complete
            Lilyshark firmware — live traffic, packet inspector, spectrum scan,
            node tracking, surveys, capture to microSD, and the Shelby off-grid
            pointer pipeline.
          </span>
          <span>
            After flashing, open <a href="/">the analyzer</a>, press CONNECT →
            LILYSHARK T-DECK · USB, and the device links to this site over the
            same cable.
          </span>
        </div>
      </details>

      <footer>
        GPL-3.0 ·{" "}
        <a href="https://github.com/maxmoneycash/lilyshark">source</a> ·{" "}
        <a href="/">lilyshark.com</a>
      </footer>
    </main>
  );
}
