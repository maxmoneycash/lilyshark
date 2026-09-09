export interface DocEntry {
	id: string;
	title: string;
	path: string;
	source: string;
}

export interface DocLocation {
	id: string;
	section: string;
}

export function readDocLocation(hash: string): DocLocation {
	const query = new URLSearchParams(hash.split("?")[1] ?? "");
	return { id: query.get("doc") ?? "", section: query.get("section") ?? "" };
}

export function docHash(id: string, section = ""): string {
	const query = new URLSearchParams({ doc: id });
	if (section) query.set("section", section);
	return `#docs?${query}`;
}

export function docsHref(id: string, section = ""): string {
	return `/${docHash(id, section)}`;
}

export function isDocsHash(hash: string): boolean {
	return hash.split("?")[0].toLowerCase() === "#docs";
}

/** Empty or unknown `?doc=` hashes fall back to the first published document. */
export function resolveDocLocation(
	hash: string,
	docs: DocEntry[],
): DocLocation {
	const location = readDocLocation(hash);
	if (!docs.length || docs.some((doc) => doc.id === location.id))
		return location;
	return { id: docs[0].id, section: "" };
}

export function headingSection(id: string | undefined): string {
	return id?.startsWith("docs-") ? id.slice(5) : "";
}

/** Resolve links against their repository location, not the published folder. */
export function resolveDocLink(
	href: string,
	current: DocEntry,
	docs: DocEntry[],
): { doc?: DocEntry; section?: string; url: string } {
	if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return { url: href };
	const repoUrl = new URL(href, `https://docs.local/${current.source}`);
	let section = repoUrl.hash.slice(1);
	try {
		section = decodeURIComponent(section);
	} catch {
		/* Keep malformed fragments literal. */
	}
	let source = repoUrl.pathname.slice(1);
	try {
		source = decodeURI(source);
	} catch {
		/* Leave malformed paths to the browser. */
	}
	const target = docs.find((doc) => doc.source === source);
	if (target)
		return { doc: target, section, url: `/${docHash(target.id, section)}` };

	// Unpublished Markdown remains available in the repository. Images and
	// other published assets retain their path beside the rendered document.
	if (/\.md$/i.test(repoUrl.pathname)) {
		return {
			url: `https://github.com/maxmoneycash/lilyshark/blob/main${repoUrl.pathname}${repoUrl.hash}`,
		};
	}
	const published = new URL(href, `https://docs.local${current.path}`);
	return { url: published.pathname + published.search + published.hash };
}

interface MarkdownNode {
	type: string;
	value?: string;
	alt?: string;
	children?: MarkdownNode[];
	data?: { hProperties?: Record<string, unknown>; [key: string]: unknown };
}

function headingText(node: MarkdownNode): string {
	return (
		node.value ?? node.alt ?? node.children?.map(headingText).join("") ?? ""
	);
}

/** Give Markdown headings stable anchors, including inline code and repeats. */
export function remarkDocHeadings() {
	return (tree: MarkdownNode) => {
		const used = new Set<string>();
		const walk = (node: MarkdownNode) => {
			if (node.type === "heading") {
				const base = headingText(node)
					.toLowerCase()
					.replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
					.replace(/ /g, "-");
				let slug = base;
				let duplicate = 0;
				while (used.has(slug)) slug = `${base}-${++duplicate}`;
				used.add(slug);
				node.data = {
					...node.data,
					hProperties: {
						...node.data?.hProperties,
						id: `docs-${slug}`,
						tabIndex: -1,
					},
				};
			}
			node.children?.forEach(walk);
		};
		walk(tree);
	};
}
