# PhyloLocal roadmap

## Completed

- Local Auspice v2 JSON and Newick import.
- Rooted and unrooted layouts.
- Metadata coloring, search, ladderization, details, zoom, and SVG export.
- Reassortment Radar Lite: two-tree matching, nearest-neighbor discordance scoring, ranked candidates, synchronized highlighting, connector view, and CSV export.

## Next

1. **Sample-name mapping rules**
   - Optional regular-expression cleanup for segment-specific suffixes and inconsistent naming.
   - A preview table before matching.

2. **Multi-segment Radar**
   - Load all eight influenza segment trees.
   - Pairwise discordance matrix and genomic-constellation fingerprint.
   - Per-sample segment clustering and export.

3. **Uncertainty-aware screening**
   - Load posterior tree sets.
   - Repeat neighborhood analysis across sampled trees.
   - Display score intervals and support-weighted candidates.

4. **Large-tree performance**
   - Web Worker for parsing and pairwise calculations.
   - Hybrid Canvas/SVG rendering.
   - Progressive results for large comparisons.

5. **Metadata joins and filters**
   - Local CSV/TSV metadata import.
   - Filter by host, location, flyway, collection date, or clade.
