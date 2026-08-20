// Self-check: node --import tsx --test src/lib/shelby.test.ts
//
// The anchor field of an upload response is the client's only word on whether
// a freshly published capture is vouched for on-chain (UI-002). The parser
// must keep three promises: a well-formed anchor comes through typed, a
// malformed or absent one reads as "not anchored" rather than crashing the
// publish, and a failed/skipped anchor keeps its reason so the UI can say why.
import assert from "node:assert";
import test from "node:test";
import { aptosExplorerTxn, parsePublishAnchor } from "./shelby.ts";

const PUBLISHER =
	"0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728";
const TX = "0x5c56d7bfce7c45a7d16c242a45e9d7f9711511fd4b3fd8f1f152dfaac1a73aee";

test("anchored response parses with txHash and publisher", () => {
	const a = parsePublishAnchor({
		status: "anchored",
		txHash: TX,
		publisher: PUBLISHER,
		alreadyAnchored: false,
	});
	assert.deepStrictEqual(a, {
		status: "anchored",
		txHash: TX,
		publisher: PUBLISHER,
		alreadyAnchored: false,
	});
});

test("already-anchored dedupe carries a null txHash", () => {
	const a = parsePublishAnchor({
		status: "anchored",
		txHash: null,
		publisher: PUBLISHER,
		alreadyAnchored: true,
	});
	assert.ok(a && a.status === "anchored");
	assert.strictEqual(a.txHash, null);
	assert.strictEqual(a.alreadyAnchored, true);
});

test("failed and skipped anchors keep their reasons", () => {
	assert.deepStrictEqual(
		parsePublishAnchor({ status: "failed", reason: "fullnode HTTP 503" }),
		{ status: "failed", reason: "fullnode HTTP 503" },
	);
	assert.deepStrictEqual(
		parsePublishAnchor({ status: "skipped", reason: "no key" }),
		{ status: "skipped", reason: "no key" },
	);
	// A reason is owed even when the server forgot to send one.
	assert.deepStrictEqual(parsePublishAnchor({ status: "skipped" }), {
		status: "skipped",
		reason: "no reason given",
	});
});

test("absent or malformed anchors read as not-anchored, not as errors", () => {
	assert.strictEqual(parsePublishAnchor(undefined), undefined);
	assert.strictEqual(parsePublishAnchor(null), undefined);
	assert.strictEqual(parsePublishAnchor("anchored"), undefined);
	assert.strictEqual(parsePublishAnchor({ status: "unknown" }), undefined);
	// anchored without a publisher is not evidence of anything
	assert.strictEqual(
		parsePublishAnchor({ status: "anchored", txHash: TX }),
		undefined,
	);
});

test("explorer txn link targets shelbynet via the custom-network form", () => {
	const url = aptosExplorerTxn(TX);
	assert.ok(url.startsWith(`https://explorer.aptoslabs.com/txn/${TX}?`));
	assert.ok(url.includes("network=custom"));
	assert.ok(
		url.includes(encodeURIComponent("https://api.shelbynet.aptoslabs.com/v1")),
	);
});
