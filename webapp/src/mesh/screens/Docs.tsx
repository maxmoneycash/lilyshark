import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * DOCS — the repository's documentation, published into the app.
 *
 * scripts/sync_docs_to_webapp.py copies the docs set into public/docs/ with a
 * manifest; this screen renders it. Inter-document links are resolved against
 * each doc's *repository* location (the manifest records it), so the same
 * relative links that work on GitHub work here; chart images resolve against
 * the published path.
 */

interface DocEntry {
	id: string;
	title: string;
	path: string;
	source: string;
}

/** Resolve "a/../b" and "./b" path segments without touching the filesystem. */
function normalizePath(p: string): string {
	const out: string[] = [];
	for (const seg of p.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") out.pop();
		else out.push(seg);
	}
	return "/" + out.join("/");
}

function resolveLink(
	href: string,
	current: DocEntry,
	docs: DocEntry[],
): { doc?: DocEntry; url: string } {
	if (/^(https?:|mailto:|#)/.test(href)) return { url: href };
	const [pathOnly, frag] = href.split("#");
	const suffix = frag ? `#${frag}` : "";

	// Links in the markdown are written relative to the doc's repo location.
	const srcBase = current.source.split("/").slice(0, -1).join("/");
	const repoAbs = normalizePath(`${srcBase}/${pathOnly}`).slice(1);
	const target = docs.find((d) => d.source === repoAbs);
	if (target) return { doc: target, url: target.path + suffix };

	// Otherwise it is an asset published next to the doc (charts, images).
	const pubBase = current.path.split("/").slice(0, -1).join("/");
	return { url: normalizePath(`${pubBase}/${pathOnly}`) + suffix };
}

export default function Docs() {
	const [docs, setDocs] = useState<DocEntry[]>([]);
	const [current, setCurrent] = useState<DocEntry | null>(null);
	const [text, setText] = useState<string>("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch("/docs/manifest.json")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<DocEntry[]>;
			})
			.then((list) => {
				setDocs(list);
				setCurrent(list[0] ?? null);
			})
			.catch((e) => setError(String(e)));
	}, []);

	useEffect(() => {
		if (!current) return;
		setText("");
		setError(null);
		fetch(current.path)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.text();
			})
			.then(setText)
			.catch((e) => setError(String(e)));
	}, [current]);

	const open = (doc: DocEntry) => {
		setCurrent(doc);
	};

	return (
		<div className="docs-grid">
			<div className="panel docs-nav-panel">
				<div className="panel-title">
					<span>DOCUMENTATION</span>
				</div>
				<nav className="docs-nav">
					{docs.map((d) => (
						<button
							key={d.id}
							type="button"
							onClick={() => open(d)}
							aria-selected={current?.id === d.id}
							className={current?.id === d.id ? "is-current" : undefined}
						>
							{d.title}
						</button>
					))}
				</nav>
			</div>

			<div className="panel docs-doc-panel">
				<div className="panel-title">
					<span>{current?.title ?? "DOCS"}</span>
					{current && (
						<span className="dim" style={{ marginLeft: "auto" }}>
							{current.source}
						</span>
					)}
				</div>
				<div className="docs-scroll">
					<div className="docs-body">
					{error && <span className="err">COULD NOT LOAD: {error}</span>}
					{!error && !text && <span className="dim">LOADING…</span>}
					{text && current && (
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							components={{
								a: ({ href, children }) => {
									const { doc, url } = resolveLink(href ?? "", current, docs);
									return (
										<a
											href={url}
											onClick={(e) => {
												if (doc) {
													e.preventDefault();
													open(doc);
												}
											}}
											{...(doc ? {} : { target: "_blank", rel: "noreferrer" })}
										>
											{children}
										</a>
									);
								},
								img: ({ src, alt }) => {
									const { url } = resolveLink(String(src ?? ""), current, docs);
									return (
										<img
											src={url}
											alt={alt ?? ""}
											style={{ maxWidth: "100%", border: "1px solid var(--border)" }}
										/>
									);
								},
								// A wide comparison table must scroll in its own box rather
								// than stretching the prose column past a readable measure.
								table: ({ children }) => (
									<div className="docs-table-wrap">
										<table>{children}</table>
									</div>
								),
							}}
						>
							{text}
						</ReactMarkdown>
					)}
					</div>
				</div>
			</div>
		</div>
	);
}
