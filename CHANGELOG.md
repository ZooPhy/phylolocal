# Changelog

## 0.4.4 — Jaccard-method link

- Linked the **Jaccard distances** text in Reassortment Radar to the Jaccard index reference page.
- The reference opens in a new browser tab without interrupting the local analysis session.

## 0.4.3 — Neighborhood-size clarity

- The neighbor selector now adapts to the number of shared tips.
- A focal tip is excluded from its own neighborhood, so a comparison with 10 shared tips correctly offers a maximum of 9 neighbors.
- The selected-sample panel now reports both the number used and the maximum possible.
- Added browser regression coverage for automatic clamping and the explanatory UI.

## 0.4.2 — Matched-sample search correction

- The Reassortment Radar search now selects and highlights the best matching shared sample in both trees as the user types.
- Search results are no longer blocked by the candidate-score threshold.
- Added search feedback, a clear button, and Escape-key clearing.
- Samples below the candidate threshold remain explicitly searchable and visibly highlighted.

## 0.4.1 — Segment-label correction

- Corrected the bundled reassortment demo so shared tip labels are sample identifiers (`A`–`J`) rather than incorrectly carrying an `_HA` suffix in both trees.
- Added explicit inferred segment titles such as **HA segment** and **NA segment** above the paired trees.
- Added a status warning when both loaded filenames appear to represent the same segment.
- Added browser regression checks for segment identity and demo tip labels.

## 0.4.0 — Reassortment Radar

- Added **Reassortment Radar**, a two-tree workflow for identifying samples whose local phylogenetic neighborhoods change between segment trees.
- Matches tips by exact sample name and ranks every shared sample using the Jaccard distance between its nearest-neighbor sets.
- Added paired rooted-tree visualization with score-colored connectors, crossing-line clade jumps, synchronized sample selection, and highlighted ancestral paths.
- Added adjustable neighborhood size, candidate threshold, sample search, ranked candidates, and side-by-side neighbor comparison.
- Added CSV export of all discordance scores and Tree A/Tree B neighbor sets.
- Added a bundled discordant demo pair and importable paired Newick examples.
- Added unit and Chromium regression coverage for scoring, matching, thresholding, synchronized highlighting, and CSV export.
- Added the supplied PhyloLocal logo as the default application branding asset and generated an icon crop for the header and favicon.

## 0.3.0 — Newick input

- Added local parsing for `.nwk`, `.newick`, `.tree`, and `.tre` files.
- Preserved topology, labels, support values, polytomies, quoted labels, and branch lengths.
- Added divergence positioning from cumulative Newick branch lengths and branch-depth fallback.
- Added browser and unit tests for Newick import.

## 0.2.0 — Layout controls

- Added rooted and unrooted views.
- Added increasing/decreasing clade-size ladderization and input-order restoration.
- Improved dense-tree fitting without unnecessarily shrinking horizontal branch space.

## 0.1.1 — Coloring fix

- Prevented stylesheet rules from overriding D3-assigned branch and node colors.
- Improved search visibility and added a clear-search button.

## 0.1.0 — Initial MVP

- Added local Auspice v2 JSON import, validation, rooted rendering, metadata coloring, search, node details, zoom, and SVG export.
