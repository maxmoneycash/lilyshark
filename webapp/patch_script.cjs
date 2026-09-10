const fs = require('fs');
let css = fs.readFileSync('src/mesh/meshterm.css', 'utf8');

css = css.replace(
  /\.meshterm \.intro-stage \{[\s\S]*?\n\}/,
  `.meshterm .intro-stage {
	position: sticky;
	top: 0;
	height: var(--intro-height, calc(100% / var(--intro-n, 6)));
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	grid-template-rows: minmax(0, 1fr) auto;
	grid-template-areas: "copy" "progress";
	align-items: stretch;
	gap: 20px;
	width: 100%;
	max-width: 1440px;
	margin-inline: auto;
	padding: 0 clamp(24px, 5vw, 72px) 20px;
	overflow: hidden;
}`
);

css = css.replace(
  /\.meshterm \.intro-copy \{[\s\S]*?\n\}/,
  `.meshterm .intro-copy {
	position: relative;
	grid-area: copy;
	min-width: 0;
	min-height: 0;
	width: 100%;
	max-width: 520px;
	max-height: 100%;
	align-self: center;
	overflow-y: auto;
	overflow-x: hidden;
	scrollbar-width: thin;
	scrollbar-color: var(--border) transparent;
	z-index: 10;
	pointer-events: none;
}
.meshterm .intro-copy * { pointer-events: auto; }`
);

css = css.replace(
  /\.meshterm \.intro-device \{[\s\S]*?\n\}/,
  `.meshterm .intro-device {
	position: absolute;
	inset: 0;
	z-index: 0;
	touch-action: none;
	pointer-events: none;
}
.meshterm .intro-device * {
	pointer-events: auto;
}`
);

fs.writeFileSync('src/mesh/meshterm.css', css);
