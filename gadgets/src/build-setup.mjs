import { validateBuildProjects } from './build-projects.mjs';
import { normalizeKit } from './kits.mjs';

// This is our planning template, derived from a credited external guide. The
// guide author is provenance, not the person who submitted a gadgets.sh setup.
export function buildSetupFromProject(value, devices) {
  const { projects, errors } = validateBuildProjects([value], devices);
  if (errors.length) throw new Error(`Cannot prepare this guide's setup: ${errors.join(' ')}`);
  const project = projects[0];
  const credit = `Original guide by ${project.author}`;
  const parts = `Also required (check original guide):\n${project.otherRequired.join('\n')}`;
  const note = `Core hardware only. ${project.variantNotes}`;
  const planningNote = 'Planning template; not reproduced by gadgets.sh.';
  const story = `${planningNote}\n${project.summary}`;
  const kit = normalizeKit({
    name: project.title,
    author: 'gadgets.sh',
    from: credit,
    origin: credit,
    story: story.length <= 500 ? story : `${planningNote} Check the original guide for the complete build.`,
    project: project.guideURL,
    parts,
    devices: project.coreCatalogSlugs,
    items: Object.fromEntries(project.coreCatalogSlugs.map(slug => [slug, {
      quantity: project.coreQuantities[slug],
      state: 'considering',
      note,
    }])),
  }, devices);

  // Guide URLs have a larger budget than setup URLs. Reject an unsupported
  // handoff instead of silently stripping the only complete source link.
  if (!kit.project) throw new Error('This guide URL does not fit a setup source link.');

  // A clipped requirements list or revision restriction can change its meaning.
  // Keep complete fields when they fit; otherwise direct readers to the source.
  if (kit.parts !== parts) kit.parts = 'Core parts only. Check the original guide for every accessory, software requirement and hardware revision.';
  for (const item of Object.values(kit.items)) {
    if (item.note !== note) item.note = 'Core hardware only. Check the original guide for exact variants and revisions.';
  }
  if (kit.from !== credit) {
    kit.from = kit.origin = 'Original guide (full author credit in notes)';
    kit.story = `Source guide by ${project.author}.\n${planningNote} Follow the linked guide for the complete build.`;
  }
  return kit;
}
