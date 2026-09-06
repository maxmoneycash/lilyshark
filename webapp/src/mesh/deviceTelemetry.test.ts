import assert from "node:assert/strict";
import test from "node:test";
import { parseLskLine, type DeviceTelemetry } from "../lib/deviceLink";
import { RF_FIELD } from "../lib/lscap";
import { reportedLabel, telemetryBattery, telemetryCount, telemetrySignal, telemetryVoltage, unattributedFrames } from "./deviceTelemetry";

function sample(fields: Record<string, unknown>): DeviceTelemetry {
	const parsed = parseLskLine(`LSK T ${JSON.stringify(fields)}`);
	assert.ok(parsed?.kind === "T");
	return parsed.telemetry;
}

test("missing receive and attribution counts remain unknown while explicit zeros survive", () => {
	const missing = sample({ frames: 80 });
	assert.equal(telemetryCount(missing.rx), undefined);
	assert.equal(unattributedFrames(missing), undefined);
	const zero = sample({ rx: 0, drop_crc: 0, drop_bad: 0, drop_nosrc: 0 });
	assert.equal(telemetryCount(zero.rx), 0);
	assert.equal(unattributedFrames(zero), 0);
	assert.equal(unattributedFrames(sample({ drop_crc: 2 })), undefined, "a partial count is not a total");
	assert.equal(unattributedFrames(sample({ rx: 80, drop_crc: 28, drop_bad: 0, drop_nosrc: 50 })), 78);
	for (const value of [NaN, Infinity, -1, 1.5]) assert.equal(telemetryCount(value), undefined);
});

test("a capture sequence and receive count cannot certify a signal measurement", () => {
	const old = sample({ frames: 80, rx: 80, rssi_x10: 0, snr_x10: 0 });
	assert.equal(telemetrySignal(old, "rssi"), undefined);
	assert.equal(telemetrySignal(old, "snr"), undefined);
	const measured = sample({ latest_pf: RF_FIELD.rssi | RF_FIELD.snr, latest_dir: 1, rssi_x10: -1180, snr_x10: 0 });
	assert.equal(telemetrySignal(measured, "rssi"), -118);
	assert.equal(telemetrySignal(measured, "snr"), 0, "zero SNR is a valid measurement");
	assert.equal(telemetrySignal({ ...measured, rssiX10: 0 }, "rssi"), 0);
	assert.equal(telemetrySignal({ ...measured, direction: 2 }, "rssi"), undefined, "TX has no receive RSSI");
	assert.equal(telemetrySignal({ ...measured, presentFields: 0 }, "snr"), undefined);
	assert.equal(telemetrySignal({ ...measured, snrX10: undefined }, "snr"), undefined);
});

test("firmware unavailable battery label overrides numeric zero fallback", () => {
	const unknown = sample({ bat: "BAT --", pct: 0, mv: 0 });
	assert.equal(telemetryBattery(unknown), undefined);
	assert.equal(telemetryVoltage(unknown), undefined);
	assert.equal(reportedLabel(unknown.bat), "Not reported");
	const empty = sample({ bat: "BAT 0%", pct: 0, mv: 3000 });
	assert.equal(telemetryBattery(empty), 0);
	assert.equal(telemetryVoltage(empty), 3);
	assert.equal(telemetryBattery(sample({ bat: "BAT 87%" })), 87);
});

test("absent telemetry scalars and malformed JSON bodies never become readings", () => {
	const missing = sample({});
	assert.equal(missing.frames, undefined);
	assert.equal(missing.rssiX10, undefined);
	assert.equal(missing.snrX10, undefined);
	for (const body of ["null", "[]", "42", "true", '"text"']) {
		assert.equal(parseLskLine(`LSK T ${body}`), undefined);
	}
});
