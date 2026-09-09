import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("./Config.tsx", import.meta.url), "utf8");

test("CONFIG USER/RADIO/POSITION stay inert until radio config arrives", () => {
	assert.match(config, /const radioReady = radioLinked && !!self/);
	assert.match(config, /saveDisabled=\{!radioReady \|\| !advertName\.trim\(\)\}/);
	assert.match(config, /saveDisabled=\{!radioReady\}/);
	assert.match(config, /disabled=\{!radioReady \|\| !posLat\.trim\(\) \|\| !posLon\.trim\(\)\}/);
	assert.match(config, /Connect a radio to set the advertised name\./);
	assert.match(
		config,
		/Connect a radio to set frequency, bandwidth \(BW\), spreading factor \(SF\), coding rate \(CR\), and TX power\./,
	);
	assert.match(config, /Connect a radio to set a fixed position\./);
	assert.match(
		config,
		/The radio is linked\. Settings appear here once config arrives\./,
	);
	assert.match(config, /value=\{self \? freq : ""\}/);
	assert.doesNotMatch(
		config,
		/onSave=\{saveRadio\}\s+saveLabel=\{t\("SAVE RADIO"\)\}\s*>/,
	);
});
