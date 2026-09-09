import * as RadioGroup from "@radix-ui/react-radio-group";
import { useEffect, useRef, useState } from "react";
import { UiIcon } from "../components/UiIcon";
import { TDeckPhoto } from "../components/TDeckPhoto";
import { tabHref, type Tab } from "../mesh/navigation";
import { loadInstaller } from "./installer";
import "./flash.css";

/**
 * Browser flasher for the T-Deck family, plus the two other ways to run
 * Lilyshark. The esp-web-tools element is loaded on demand from
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

/** Small original glyphs for the step circles and buttons. */
const Glyph = {
  download: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5" />
      <path d="M4 15.5h12" />
    </svg>
  ),
  usb: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6.5" y="2.5" width="7" height="6" rx="1.5" />
      <path d="M10 8.5v6m0 0l-3-2.2m3 2.2l3-2.2" />
      <circle cx="10" cy="17" r="1.4" />
    </svg>
  ),
  bolt: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 2.5L4.5 11H9l-1 6.5L14.5 9H10l1-6.5z" />
    </svg>
  ),
  copy: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10h1.5" />
    </svg>
  ),
  code: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
    </svg>
  ),
};

function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const label =
    status === "copied"
      ? "Copied"
      : status === "error"
        ? "Select and copy the command"
        : "Copy command";
  return (
    <button
      type="button"
      className={`copy-btn ${status}`}
      title={label}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("copied");
          clearTimeout(resetTimer.current);
          resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
        } catch {
          setStatus("error");
        }
      }}
    >
      <span aria-live="polite">
        {status === "copied" ? (
          <UiIcon name="check" />
        ) : status === "error" ? (
          "!"
        ) : (
          Glyph.copy
        )}
      </span>
    </button>
  );
}

function BrowserPreview() {
  return (
    <figure className="analyzer-preview">
      <div className="preview-titlebar" aria-hidden="true">
        <span>◦ ◦ ◦</span>
        <span>LILYSHARK / TRAFFIC</span>
      </div>
      <img
        className="analyzer-preview-image"
        src="/flash/analyzer-preview.png"
        width={1440}
        height={894}
        loading="lazy"
        alt="Lilyshark traffic analyzer showing a synthetic sample capture, airtime graph, and decoded LoRa frame"
      />
      <figcaption>Actual analyzer · synthetic sample capture</figcaption>
    </figure>
  );
}

function SourceMock() {
  const lines: [string, string][] = [
    ["$", "git clone https://github.com/maxmoneycash/lilyshark"],
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
      className="window-mock"
    >
      <rect
        x="1"
        y="1"
        width="418"
        height="284"
        fill="none"
        stroke="currentColor"
        opacity="0.5"
      />
      <line
        x1="1"
        y1="27"
        x2="419"
        y2="27"
        stroke="currentColor"
        opacity="0.4"
      />
      {[13, 25, 37].map((cx) => (
        <rect
          key={cx}
          x={cx - 3}
          y="11"
          width="6"
          height="6"
          fill="currentColor"
          opacity="0.55"
        />
      ))}
      <text
        x="210"
        y="17.5"
        textAnchor="middle"
        fontSize="8"
        letterSpacing="1.2"
        fill="currentColor"
        opacity="0.75"
      >
        LILYSHARK — BUILD
      </text>
      {lines.map(([prompt, text], i) => {
        const y = 54 + i * 26;
        return (
          <g key={text}>
            {prompt ? (
              <text
                x="16"
                y={y}
                fontSize="10.5"
                fill="currentColor"
                opacity="0.55"
              >
                {prompt}
              </text>
            ) : null}
            <text
              x={prompt ? 30 : 30}
              y={y}
              fontSize="10.5"
              fill="currentColor"
              opacity={prompt ? 0.95 : 0.55}
            >
              {text}
            </text>
          </g>
        );
      })}
      <rect
        x="30"
        y={54 + lines.length * 26 - 8}
        width="7"
        height="11"
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}

/** Line art for the two non-hardware tiles, for the browser and source options. */
function BrowserIcon() {
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
      <rect x="10" y="10" width="100" height="60" />
      <line x1="10" y1="26" x2="110" y2="26" />
      {[18, 26, 34].map((cx) => (
        <circle
          key={cx}
          cx={cx}
          cy="18"
          r="1.8"
          fill="currentColor"
          stroke="none"
        />
      ))}
      {[36, 46, 56].map((y) => (
        <line
          key={y}
          x1="20"
          y1={y}
          x2={y === 46 ? 88 : 100}
          y2={y}
          strokeWidth="3"
        />
      ))}
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
      "Inspect LoRa packets, scan the band, and map nearby nodes with the built-in GPS.",
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
      "The full packet analyzer on the original T-Deck. Same radio tools and capture formats, without built-in GPS.",
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
      "Give your radio a bigger screen. Inspect live captures over USB, or follow mesh conversations over Bluetooth.",
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
      "Explore the firmware, change how it works, and build your own image with the pinned PlatformIO toolchain.",
  },
] as const;

type PlatformId = (typeof PLATFORMS)[number]["id"];
type PlatformKind = (typeof PLATFORMS)[number]["kind"];

const CHECKLISTS: Record<PlatformKind, string[]> = {
  firmware: [
    "Live LoRa traffic and packet inspection",
    "Spectrum scan and band surveys",
    "Node tracking and signal history",
    "Capture to microSD, .lscap and PCAP",
  ],
  browser: [
    "Decoded packets with raw bytes and RSSI/SNR",
    "Node maps, spectrum traces, and telemetry",
    "Export captures for further analysis",
    "Explore sample traffic before connecting",
  ],
  source: [
    "Reproducible release builds with SHA-256 hashes",
    "A desktop simulator running the firmware UI",
    "One script to flash a connected T-Deck",
    "GPL-3.0 source, ready to modify",
  ],
};

const STEPS: Record<
  PlatformKind,
  { glyph: JSX.Element; name: string; hint: string }[]
> = {
  firmware: [
    {
      glyph: Glyph.download,
      name: "Pick a build",
      hint: "T-Deck or T-Deck Plus",
    },
    {
      glyph: Glyph.usb,
      name: "Connect USB",
      hint: "data cable, device powered on",
    },
    { glyph: Glyph.bolt, name: "Flash", hint: "choose the port and install" },
  ],
  browser: [
    {
      glyph: Glyph.bolt,
      name: "Flash a deck",
      hint: "any of the boards above",
    },
    {
      glyph: Glyph.usb,
      name: "Open and connect",
      hint: "CONNECT, then pick the link",
    },
    {
      glyph: Glyph.code,
      name: "Watch the mesh",
      hint: "traffic, nodes, map, spectrum",
    },
  ],
  source: [
    { glyph: Glyph.code, name: "Clone", hint: "GPL-3.0, no sign-up" },
    {
      glyph: Glyph.download,
      name: "Build",
      hint: "pinned toolchain, reproducible",
    },
    { glyph: Glyph.usb, name: "Flash", hint: "one script, one cable" },
  ],
};

const STEP_HEADING: Record<PlatformKind, string> = {
  firmware: "From USB to live traffic.",
  browser: "Connect your radio.",
  source: "Build and run the firmware.",
};

const CLONE_CMD =
  "git clone https://github.com/maxmoneycash/lilyshark && cd lilyshark";
const BUILD_CMD = "./scripts/build_release.sh";
const REPO = "https://github.com/maxmoneycash/lilyshark";

export function FlashPage({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const [platform, setPlatform] = useState<PlatformId>("tdeck-plus");
  const selected = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
  const kind = selected.kind;
  const verifyRef = useRef<HTMLDivElement>(null);
  const [installer, setInstaller] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    if (installer !== "loading") return;
    let cancelled = false;
    loadInstaller().then(
      () => {
        if (!cancelled) setInstaller("ready");
      },
      () => {
        if (!cancelled) setInstaller("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [installer]);
  const openPage = (event: React.MouseEvent<HTMLAnchorElement>, tab: Tab) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onOpen(tab);
  };

  const art = (id: PlatformId, gps: boolean) =>
    id === "browser" ? (
      <BrowserIcon />
    ) : id === "source" ? (
      <SourceIcon />
    ) : (
      <TDeckPhoto alt={gps ? "T-Deck Plus" : "T-Deck family"} />
    );

  return (
    <main className="flash-page">
      <div className="page">
        <div className="lede">
          <div className="eyebrow">LILYSHARK / FIRMWARE INSTALLER</div>
          <h1>
            Inspect the mesh
            <br />
            <span>from your T-Deck.</span>
          </h1>
          <p className="sub">
            Install over USB to inspect LoRa packets, scan the band, and track
            signal history in the field.
          </p>
          <p className="release-note">
            <span className="status-dot" />
            {FIRMWARE.version} <span className="release-divider">/</span>{" "}
            GPL-3.0 firmware
          </p>
        </div>

        <div className="picker-heading">
          <span className="eyebrow">01 / Choose your platform</span>
          <span className="picker-hint">Two boards. One firmware.</span>
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
              <span className="art" aria-hidden="true">
                {art(p.id, p.gps)}
              </span>
              <span className="device-copy">
                <span className="device-name">{p.name}</span>
                <span className="device-chip">{p.chip}</span>
              </span>
              <span className="selection-dot" aria-hidden="true" />
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>

        <div className="install-layout" data-kind={kind}>
          <div className="hero">
            <span className="hero-label">{selected.heroLabel}</span>
            <div className="preview-content" key={selected.id}>
              {kind === "firmware" ? (
                <TDeckPhoto alt="Front view of a LILYGO T-Deck Plus displaying the Lilyshark firmware Home screen" />
              ) : kind === "browser" ? (
                <BrowserPreview />
              ) : (
                <SourceMock />
              )}
              <div className="hero-caption">
                <span>
                  <b>
                    {kind === "firmware"
                      ? "T-Deck Plus pictured"
                      : selected.name}
                  </b>{" "}
                  ·{" "}
                  {kind === "firmware"
                    ? "Firmware Home screen"
                    : selected.caption}
                </span>
              </div>
            </div>
          </div>

          <section className="product" aria-labelledby="product-heading">
            <div className="eyebrow">
              02 /{" "}
              {kind === "firmware"
                ? "Install the firmware"
                : kind === "browser"
                  ? "Open the analyzer"
                  : "Make it your own"}
            </div>
            <h2 id="product-heading">{selected.heading}</h2>
            <p className="tagline">{selected.tagline}</p>

            {kind === "firmware" ? (
              <>
                <div className="install-requirement">
                  {Glyph.usb}
                  <span>
                    Use a USB data cable and Chrome or Edge on a computer.
                  </span>
                </div>
                <div className="cta">
                  {installer === "ready" ? (
                    <esp-web-install-button manifest={FIRMWARE.manifest}>
                      <button
                        slot="activate"
                        className="flash-btn"
                        type="button"
                      >
                      {Glyph.bolt}
                      <span className="cta-text">
                        Install Lilyshark
                        <span className="cta-sub">
                          Choose USB port to begin
                        </span>
                      </span>
                    </button>
                    <span slot="unsupported" className="unsupported">
                        This browser cannot flash over USB. Open this page in
                        desktop Chrome or Edge, or download the image below.
                    </span>
                    <span slot="not-allowed" className="not-allowed">
                        USB flashing needs HTTPS or localhost. Open the
                        installer at{" "}
                        <a href="https://lilyshark.com/flash/">lilyshark.com</a>
                        .
                    </span>
                    </esp-web-install-button>
                  ) : installer === "loading" ? (
                    <button className="flash-btn" type="button" disabled>
                      Loading installer…
                    </button>
                ) : (
                  <div className="installer-error" role="alert">
                      <p>
                        The installer could not load. Retry, or download the
                        firmware below.
                      </p>
                      <button
                        type="button"
                        className="outline-btn"
                        onClick={() => setInstaller("loading")}
                      >
                        Retry installer
                      </button>
                  </div>
                )}
                </div>

                <div className="secondary">
                  <a
                    className="outline-btn"
                    href={`/flash/${FIRMWARE.file}`}
                    download
                  >
                    {Glyph.download} Download .bin
                  </a>
                  <a className="outline-btn" href={REPO}>
                    {Glyph.code} Source
                  </a>
                </div>

                <p className="meta release-meta">
                  <span>{FIRMWARE.version}</span>
                  <span>977 KiB · Factory image</span>
                  <a
                    href="#flash"
                    onClick={(event) => {
                      event.preventDefault();
                      verifyRef.current?.scrollIntoView({ block: "start" });
                      verifyRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    Verify checksum
                  </a>
                </p>
              </>
            ) : kind === "browser" ? (
              <>
                <div className="cta">
                  <a
                    className="flash-btn"
                    href={tabHref("TRAFFIC")}
                    onClick={(event) => openPage(event, "TRAFFIC")}
                  >
                    {Glyph.bolt}
                    <span className="cta-text">
                      Open the analyzer
                      <span className="cta-sub">start with sample traffic</span>
                    </span>
                  </a>
                </div>
                <div className="secondary">
                  <a
                    className="outline-btn"
                    href={tabHref("DOCS")}
                    onClick={(event) => openPage(event, "DOCS")}
                  >
                    {Glyph.code} Read the docs
                  </a>
                </div>
                <p className="meta">
                  USB carries the full analyzer telemetry. Bluetooth carries
                  mesh conversations where the browser supports pairing.
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
                  Writes <b>dist/lilyshark-tdeck.factory.bin</b>, the
                  application image, the ELF and <b>dist/SHA256SUMS</b>. GitHub
                  Actions on ubuntu-24.04 is the canonical release environment —
                  a build on another OS can embed different tool paths.
                </p>
              </>
            )}
            <ul className="checklist">
              {CHECKLISTS[kind].map((item) => (
                <li key={item}>
                  <span className="tick" aria-hidden="true">
                    <UiIcon name="check" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="card steps-card">
          <div className="eyebrow">03 / From cable to capture</div>
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
          <div className="support-layout">
            <div
              className="card verify-card"
              ref={verifyRef}
              id="verify"
              tabIndex={-1}
            >
              <div className="eyebrow">SHA-256 verification</div>
                <h3>Check your image.</h3>
                <p className="card-sub">
                Downloaded the binary? Check it against the SHA-256 below. This
                is the exact factory image served by the installer.
                </p>
                <div className="firmware-facts">
                  <span>{FIRMWARE.bytes} bytes</span>
                  <span>Flash offset {FIRMWARE.offset}</span>
                </div>
                <code className="checksum">{FIRMWARE.sha256}</code>
                <div className="cmd-label">CHECK YOUR DOWNLOAD</div>
                <div className="cmd-row">
                  <code className="verify-cmd">
                    shasum -a 256 {FIRMWARE.file}
                  </code>
                  <CopyButton text={`shasum -a 256 ${FIRMWARE.file}`} />
                </div>
                <p className="verify-note">
                The output should match the hash above. You can also follow the{" "}
                <a href={REPO}>reproducible-build instructions</a> and compare
                hashes.
                </p>
              </div>

              <div className="help-panel">
              <div className="eyebrow">Troubleshooting</div>
              <h3>Get your board connected.</h3>
                <details>
                  <summary>My board doesn't appear</summary>
                  <div>
                    <span>
                    · Try another USB data cable. A charge-only cable will power
                    the board without exposing a serial port.
                    </span>
                    <span>
                      · Force the bootloader: hold the trackball center down,
                      press the reset button, release both, then click install
                      again.
                    </span>
                    <span>
                      · Close other tabs or serial monitors using the port; only
                      one program can hold it.
                    </span>
                    <span>
                      · If installation is interrupted, reconnect the board in
                      bootloader mode and try flashing again.
                    </span>
                  </div>
                </details>

                <details>
                  <summary>What gets installed</summary>
                  <div>
                    <span>
                      The same factory image the repository builds: the complete
                      Lilyshark firmware — live traffic, packet inspector,
                      spectrum scan, node tracking, surveys, capture to microSD,
                      and the Shelby off-grid pointer pipeline.
                    </span>
                    <span>
                    After flashing, open{" "}
                    <a
                      href={tabHref("TRAFFIC")}
                      onClick={(event) => openPage(event, "TRAFFIC")}
                    >
                      the analyzer
                    </a>
                    , press CONNECT → LILYSHARK T-DECK · USB, and the device
                    links to this site over the same cable.
                    </span>
                  </div>
                </details>
                <details>
                  <summary>Can I install from my phone?</summary>
                  <div>
                    <p>
                    Use Chrome or Edge on a computer to flash over USB. You can
                    download the firmware on any device and transfer it to your
                    computer.
                    </p>
                  </div>
                </details>
                <a className="help-link" href={`${REPO}/issues`}>
                  Still stuck? Open an issue
                </a>
              </div>
            </div>
        ) : null}
      </div>
    </main>
  );
}
