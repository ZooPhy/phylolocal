# PhyloLocal

![PhyloLocal logo](assets/phylolocal_logo_modern.jpg)

PhyloLocal is a local-first, browser-based phylogenetic tree viewer for Auspice v2 JSON and Newick datasets. Version 0.4 adds **Reassortment Radar**, an automated two-segment comparison that ranks samples by changes in their local phylogenetic neighborhoods.

The viewer does not upload data, request remote assets, require an account, or depend on a remote API. A tiny Node server binds only to `127.0.0.1` and serves static files to the browser.

## Start it

Node.js 18 or newer is required. No package installation or build step is needed.

```bash
cd local-phylo-viewer
npm start
```

Open the displayed loopback address, normally `http://127.0.0.1:4173`.

A different port can be selected with:

```bash
node server.mjs --port 8080
```

The project is also a static site and can be published directly with GitHub Pages.

## Tree viewer

- Load Auspice v2 JSON or Newick (`.nwk`, `.newick`, `.tree`, `.tre`) with a file picker or drag-and-drop.
- Validate the dataset and tree nodes before rendering.
- Switch between rooted rectangular and unrooted equal-angle views.
- Use divergence, numeric date, or branch depth for positioning.
- Ladderize by increasing/decreasing descendant-tip count or restore input order.
- Color branches and tips by categorical Auspice metadata.
- Search tips and highlight their ancestral paths.
- Inspect tip/internal-node details.
- Pan, zoom, fit, and export SVG.

## Reassortment Radar

A focal tip is never counted as its own neighbor. Therefore, a comparison with 10 shared tips can use at most 9 neighbors per tip; the selector automatically adapts to the available maximum.

Shared tip names must identify the isolate or sample and therefore should be the same across segment trees. Put the segment identity in the filename (for example, `HA.nwk` and `NA.nwk`), not in the tip name. PhyloLocal infers common influenza segment names from filenames and displays them above each tree.

Open **Reassortment Radar** from the top navigation and load two segment trees. The files may be Newick or Auspice JSON, but tips must use the same exact sample names in both trees.

For each shared tip, PhyloLocal:

1. Calculates patristic distances to the other shared tips in each tree. Newick branch lengths or Auspice divergence are used when available; branch depth is the fallback.
2. Selects the tip's `k` nearest neighbors in each tree.
3. Calculates the [Jaccard distance](https://en.wikipedia.org/wiki/Jaccard_index){:target="_blank"} between the two neighbor sets:

```text
score = 1 - |neighbors A ∩ neighbors B| / |neighbors A ∪ neighbors B|
```

A score near 0 indicates a stable local neighborhood. A score near 1 indicates strong phylogenetic discordance between segment trees.

Radar provides:

- Score-colored connectors between matched tips.
- Crossing connectors that make clade jumps visually apparent.
- A ranked candidate list and adjustable score threshold.
- Synchronized selection and ancestral-path highlighting in both trees.
- Tree-specific and shared nearest-neighbor lists.
- CSV export of all scores and neighbor sets.
- A bundled demonstration in which two tips exchange neighborhoods.

### Scientific interpretation

Radar results should be described as **candidate phylogenetic discordance consistent with reassortment**, not confirmed reassortment. Sampling differences, weak phylogenetic signal, alignment problems, rooting, and tree uncertainty can also change nearest-neighbor sets. This first implementation analyzes one point-estimate tree per segment and does not yet propagate phylogenetic uncertainty.

## Supported input

### Auspice v2 JSON

The viewer accepts a JSON object with `version`, `meta`, and a nested `tree`. Every node must have a non-empty `name` and an object named `node_attrs`. `node_attrs.div` is used for divergence, `node_attrs.num_date.value` for dates, and scalar attributes for coloring.

### Newick

The parser supports branch lengths, scientific notation, internal labels/support values, polytomies, quoted labels, whitespace, and square-bracket comments. Comments are ignored with a visible note. Files without a final semicolon are accepted with a warning.

Newick does not itself provide categorical Auspice metadata. Raw FASTA sequences, NEXUS containers, alignment, tree inference, and ancestral-state reconstruction are outside the current application.

## Project structure

```text
index.html                    Interface shell and both application modes
styles.css                    Responsive interface and SVG styling
assets/                       Supplied logo and derived application icon
src/app.js                    Main tree-viewer state and rendering
src/phylo-core.js             Parsing, validation, tree model, layouts, search, coloring
src/radar-app.js              Reassortment Radar interface and paired-tree rendering
src/reassortment-core.js      Tip matching, patristic neighborhoods, scoring, CSV output
src/radar-demo.js             Bundled discordant demonstration pair
examples/                     Importable JSON and Newick examples
vendor/                       Minimal local D3 ES modules
server.mjs                    Loopback-only static server
tests/                        Node unit tests and Chromium browser regression suite
```

## Tests

```bash
npm test
npm run smoke
npm run check
```

The optional browser test requires Python Playwright and Chromium. Set `CHROMIUM_PATH=/path/to/chromium` when needed.

## Privacy and safety boundaries

- Files are read with the browser File API and held in memory.
- There is no upload route or application backend.
- The included server listens on loopback only.
- JavaScript and D3 modules are bundled locally.
- The Content Security Policy blocks remote connections and remote assets.
- File and node-count guards reduce accidental browser exhaustion.
- Reassortment Radar currently limits a comparison to 3,000 shared tips because the nearest-neighbor calculation is pairwise.

## License

Project code is MIT licensed. Vendored D3 modules use the ISC license; see `THIRD_PARTY_NOTICES.md`.

Matched-sample search selects and highlights shared samples independently of the candidate threshold.
