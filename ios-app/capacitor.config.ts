import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The shell serves the same static bundle lilyshark.com deploys — www/ is
 * assembled by scripts/assemble-www.mjs from webapp/dist plus the injected
 * native-bridge.js, never hand-edited. Keeping webDir a sibling copy rather
 * than pointing straight at ../webapp/dist is deliberate: the bridge
 * injection must not touch the webapp's own build output, which the website
 * deploy ships verbatim.
 */
const config: CapacitorConfig = {
	appId: "com.lilyshark.app",
	appName: "Lilyshark",
	webDir: "www",
};

export default config;
