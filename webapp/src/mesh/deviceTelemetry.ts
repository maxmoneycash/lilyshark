import type { DeviceTelemetry } from "../lib/deviceLink";
import { RF_FIELD } from "../lib/lscap";

export function telemetryCount(value: number | undefined): number | undefined {
	return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** These counters cover rejected analyzer records. They are not guaranteed
 * to share the radio receive counter's lifetime, so do not subtract from RX. */
export function unattributedFrames(sample: DeviceTelemetry): number | undefined {
	const counts = [sample.dropCrc, sample.dropMalformed, sample.dropNoSource].map(telemetryCount);
	return counts.every((n) => n !== undefined)
		? (counts as number[]).reduce((sum, count) => sum + count, 0) : undefined;
}

/** Firmware sends zero-valued RF members for unmeasured and transmitted
 * frames too. Only the presence mask and receive direction certify a value. */
export function telemetrySignal(sample: DeviceTelemetry, field: "rssi" | "snr"): number | undefined {
	if (sample.direction !== 1 || sample.presentFields === undefined ||
		(sample.presentFields & RF_FIELD[field]) === 0) return undefined;
	const value = field === "rssi" ? sample.rssiX10 : sample.snrX10;
	return value !== undefined && Number.isFinite(value) ? value / 10 : undefined;
}

export function batteryUnavailable(sample: DeviceTelemetry): boolean {
	return /^BAT\s*(?:--|—|N\/A|NOT REPORTED)$/i.test(sample.bat.trim());
}

export function telemetryBattery(sample: DeviceTelemetry): number | undefined {
	if (batteryUnavailable(sample)) return undefined;
	const match = sample.bat.match(/(\d+)\s*%/);
	const value = sample.pct ?? (match ? Number(match[1]) : undefined);
	return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

export function telemetryVoltage(sample: DeviceTelemetry): number | undefined {
	return !batteryUnavailable(sample) && sample.mv !== undefined &&
		Number.isFinite(sample.mv) && sample.mv >= 0 ? sample.mv / 1000 : undefined;
}

export function reportedLabel(value: string | undefined): string {
	const label = value?.trim();
	return !label || /^(?:BAT\s*)?(?:--|—|N\/A)$/i.test(label) ? "Not reported" : label;
}
