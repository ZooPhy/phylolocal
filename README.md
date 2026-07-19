# PhyloLocal

PhyloLocal is a local-first, browser-based phylogenetic tree viewer for Auspice v2 JSON and Newick datasets. It is an initial MVP rather than a full Auspice replacement.

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

## Current capabilities

- Load Auspice v2 JSON or Newick (`.nwk`, `.newick`, `.tree`, `.tre`) with a file picker or drag-and-drop.
- Validate the top-level dataset and every tree node before rendering.
- Switch between a rooted rectangular tree and an unrooted equal-angle view.
- Use divergence, numeric date, or branch depth for branch positioning and scale.
- Ladderize sibling clades by increasing or decreasing descendant-tip count, or restore input order.
- Pan, wheel-zoom, use zoom buttons, and fit the complete tree to the viewport without shrinking its horizontal span unnecessarily.
- Color horizontal branches and tip markers by categorical `node_attrs` metadata.
- Keep colored tip markers readable at every zoom level.
- Search tip names and highlight each matching tip's ancestral path without washing out the rest of the tree.
- Select tips or internal nodes to inspect attributes and descendant counts.
- Export the complete current tree as a standalone SVG.
- Use a bundled synthetic 17-tip dataset for immediate testing.
- Hide dense labels automatically while keeping matches and selections readable.

## Visibility behavior

In the rooted view, coloring is applied to horizontal branch segments and tip markers. Vertical connectors remain neutral because a single connector can join children with different metadata values. In the unrooted view, each edge inherits the child node's color. Search mode emphasizes matching paths but keeps non-matching branch colors visible. The **Clear** control beside an active search restores full contrast immediately.

Tip markers and visible labels use screen-space sizing, so they remain legible when a large tree is fitted into the viewport. Rooted layouts automatically compress row spacing to the available height while retaining most of the horizontal plotting area. When tips are too tightly packed, ordinary labels are hidden until you zoom in; matching and selected labels remain visible.

The increasing/decreasing controls only reorder sibling clades according to descendant-tip count. They do not alter topology, branch lengths, node metadata, or the input root. The unrooted view suppresses the root marker and uses the input root only as an equal-angle layout anchor; it does not statistically infer or relocate a root.

## Supported input

### Auspice v2 JSON

The viewer accepts a JSON object containing:

```json
{
  "version": "v2",
  "meta": {
    "title": "Example dataset",
    "colorings": [
      {"key": "region", "title": "Region", "type": "categorical"}
    ]
  },
  "tree": {
    "name": "ROOT",
    "node_attrs": {
      "div": 0,
      "num_date": {"value": 2020.0}
    },
    "children": []
  }
}
```

Every node must have a non-empty `name` and an object named `node_attrs`. The renderer uses `node_attrs.div` for divergence, `node_attrs.num_date.value` for dates, and other scalar attributes for coloring and details. A top-level tree array is accepted, but only its first tree is rendered.

### Newick

Plain Newick trees are accepted from `.nwk`, `.newick`, `.tree`, and `.tre` files. The parser supports:

- Rooted or unrooted topology encoded in standard Newick syntax.
- Branch lengths, including scientific notation.
- Internal-node labels, support values, polytomies, quoted labels, and whitespace.
- Square-bracket Newick comments; these are ignored with a visible dataset note.
- Files without a final semicolon, with a warning.

Branch lengths are converted to cumulative root-to-node divergence values for the divergence axis. When no branch lengths are present, the viewer automatically uses branch depth. Unnamed internal nodes and tips receive generated names.

Newick itself does not carry the Auspice metadata model, so categorical coloring and numeric dates are unavailable unless the tree is supplied as Auspice JSON. Raw FASTA sequences, NEXUS containers, metadata-table joins, maps, frequencies, narratives, and phylogenetic inference are not included in this milestone.

## Project structure

```text
index.html                 Interface shell
styles.css                 Responsive interface and SVG styling
src/app.js                 Browser state, D3 rendering, interactions, file I/O
src/phylo-core.js          JSON/Newick parsing, validation, tree model, layout, search, coloring
src/demo-data.js           Synthetic Auspice v2 example
examples/                   Importable JSON and Newick examples
vendor/                    Minimal local D3 ES modules
server.mjs                 Loopback-only static server
CHANGELOG.md                Release notes and fixes
tests/                     Node unit tests and Chromium smoke test
```

The tree model and layout are implemented separately from browser rendering, which keeps them directly testable and leaves room for a future Canvas renderer or Web Worker.

## Tests

Run core unit tests:

```bash
npm test
```

Run the full browser smoke test when Python Playwright and Chromium are available:

```bash
npm run smoke
```

Set `CHROMIUM_PATH=/path/to/chromium` when Chromium is not on the command path and Playwright has no bundled browser.

## Privacy and security boundaries

- Dataset files are read with the browser File API and held in memory.
- There is no upload route or application backend.
- The included server listens on loopback only, not on the LAN.
- All JavaScript and D3 modules are bundled in the folder.
- The page's Content Security Policy blocks remote connections and remote assets.
- A 100 MB file-size guard and a 200,000-node validation guard reduce accidental browser exhaustion. These are practical safeguards, not a formal security sandbox.

## License

Project code is MIT licensed. Vendored D3 modules use the ISC license; see `THIRD_PARTY_NOTICES.md`.
