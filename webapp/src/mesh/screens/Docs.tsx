import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t, useLangTick } from "../i18n";

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
	useLangTick();
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
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "minmax(180px, 240px) minmax(0, 1fr)",
				gap: 8,
				minHeight: 0,
				flex: 1,
			}}
		>
			<div className="panel" style={{ alignSelf: "start" }}>
				<div className="panel-title">
					<span>{t("DOCUMENTACIÓN")}</span>
				</div>
				<div style={{ display: "flex", flexDirection: "column", maxHeight: "62vh", overflowY: "auto" }}>
					{docs.map((d) => (
						<button
							key={d.id}
							type="button"
							onClick={() => open(d)}
							aria-selected={current?.id === d.id}
							style={{
								textAlign: "left",
								background: current?.id === d.id ? "var(--glow)" : undefined,
							}}
						>
							{d.title}
						</button>
					))}
				</div>
			</div>

			<div className="panel" style={{ minHeight: 0 }}>
				<div className="panel-title">
					<span>{current?.title ?? "DOCS"}</span>
					{current && (
						<span className="dim" style={{ marginLeft: "auto" }}>
							{current.source}
						</span>
					)}
				</div>
				<div
					className="docs-body"
					style={{ padding: "4px 16px 16px", maxHeight: "62vh", overflowY: "auto", fontSize: 13 }}
				>
					{error && <span className="err">{t("NO SE PUDO CARGAR: {0}", error)}</span>}
					{!error && !text && <span className="dim">{t("CARGANDO…")}</span>}
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
							}}
						>
							{text}
						</ReactMarkdown>
					)}
				</div>
			</div>
		</div>
	);
}
