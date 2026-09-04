import * as RadioGroup from "@radix-ui/react-radio-group";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

/**
 * Browser flasher for the T-Deck family, plus the two other ways to run
 * Lilyshark. The esp-web-tools element is loaded by flash/index.html from
 * /flash/install-button.js; the firmware image, manifest, fonts and the
 * simulator screens stay as static files under public/flash/.
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

/**
 * Original SVG render of a T-Deck front, drawn to the published hardware
 * proportions — 100 × 68 mm body, 2.8" 320×240 panel, BlackBerry-style
 * keyboard under a trackball — with one of our own simulator frames on the
 * screen, served as a 4x nearest-neighbour blow-up so the pixel grid survives
 * the browser's downscale at any hero width.
 * Scale is 4.4 units per millimetre, so the body is 300 × 440 units.
 */
function DeviceMock({ screen, alt }: { screen: string; alt: string }) {
  const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const keyX = (col: number) => 35 + col * 25.4;
  const rowY = [302, 335, 368, 401];
  const spaceW = 3 * 25.4 + 21.4;
  return (
    <svg
      viewBox="0 0 320 462"
      width="320"
      height="462"
      role="img"
      aria-label={alt}
      className="device-mock"
    >
      <defs>
        {/* Moulded plastic: catches light along the top edge, falls away below. */}
        <linearGradient id="deck-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#37313a" />
          <stop offset="0.13" stopColor="#282329" />
          <stop offset="0.7" stopColor="#1b181d" />
          <stop offset="1" stopColor="#131115" />
        </linearGradient>
        {/* Rim light: bright at the top bevel, gone by the bottom corners. */}
        <linearGradient id="deck-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.34)" />
          <stop offset="0.35" stopColor="rgba(255,255,255,0.09)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.02)" />
        </linearGradient>
        <linearGradient id="deck-key" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#39323b" />
          <stop offset="0.5" stopColor="#282329" />
          <stop offset="1" stopColor="#191619" />
        </linearGradient>
        {/* Fret bars between keyboard rows. */}
        <linearGradient id="deck-fret" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.07)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.26)" />
        </linearGradient>
        <radialGradient id="deck-ball" cx="0.34" cy="0.28" r="0.85">
          <stop offset="0" stopColor="#544a53" />
          <stop offset="0.55" stopColor="#2a252c" />
          <stop offset="1" stopColor="#141116" />
        </radialGradient>
        {/* Sheen across the cover glass. */}
        <linearGradient id="deck-glass" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.15)" />
          <stop offset="0.6" stopColor="rgba(255,255,255,0.02)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath id="deck-glass-clip">
          <rect x="44" y="38" width="232" height="178" rx="9" />
        </clipPath>
        {/* Light the panel throws onto the bezel around it. */}
        <filter id="deck-bloom" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="15" />
        </filter>
        <g id="deck-cap">
          <rect
            width="21.4"
            height="24"
            rx="4.5"
            fill="url(#deck-key)"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="0.8"
          />
          <rect x="3" y="1.5" width="15.4" height="1.4" rx="0.7" fill="rgba(255,255,255,0.09)" />
        </g>
      </defs>

      {/* Side key on the right edge. */}
      <rect
        x="307"
        y="118"
        width="5.5"
        height="38"
        rx="2.7"
        fill="#241f25"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="0.8"
      />

      {/* Body */}
      <rect x="10" y="11" width="300" height="440" rx="30" fill="url(#deck-body)" />
      <rect
        x="10"
        y="11"
        width="300"
        height="440"
        rx="30"
        fill="none"
        stroke="url(#deck-rim)"
        strokeWidth="1.6"
      />
      <rect
        x="12.6"
        y="13.6"
        width="294.8"
        height="434.8"
        rx="27.6"
        fill="none"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth="1"
      />

      {/* Screen: bloom on the bezel, then glass, then our firmware frame. */}
      <rect x="52" y="46" width="216" height="162" rx="10" fill="#ff4f9d" opacity="0.2" filter="url(#deck-bloom)" />
      <rect x="44" y="38" width="232" height="178" rx="9" fill="#08070a" />
      <rect x="59" y="49" width="202" height="152" rx="2" fill="#000" />
      <image
        href={screen}
        x="60"
        y="50"
        width="200"
        height="150"
        preserveAspectRatio="xMidYMid slice"
        className="deck-screen"
      />
      <g clipPath="url(#deck-glass-clip)">
        <polygon points="44,38 166,38 84,216 44,216" fill="url(#deck-glass)" opacity="0.42" />
        <rect x="44" y="38" width="232" height="1.3" fill="rgba(255,255,255,0.16)" />
      </g>
      <rect
        x="44"
        y="38"
        width="232"
        height="178"
        rx="9"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="1"
      />

      {/* Trackball */}
      <circle cx="160" cy="256" r="16.5" fill="#1a171b" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <circle cx="160" cy="256" r="10.5" fill="url(#deck-ball)" />
      <circle cx="156.4" cy="252.4" r="2.7" fill="rgba(255,255,255,0.18)" />

      {/* Keyboard: four rows of caps, each row sitting behind a fret bar. */}
      {rowY.map((y) => (
        <rect key={`fret-${y}`} x="36" y={y - 6} width="248" height="3" rx="1.5" fill="url(#deck-fret)" />
      ))}
      {rowY.slice(0, 3).map((y) =>
        COLS.map((col) => <use key={`key-${y}-${col}`} href="#deck-cap" x={keyX(col)} y={y} />),
      )}
      {[0, 1, 2, 7, 8, 9].map((col) => (
        <use key={`key-space-row-${col}`} href="#deck-cap" x={keyX(col)} y={rowY[3]} />
      ))}
      <rect
        x={keyX(3)}
        y={rowY[3]}
        width={spaceW}
        height="24"
        rx="4.5"
        fill="url(#deck-key)"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth="0.8"
      />
      <rect
        x={keyX(3) + 10}
        y={rowY[3] + 1.5}
        width={spaceW - 20}
        height="1.4"
        rx="0.7"
        fill="rgba(255,255,255,0.09)"
      />
    </svg>
  );
}

/** A browser window holding the analyzer, drawn rather than screenshotted so
 *  it follows the reader's theme instead of freezing one. */
function BrowserMock() {
  const tabs = ["TRAFFIC", "NODES", "MAP", "SPECTRUM"];
  const cols = [
    { label: "TIME", x: 14, w: 54 },
    { label: "SRC", x: 96, w: 58 },
    { label: "DST", x: 176, w: 58 },
    { label: "KIND", x: 250, w: 40 },
    { label: "SNR", x: 316, w: 30 },
  ];
  return (
    <svg
      viewBox="0 0 420 286"
      role="img"
      aria-label="The Lilyshark analyzer running as a web page"
      className="device-mock window-mock"
    >
      <rect x="1" y="1" width="418" height="284" fill="none" stroke="currentColor" opacity="0.5" />
      {/* title bar */}
      <line x1="1" y1="27" x2="419" y2="27" stroke="currentColor" opacity="0.4" />
      {[13, 25, 37].map((cx) => (
        <rect key={cx} x={cx - 3} y="11" width="6" height="6" fill="currentColor" opacity="0.55" />
      ))}
      <rect x="132" y="8" width="156" height="12" fill="none" stroke="currentColor" opacity="0.35" />
      <text x="210" y="17.5" textAnchor="middle" fontSize="8" letterSpacing="1.2" fill="currentColor" opacity="0.75">
        LILYSHARK.COM
      </text>
      {/* tab strip */}
      {tabs.map((t, i) => (
        <g key={t}>
          <rect
            x={14 + i * 74}
            y={39}
            width="66"
            height="16"
            fill={i === 0 ? "currentColor" : "none"}
            stroke="currentColor"
            opacity={i === 0 ? 0.85 : 0.35}
          />
          <text
            x={47 + i * 74}
            y={50.5}
            textAnchor="middle"
            fontSize="7.5"
            letterSpacing="0.9"
            fill={i === 0 ? "var(--panel)" : "currentColor"}
            opacity={i === 0 ? 1 : 0.75}
          >
            [{t}]
          </text>
        </g>
      ))}
      {/* traffic table: real column names, abstract values */}
      <line x1="14" y1="70" x2="406" y2="70" stroke="currentColor" opacity="0.35" />
      {cols.map((c) => (
        <text key={c.label} x={c.x} y={67} fontSize="7.5" letterSpacing="0.9" fill="currentColor" opacity="0.6">
          {c.label}
        </text>
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((row) => {
        const y = 82 + row * 17;
        const on = row === 3;
        return (
          <g key={row}>
            {on ? <rect x="14" y={y - 9} width="392" height="15" fill="currentColor" opacity="0.14" /> : null}
            {on ? <rect x="14" y={y - 9} width="2" height="15" fill="currentColor" /> : null}
            {cols.map((c, i) => (
              <rect
                key={c.label}
                x={c.x}
                y={y - 4.5}
                width={c.w - (row % 3) * 5}
                height="5"
                fill="currentColor"
                opacity={on ? 0.75 : 0.3 + ((row + i) % 3) * 0.08}
              />
            ))}
          </g>
        );
      })}
      {/* status bar */}
      <line x1="1" y1="258" x2="419" y2="258" stroke="currentColor" opacity="0.4" />
      <text x="14" y="272" fontSize="7.5" letterSpacing="1.1" fill="currentColor" opacity="0.7">
        CHANNEL 0 · LISTENING
      </text>
      <text x="406" y="272" textAnchor="end" fontSize="7.5" letterSpacing="1.1" fill="currentColor" opacity="0.7">
        USB LINK
      </text>
    </svg>
  );
}

/** A terminal running the build this page serves. The commands are the ones in
 *  the README, not invented ones. */
function SourceMock() {
  const lines: [string, string][] = [
    ["$", "git clone github.com/maxmoneycash/lilyshark"],
    ["$", "cd lilyshark"],
    ["$", "./scripts/build_release.sh"],
    ["", "dist/lilyshark-tdeck.factory.bin"],
    ["", "dist/SHA256SUMS"],
    ["$", "./scripts/flash_tdeck.sh --auto"],
    ["", "verified against SHA256SUMS"],
  ];
  return (
    <svg
      viewBox="0 0 420 286"
      role="img"
      aria-label="A terminal building Lilyshark from source"
      className="device-mock window-mock"
    >
      <rect x="1" y="1" width="418" height="284" fill="none" stroke="currentColor" opacity="0.5" />
      <line x1="1" y1="27" x2="419" y2="27" stroke="currentColor" opacity="0.4" />
      {[13, 25, 37].map((cx) => (
        <rect key={cx} x={cx - 3} y="11" width="6" height="6" fill="currentColor" opacity="0.55" />
      ))}
      <text x="210" y="17.5" textAnchor="middle" fontSize="8" letterSpacing="1.2" fill="currentColor" opacity="0.75">
        LILYSHARK — BUILD
      </text>
      {lines.map(([prompt, text], i) => {
        const y = 54 + i * 26;
        return (
          <g key={text}>
            {prompt ? (
              <text x="16" y={y} fontSize="10.5" fill="currentColor" opacity="0.55">
                {prompt}
              </text>
            ) : null}
            <text x={prompt ? 30 : 30} y={y} fontSize="10.5" fill="currentColor" opacity={prompt ? 0.95 : 0.55}>
              {text}
            </text>
          </g>
        );
      })}
      <rect x="30" y={54 + lines.length * 26 - 8} width="7" height="11" fill="currentColor" opacity="0.8">
        <animate attributeName="opacity" values="0.8;0.8;0;0" dur="1.1s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

/** Line art for the two non-hardware tiles, in the same weight as DeckIcon. */
function BrowserIcon() {
  return (
    <svg width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="10" y="10" width="100" height="60" />
      <line x1="10" y1="26" x2="110" y2="26" />
      {[18, 26, 34].map((cx) => (
        <circle key={cx} cx={cx} cy="18" r="1.8" fill="currentColor" stroke="none" />
      ))}
      {[36, 46, 56].map((y) => (
        <line key={y} x1="20" y1={y} x2={y === 46 ? 88 : 100} y2={y} strokeWidth="3" />
      ))}
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="10" y="10" width="100" height="60" />
      <line x1="10" y1="26" x2="110" y2="26" />
      <path d="M26 40l10 8-10 8" />
      <line x1="44" y1="56" x2="70" y2="56" />
    </svg>
  );
}

/** What the page offers. Only platforms that work today are listed: there is no
 *  Lilyshark build for other boards yet, and a tile that cannot be clicked
 *  through is worse than no tile. */
const PLATFORMS = [
  {
    id: "tdeck-plus",
    kind: "firmware",
    name: "T-Deck Plus",
    chip: "ESP32-S3 · SX1262 · GPS",
    gps: true,
    heroLabel: "01 / Handheld analyzer",
    caption: `running ${FIRMWARE.version}`,
    heading: "Lilyshark for T-Deck Plus.",
    tagline:
      "LILYGO's pocket computer with a GPS on board — the full analyzer, with a fix for the nodes map.",
  },
  {
    id: "tdeck",
    kind: "firmware",
    name: "T-Deck",
    chip: "ESP32-S3 · SX1262",
    gps: false,
    heroLabel: "02 / Handheld analyzer",
    caption: `running ${FIRMWARE.version}`,
    heading: "Lilyshark for T-Deck.",
    tagline:
      "The same image on the original board. Every radio and capture tool works; only the GPS fix is absent.",
  },
  {
    id: "browser",
    kind: "browser",
    name: "Browser",
    chip: "ANALYZER · NO INSTALL",
    gps: false,
    heroLabel: "03 / Analyzer, no install",
    caption: "web serial / bluetooth",
    heading: "Lilyshark in the browser.",
    tagline:
      "The same analyzer as a web page. Plug a flashed deck into a computer over USB, or pair one over Bluetooth — nothing to install, and it keeps working with no internet.",
  },
  {
    id: "source",
    kind: "source",
    name: "From source",
    chip: "GPL-3.0 · PLATFORMIO",
    gps: false,
    heroLabel: "04 / Build it yourself",
    caption: "reproducible build",
    heading: "Build it yourself.",
    tagline:
      "Clone the repository and build the same image this page serves. The release build is reproducible, so your checksum should match ours byte for byte.",
  },
] as const;

type PlatformId = (typeof PLATFORMS)[number]["id"];
type PlatformKind = (typeof PLATFORMS)[number]["kind"];

const CHECKLISTS: Record<PlatformKind, string[]> = {
  firmware: [
    "Live LoRa traffic feed",
    "Packet inspector, raw bytes included",
    "Spectrum scan and band surveys",
    "Node tracking with signal history",
    "Capture to microSD — .lscap and PCAP",
    "No account, no cloud, works offline",
    "Open source, GPL-3.0",
  ],
  browser: [
    "Live traffic from a deck you have flashed",
    "Packet inspector, raw bytes included",
    "Nodes, map, spectrum and telemetry",
    "USB on desktop Chrome or Edge",
    "Bluetooth pairing where the browser allows it",
    "No account, no cloud, works offline",
    "Open source, GPL-3.0",
  ],
  source: [
    "The exact image this page flashes",
    "Deterministic build, checksums to compare",
    "Pinned PlatformIO and toolchain",
    "A desktop simulator that runs the firmware",
    "One script to flash a connected deck",
    "Open source, GPL-3.0",
  ],
};

const STEPS: Record<PlatformKind, { glyph: JSX.Element; name: string; hint: string }[]> = {
  firmware: [
    { glyph: Glyph.download, name: "Pick a build", hint: "the image below is the current alpha" },
    { glyph: Glyph.usb, name: "Connect USB", hint: "data cable, device powered on" },
    { glyph: Glyph.bolt, name: "Flash", hint: "one click, about a minute" },
  ],
  browser: [
    { glyph: Glyph.bolt, name: "Flash a deck", hint: "any of the boards above" },
    { glyph: Glyph.usb, name: "Open and connect", hint: "CONNECT, then pick the link" },
    { glyph: Glyph.code, name: "Watch the mesh", hint: "traffic, nodes, map, spectrum" },
  ],
  source: [
    { glyph: Glyph.code, name: "Clone", hint: "GPL-3.0, no sign-up" },
    { glyph: Glyph.download, name: "Build", hint: "pinned toolchain, reproducible" },
    { glyph: Glyph.usb, name: "Flash", hint: "one script, one cable" },
  ],
};

const STEP_HEADING: Record<PlatformKind, string> = {
  firmware: "Three steps, one cable.",
  browser: "Three steps, no install.",
  source: "Three steps, from a clean clone.",
};

const CLONE_CMD = "git clone https://github.com/maxmoneycash/lilyshark && cd lilyshark";
const BUILD_CMD = "./scripts/build_release.sh";
const REPO = "https://github.com/maxmoneycash/lilyshark";

export function FlashPage() {
  const [platform, setPlatform] = useState<PlatformId>("tdeck-plus");
  const selected = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
  const kind = selected.kind;

  const art = (id: PlatformId, gps: boolean) =>
    id === "browser" ? <BrowserIcon /> : id === "source" ? <SourceIcon /> : <DeckIcon gps={gps} />;

  return (
    <main className="flash-page">
      <div className="statusbar">
        <span>
          <a href="/">
            <span className="lit">◊ LILYSHARK</span> ·· FLASHER
          </a>
        </span>
        <span className="sb-right">
          <span className="hide-narrow">{FIRMWARE.version}</span>
          <a href="/">ANALYZER</a>
          <a href={REPO}>SOURCE</a>
        </span>
      </div>

      <div className="page">
        <div className="lede">
          <h1>Flash your board.</h1>
          <p className="sub">
            Lilyshark turns a LILYGO T-Deck into a handheld LoRa packet sniffer
            and RF analyzer. Pick a board, plug it in, click once — no
            toolchain, nothing to compile.
          </p>
          <p className="code-note">
            In-browser flashing needs <b>Chrome</b> or <b>Edge</b> on a
            computer. The direct download works in any browser.
          </p>
        </div>

        <RadioGroup.Root
          className="devices"
          value={platform}
          onValueChange={(v) => setPlatform(v as PlatformId)}
          aria-label="Choose a platform"
          loop
        >
          {PLATFORMS.map((p) => (
            <RadioGroup.Item key={p.id} value={p.id} className="device-card">
              <span className="art">{art(p.id, p.gps)}</span>
              <span className="device-name">{p.name}</span>
              <span className="device-chip">{p.chip}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>

        <div className="hero">
          <span className="hero-label">{selected.heroLabel}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {kind === "firmware" ? (
                <DeviceMock
                  screen={selected.gps ? "/flash/deck-screen-plus.png" : "/flash/deck-screen-base.png"}
                  alt={`A T-Deck running Lilyshark — ${selected.name}`}
                />
              ) : kind === "browser" ? (
                <BrowserMock />
              ) : (
                <SourceMock />
              )}
              <div className="hero-caption">
                <span>
                  <b>{selected.name}</b> · {selected.caption}
                </span>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="product">
          <h2>{selected.heading}</h2>
          <p className="tagline">{selected.tagline}</p>

          <ul className="checklist">
            {CHECKLISTS[kind].map((item) => (
              <li key={item}>
                <span className="tick">✓</span>
                {item}
              </li>
            ))}
          </ul>

          {kind === "firmware" ? (
            <>
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
                    In-browser flashing needs Web Serial — open this page in
                    Chrome or Edge on a computer. The download links below work
                    anywhere.
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
                <a className="outline-btn" href={REPO}>
                  {Glyph.code} Source
                </a>
              </div>

              <p className="meta">
                {selected.name} · {FIRMWARE.version} · image <b>{FIRMWARE.file}</b> ·{" "}
                {FIRMWARE.bytes} bytes · written at {FIRMWARE.offset}
                <br />
                sha256 <b className="hash">{FIRMWARE.sha256}</b>
              </p>
            </>
          ) : kind === "browser" ? (
            <>
              <div className="cta">
                <a className="flash-btn" href="/">
                  {Glyph.bolt}
                  <span className="cta-text">
                    Open the analyzer
                    <span className="cta-sub">no install · works offline</span>
                  </span>
                </a>
              </div>
              <div className="secondary">
                <a className="outline-btn" href="/docs">
                  {Glyph.code} Read the docs
                </a>
                <a className="outline-btn" href="/demo">
                  {Glyph.download} Try the demo
                </a>
              </div>
              <p className="meta">
                The analyzer links to a deck over USB with Web Serial, or over
                Bluetooth where the browser supports it. Nothing is uploaded:
                every capture stays in the tab until you export it.
              </p>
            </>
          ) : (
            <>
              <div className="cta">
                <a className="flash-btn" href={REPO}>
                  {Glyph.code}
                  <span className="cta-text">
                    View the source
                    <span className="cta-sub">GPL-3.0 · github</span>
                  </span>
                </a>
              </div>
              <div className="cmd-label">CLONE</div>
              <div className="cmd-row">
                <code className="verify-cmd">{CLONE_CMD}</code>
                <CopyButton text={CLONE_CMD} />
              </div>
              <div className="cmd-label">BUILD THE RELEASE ARTIFACTS</div>
              <div className="cmd-row">
                <code className="verify-cmd">{BUILD_CMD}</code>
                <CopyButton text={BUILD_CMD} />
              </div>
              <p className="meta">
                Writes <b>dist/lilyshark-tdeck.factory.bin</b>, the application
                image, the ELF and <b>dist/SHA256SUMS</b>. GitHub Actions on
                ubuntu-24.04 is the canonical release environment — a build on
                another OS can embed different tool paths.
              </p>
            </>
          )}
        </div>

        <div className="card">
          <div className="eyebrow">How it goes</div>
          <h3>{STEP_HEADING[kind]}</h3>
          <div className="steps">
            {STEPS[kind].map((s) => (
              <div className="step" key={s.name}>
                <div className="glyph">{s.glyph}</div>
                <div className="name">{s.name}</div>
                <div className="hint">{s.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {kind === "firmware" ? (
          <>
            <div className="card">
              <div className="eyebrow">Verify</div>
              <h3>Check your image.</h3>
              <p className="card-sub">
                The checksum in the install panel is computed from the exact
                file this page flashes. To confirm a copy you downloaded
                separately — or to audit what was flashed — run:
              </p>
              <div className="cmd-label">DOWNLOADED IMAGE</div>
              <div className="cmd-row">
                <code className="verify-cmd">shasum -a 256 {FIRMWARE.file}</code>
                <CopyButton text={`shasum -a 256 ${FIRMWARE.file}`} />
              </div>
              <div className="cmd-label">AGAINST THE PUBLISHED SUMS</div>
              <div className="cmd-row">
                <code className="verify-cmd">
                  curl -sL {REPO}/raw/main/dist/SHA256SUMS
                </code>
                <CopyButton text={`curl -sL ${REPO}/raw/main/dist/SHA256SUMS`} />
              </div>
              <p className="verify-note">
                The output must match the sha256 above. Prefer proof over
                trust? Build the image yourself with the{" "}
                <a href={REPO}>reproducible-build instructions</a> and compare
                hashes.
              </p>
            </div>

            <details>
              <summary>If the device never appears</summary>
              <div>
                <span>
                  · Swap the cable first — most "broken" flashes are
                  charge-only cables.
                </span>
                <span>
                  · Force the bootloader: hold the trackball center down, press
                  the reset button, release both, then click install again.
                </span>
                <span>
                  · Close other tabs or serial monitors using the port; only
                  one program can hold it.
                </span>
                <span>
                  · The image is unbrickable to experiment with: it writes the
                  full flash from byte zero, so a failed attempt is cured by
                  flashing again.
                </span>
              </div>
            </details>

            <details>
              <summary>What gets installed</summary>
              <div>
                <span>
                  The same factory image the repository builds: the complete
                  Lilyshark firmware — live traffic, packet inspector, spectrum
                  scan, node tracking, surveys, capture to microSD, and the
                  Shelby off-grid pointer pipeline.
                </span>
                <span>
                  After flashing, open <a href="/">the analyzer</a>, press
                  CONNECT → LILYSHARK T-DECK · USB, and the device links to
                  this site over the same cable.
                </span>
              </div>
            </details>
          </>
        ) : null}
      </div>

      <div className="statusbar bottom">
        <span>
          GPL-3.0 · <a href={REPO}>SOURCE</a> · <a href="/">LILYSHARK.COM</a>
        </span>
        <span className="sb-right">
          <span className="lit">{PLATFORMS.length} PLATFORMS</span>
        </span>
      </div>
    </main>
  );
}
