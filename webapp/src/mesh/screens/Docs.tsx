import {
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	type DocEntry,
	docHash,
	docsHref,
	headingSection,
	isDocsHash,
	readDocLocation,
	remarkDocHeadings,
	resolveDocLink,
	resolveDocLocation,
} from "./docNavigation";
import "./docs.css";

/** Update edge cues after document loads, image loads, and resizing. */
function useScrollEdges(ref: RefObject<HTMLElement>) {
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => {
			element.dataset.scrollEdges = [
				element.scrollTop > 1 && "top",
				element.scrollTop + element.clientHeight < element.scrollHeight - 1 &&
					"bottom",
				element.scrollLeft > 1 && "left",
				element.scrollLeft + element.clientWidth < element.scrollWidth - 1 &&
					"right",
			]
				.filter(Boolean)
				.join(" ");
		};
		const resize = new ResizeObserver(update);
		const observeChildren = () => {
			resize.disconnect();
			resize.observe(element);
			for (const child of element.children) resize.observe(child);
			update();
		};
		const mutation = new MutationObserver(observeChildren);
		mutation.observe(element, { childList: true, subtree: true });
		element.addEventListener("scroll", update, { passive: true });
		observeChildren();
		return () => {
			resize.disconnect();
			mutation.disconnect();
			element.removeEventListener("scroll", update);
		};
	}, [ref]);
}

function WideContent({
	children,
	code = false,
}: {
	children: ReactNode;
	code?: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useScrollEdges(ref);
	return (
		<div
			ref={ref}
			className={code ? "docs-code-wrap" : "docs-table-wrap"}
			tabIndex={0}
			role="region"
			aria-label={code ? "Code sample" : "Documentation table"}
		>
			{children}
		</div>
	);
}

/** Repository docs published by scripts/sync_docs_to_webapp.py. */
export default function Docs() {
	const [docs, setDocs] = useState<DocEntry[]>([]);
	const [location, setLocation] = useState(() =>
		readDocLocation(window.location.hash),
	);
	const [content, setContent] = useState<{ id: string; text: string } | null>(
		null,
	);
	const [error, setError] = useState<{ id?: string; message: string } | null>(
		null,
	);
	const current = docs.find((doc) => doc.id === location.id) ?? docs[0] ?? null;
	const text = content?.id === current?.id ? content?.text : null;
	const message =
		error && (!error.id || error.id === current?.id) ? error.message : null;
	const scrollRef = useRef<HTMLDivElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const docsRef = useRef(docs);
	docsRef.current = docs;
	useScrollEdges(scrollRef);
	useScrollEdges(navRef);

	useEffect(() => {
		const onHash = () => {
			if (!isDocsHash(window.location.hash)) return;
			const list = docsRef.current;
			const resolved = list.length
				? resolveDocLocation(window.location.hash, list)
				: readDocLocation(window.location.hash);
			if (list.length) {
				const hash = docHash(resolved.id, resolved.section);
				if (window.location.hash !== hash) {
					window.history.replaceState(
						null,
						"",
						docsHref(resolved.id, resolved.section),
					);
				}
			}
			setLocation(resolved);
		};
		window.addEventListener("hashchange", onHash);
		window.addEventListener("popstate", onHash);
		return () => {
			window.removeEventListener("hashchange", onHash);
			window.removeEventListener("popstate", onHash);
		};
	}, []);

	useEffect(() => {
		const request = new AbortController();
		fetch("/docs/manifest.json", { signal: request.signal })
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.json() as Promise<DocEntry[]>;
			})
			.then((list) => {
				if (request.signal.aborted) return;
				setDocs(list);
				if (!list.length) setError({ message: "No documents are available." });
			})
			.catch((failure) => {
				if (!request.signal.aborted)
					setError({
						message: `Could not load the document list. ${failure.message}`,
					});
			});
		return () => request.abort();
	}, []);

	useEffect(() => {
		if (!docs.length || !isDocsHash(window.location.hash)) return;
		const resolved = resolveDocLocation(window.location.hash, docs);
		const hash = docHash(resolved.id, resolved.section);
		if (window.location.hash !== hash) {
			window.history.replaceState(
				null,
				"",
				docsHref(resolved.id, resolved.section),
			);
		}
		setLocation((prev) =>
			prev.id === resolved.id && prev.section === resolved.section
				? prev
				: resolved,
		);
	}, [docs]);

	useEffect(() => {
		if (!current) return;
		const request = new AbortController();
		setError(null);
		fetch(current.path, { signal: request.signal })
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.text();
			})
			.then((value) => {
				if (!request.signal.aborted)
					setContent({ id: current.id, text: value });
			})
			.catch((failure) => {
				if (!request.signal.aborted)
					setError({
						id: current.id,
						message: `Could not load this document. ${failure.message}`,
					});
			});
		return () => request.abort();
	}, [current]);

	useLayoutEffect(() => {
		const viewport = scrollRef.current;
		if (!viewport) return;
		const heading =
			location.section && text != null
				? document.getElementById(`docs-${location.section}`)
				: null;
		if (heading && viewport.contains(heading)) {
			viewport.scrollTop +=
				heading.getBoundingClientRect().top -
				viewport.getBoundingClientRect().top -
				16;
			heading.focus({ preventScroll: true });
		} else {
			viewport.scrollTop = 0;
		}
	}, [location, text]);

	const open = (doc: DocEntry, section = "", replace = false) => {
		const next = { id: doc.id, section };
		setLocation(next);
		const hash = docHash(doc.id, section);
		if (window.location.hash === hash) return;
		const url = docsHref(doc.id, section);
		if (replace) window.history.replaceState(null, "", url);
		else window.history.pushState(null, "", url);
	};

	const heading =
		(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
		({
			children,
			id,
		}: {
			children?: ReactNode;
			id?: string;
			node?: unknown;
		}) => {
			const section = headingSection(id);
			return (
				<Tag id={id} tabIndex={-1}>
					{current && section ? (
						<a
							className="docs-heading-link"
							href={docsHref(current.id, section)}
							onClick={(event) => {
								if (
									event.button ||
									event.metaKey ||
									event.ctrlKey ||
									event.shiftKey ||
									event.altKey
								)
									return;
								event.preventDefault();
								open(current, section);
							}}
						>
							{children}
						</a>
					) : (
						children
					)}
				</Tag>
			);
		};

	return (
		<main className="fill docs-grid">
			<div className="panel docs-nav-panel">
				<div className="panel-title">
					<span>DOCUMENTATION</span>
				</div>
				<div className="docs-mobile-picker">
					{location.section && current ? (
						<button
							type="button"
							className="docs-back"
							onClick={() => open(current, "", true)}
						>
							Back
						</button>
					) : (
						<label htmlFor="docs-mobile-select">Document</label>
					)}
					<select
						id="docs-mobile-select"
						value={current?.id ?? ""}
						disabled={!docs.length}
						onChange={(event) => {
							const doc = docs.find((entry) => entry.id === event.target.value);
							if (doc) open(doc);
						}}
					>
						{!docs.length && (
							<option value="">
								{message ? "Documents unavailable" : "Loading documents…"}
							</option>
						)}
						{docs.map((doc) => (
							<option key={doc.id} value={doc.id}>
								{doc.title}
							</option>
						))}
					</select>
				</div>
				<nav className="docs-nav" ref={navRef} aria-label="Documents">
					{docs.map((doc) => (
						<a
							key={doc.id}
							href={docsHref(doc.id)}
							onClick={(event) => {
								if (
									event.button ||
									event.metaKey ||
									event.ctrlKey ||
									event.shiftKey ||
									event.altKey
								)
									return;
								event.preventDefault();
								open(doc);
							}}
							aria-current={current?.id === doc.id ? "page" : undefined}
							className={current?.id === doc.id ? "is-current" : undefined}
						>
							{doc.title}
						</a>
					))}
				</nav>
			</div>

			<div className="panel docs-doc-panel">
				<div className="panel-title">
					<span>{current?.title ?? "DOCS"}</span>
					{current && <span className="dim docs-source">{current.source}</span>}
				</div>
				<div
					className="docs-scroll"
					ref={scrollRef}
					tabIndex={0}
					role="region"
					aria-label={current?.title ?? "Documentation"}
					aria-busy={!message && text == null}
				>
					<div className="docs-body">
						{message && (
							<p className="err" role="alert">
								{message}
							</p>
						)}
						{!message && text == null && (
							<p className="dim" role="status">
								Loading document…
							</p>
						)}
						{text != null && current && (
							<ReactMarkdown
								remarkPlugins={[remarkGfm, remarkDocHeadings]}
								components={{
									h1: heading("h1"),
									h2: heading("h2"),
									h3: heading("h3"),
									h4: heading("h4"),
									h5: heading("h5"),
									h6: heading("h6"),
									a: ({ href, children }) => {
										const { doc, section, url } = resolveDocLink(
											href ?? "",
											current,
											docs,
										);
										return (
											<a
												href={url}
												onClick={(event) => {
													if (
														!doc ||
														event.button ||
														event.metaKey ||
														event.ctrlKey ||
														event.shiftKey ||
														event.altKey
													)
														return;
													event.preventDefault();
													open(doc, section);
												}}
												{...(doc
													? {}
													: { target: "_blank", rel: "noreferrer" })}
											>
												{children}
											</a>
										);
									},
									img: ({ src, alt }) => (
										<img
											src={resolveDocLink(String(src ?? ""), current, docs).url}
											alt={alt ?? ""}
										/>
									),
									table: ({ children }) => (
										<WideContent>
											<table>{children}</table>
										</WideContent>
									),
									pre: ({ children }) => (
										<WideContent code>
											<pre>{children}</pre>
										</WideContent>
									),
								}}
							>
								{text}
							</ReactMarkdown>
						)}
					</div>
				</div>
			</div>
		</main>
	);
}
