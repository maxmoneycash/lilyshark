import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
	docHash,
	docsHref,
	headingSection,
	isDocsHash,
	readDocLocation,
	remarkDocHeadings,
	resolveDocLink,
	resolveDocLocation,
} from "./docNavigation";

const pointer = {
	id: "pointer",
	title: "Pointer format",
	source: "docs/pointer.md",
	path: "/docs/pointer.md",
};
const analysis = {
	id: "analysis",
	title: "Analysis",
	source: "analysis/results.md",
	path: "/docs/analysis/results.md",
};
const entries = [pointer, analysis];

test("document and section routes survive reloads and browser history", () => {
	assert.deepEqual(readDocLocation(docHash("pointer", "encoding-rules")), {
		id: "pointer",
		section: "encoding-rules",
	});
	assert.deepEqual(readDocLocation("#docs"), { id: "", section: "" });
	assert.deepEqual(readDocLocation(docHash("a & b", "signal-μv")), {
		id: "a & b",
		section: "signal-μv",
	});
	assert.equal(
		docsHref("pointer", "encoding-rules"),
		"/#docs?doc=pointer&section=encoding-rules",
	);
	assert.deepEqual(resolveDocLocation("#docs", entries), {
		id: "pointer",
		section: "",
	});
	assert.deepEqual(resolveDocLocation(docHash("missing", "layout"), entries), {
		id: "pointer",
		section: "",
	});
	assert.deepEqual(resolveDocLocation(docHash("analysis", "signal"), entries), {
		id: "analysis",
		section: "signal",
	});
	assert.equal(headingSection("docs-encoding-rules"), "encoding-rules");
	assert.equal(headingSection("docs-signal-μv"), "signal-μv");
	assert.equal(headingSection(undefined), "");
	assert.equal(isDocsHash("#docs"), true);
	assert.equal(isDocsHash(docHash("pointer", "layout")), true);
	assert.equal(isDocsHash("#traffic"), false);
	assert.equal(isDocsHash("#paper"), false);
});

test("same-document anchors stay in the docs viewer", () => {
	assert.deepEqual(resolveDocLink("#encoding-rules", pointer, entries), {
		doc: pointer,
		section: "encoding-rules",
		url: "/#docs?doc=pointer&section=encoding-rules",
	});
});

test("cross-document anchors resolve from repository paths rather than published folders", () => {
	assert.deepEqual(
		resolveDocLink("../analysis/results.md#signal", pointer, entries),
		{
			doc: analysis,
			section: "signal",
			url: "/#docs?doc=analysis&section=signal",
		},
	);
	assert.equal(
		resolveDocLink("../docs/pointer.md", analysis, entries).doc,
		pointer,
	);
});

test("published chart paths and external links retain their destinations", () => {
	assert.equal(
		resolveDocLink("chart.svg", analysis, entries).url,
		"/docs/analysis/chart.svg",
	);
	assert.equal(
		resolveDocLink("https://example.com/a#b", analysis, entries).url,
		"https://example.com/a#b",
	);
	assert.equal(
		resolveDocLink("//example.com/a", analysis, entries).url,
		"//example.com/a",
	);
	assert.equal(
		resolveDocLink("mailto:radio@example.com", analysis, entries).url,
		"mailto:radio@example.com",
	);
});

test("unpublished repository documents open their source instead of a missing local file", () => {
	assert.equal(
		resolveDocLink("../README.md#project-status", pointer, entries).url,
		"https://github.com/maxmoneycash/lilyshark/blob/main/README.md#project-status",
	);
	assert.doesNotThrow(() => resolveDocLink("bad%.md#bad%", pointer, entries));
});

test("rendered headings support inline markup, duplicate names, and Unicode anchors", () => {
	const markdown =
		"## Encoding `SHLB` rules\n\n## Encoding SHLB rules\n\n## Signal (μV)\n\n## Encoding SHLB rules-1\n\n## Encoding SHLB rules";
	const html = renderToStaticMarkup(
		createElement(ReactMarkdown, {
			remarkPlugins: [remarkDocHeadings],
			children: markdown,
		}),
	);
	const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(ids, [
		"docs-encoding-shlb-rules",
		"docs-encoding-shlb-rules-1",
		"docs-signal-μv",
		"docs-encoding-shlb-rules-1-1",
		"docs-encoding-shlb-rules-2",
	]);
	assert.match(html, /tabindex="-1"/);
});
