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

/** Simple original line-art of the T-Deck family: body, screen, keyboard. */
function DeckIcon({ gps }: { gps: boolean }) {
  return (
    <svg
      width="72"
      height="48"
      viewBox="0 0 72 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="6" y="4" width="60" height="40" rx="5" />
      <rect x="12" y="10" width="34" height="16" rx="2" />
      {gps ? <circle cx="54" cy="14" r="3" /> : null}
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3, 4, 5, 6, 7].map((col) => (
          <circle
            key={`${row}-${col}`}
            cx={14 + col * 6}
            cy={32 + row * 4.5}
            r="1"
            fill="currentColor"
            stroke="none"
          />
        )),
      )}
    </svg>
  );
}

const DEVICES = [
  {
    id: "tdeck-plus",
    name: "T-DECK PLUS",
    chip: "ESP32-S3 · SX1262 · GPS",
    gps: true,
    heading: "Lilyshark for T-Deck Plus.",
    tagline:
      "LILYGO's pocket computer with a GPS on board — the full analyzer, with a fix for the nodes map.",
  },
  {
    id: "tdeck",
    name: "T-DECK",
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
  { num: "1", name: "PICK A BUILD", hint: "the image below is the current alpha" },
  { num: "2", name: "CONNECT USB", hint: "data cable, device powered on" },
  { num: "3", name: "FLASH", hint: "one click, about a minute" },
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
          <a href="/">ANALYZER</a>
          <a href="https://github.com/maxmoneycash/lilyshark">SOURCE</a>
        </nav>
      </div>

      <div className="lede">
        <h1>Flash your board.</h1>
        <p className="sub">
          Lilyshark turns a LILYGO T-Deck into a handheld LoRa packet sniffer
          and RF analyzer. Pick a board, plug it in, click once — no toolchain,
          nothing to compile.
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
            <DeckIcon gps={d.gps} />
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
              FLASH IN BROWSER
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
          <span className="cta-note">
            Web Serial · Chrome or Edge on a computer · writes the complete
            image
          </span>
        </div>

        <div className="secondary">
          <a href={`/flash/${FIRMWARE.file}`}>DOWNLOAD .BIN</a>
          <a href="https://github.com/maxmoneycash/lilyshark">SOURCE</a>
          <a href="https://github.com/maxmoneycash/lilyshark/blob/main/dist/SHA256SUMS">
            CHECKSUMS
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
        <div className="eyebrow">HOW IT GOES</div>
        <h3>Three steps, one cable.</h3>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.num}>
              <div className="num">{s.num}</div>
              <div className="name">{s.name}</div>
              <div className="hint">{s.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">VERIFY</div>
        <h3>Check your image.</h3>
        <p className="card-sub">
          The checksum in the install panel is computed from the exact file
          this page flashes. To confirm a copy you downloaded separately — or
          to audit what was flashed — run:
        </p>
        <code className="verify-cmd">shasum -a 256 {FIRMWARE.file}</code>
        <p className="verify-note">
          The output must match the sha256 above. Release checksums for every
          artifact (firmware, factory image, ELF) are published as{" "}
          <a href="https://github.com/maxmoneycash/lilyshark/blob/main/dist/SHA256SUMS">
            SHA256SUMS
          </a>{" "}
          in the repository, alongside{" "}
          <a href="https://github.com/maxmoneycash/lilyshark">
            reproducible-build instructions
          </a>{" "}
          if you want to build the image yourself and compare hashes instead.
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
