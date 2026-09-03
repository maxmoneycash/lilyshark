/**
 * Assemble www/ for the Capacitor shell.
 *
 * Copies webapp/dist verbatim, then injects a classic <script> for the native
 * BLE bridge ahead of the app's module bundle. Classic scripts execute in
 * document order before deferred module scripts, which is what guarantees
 * navigator.bluetooth exists by the time the webapp's first render probes it.
 *
 * The copy exists so the injection never touches webapp/dist itself — that
 * directory is exactly what the lilyshark.com deploy ships, and it must stay
 * byte-for-byte untouched by the iOS build.
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "..", "webapp", "dist");
const www = join(root, "www");

if (!existsSync(join(dist, "index.html"))) {
	console.error(
		"webapp/dist/index.html not found — run `npm run build` here (it builds the webapp first), " +
			"or `npm run build` inside webapp/ yourself.",
	);
	process.exit(1);
}

rmSync(www, { recursive: true, force: true });
cpSync(dist, www, { recursive: true });

const indexPath = join(www, "index.html");
const html = readFileSync(indexPath, "utf8");
const firstScript = html.indexOf("<script");
if (firstScript === -1) {
	console.error("www/index.html has no <script> tag to inject ahead of — refusing to guess.");
	process.exit(1);
}
writeFileSync(
	indexPath,
	html.slice(0, firstScript) +
		'<script src="/native-bridge.js"></script>\n    ' +
		html.slice(firstScript),
);
console.log("www/ assembled from webapp/dist; native-bridge.js injected ahead of the app bundle");
