const fs = require('fs');
let css = fs.readFileSync('src/mesh/meshterm.css', 'utf8');

css = css.replace(
  /\@media \(max-width: 860px\) \{[\s\S]*?\}\s*\}\s*@/g,
  (match) => match.replace(
    /grid-template-areas: "device" "copy" "progress";/,
    'grid-template-areas: "copy" "progress";'
  )
);
fs.writeFileSync('src/mesh/meshterm.css', css);
