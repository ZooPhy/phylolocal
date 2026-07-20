import test from "node:test";
import assert from "node:assert/strict";

import {demoDataset} from "../src/demo-data.js";
import {
  buildTreeModel,
  calculateLayout,
  calculateUnrootedLayout,
  collectColoringOptions,
  decimalYearToDate,
  findSearchMatches,
  formatDecimalYear,
  normalizeDataset,
  orderTree,
  parseDatasetText,
  parseNewick,
  traitValues,
  validateDataset
} from "../src/phylo-core.js";

test("bundled demo is a valid Auspice v2 dataset", () => {
  const result = validateDataset(demoDataset);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.stats.nodeCount, 27);
  assert.equal(result.stats.leafCount, 17);
  assert.equal(result.stats.nodesWithDivergence, 27);
  assert.equal(result.stats.nodesWithDate, 27);
});

test("tree model preserves tip order and descendant counts", () => {
  const model = buildTreeModel(demoDataset.tree);
  assert.equal(model.nodes.length, 27);
  assert.equal(model.leaves.length, 17);
  assert.equal(model.root.descendantTips, 17);
  assert.equal(model.leaves[0].name, "A/USA/001");
  assert.equal(model.leaves.at(-1).name, "C/CAN/017");
  assert.ok(model.nodes.every((node) => node.isLeaf || node.descendantTips > 1));
});

test("divergence and date layouts keep children at or to the right of parents", () => {
  const model = buildTreeModel(demoDataset.tree);
  for (const mode of ["divergence", "date", "depth"]) {
    const layout = calculateLayout(model, {mode, width: 1100, viewportHeight: 600});
    assert.equal(layout.mode, mode);
    assert.ok(layout.ticks.length >= 2);
    for (const node of layout.nodes) {
      if (node.parent) assert.ok(node.x >= node.parent.x, `${mode}: ${node.name} moved left of its parent`);
    }
  }
});

test("tree ordering ladderizes sibling clades without changing topology", () => {
  const tree = {
    name: "ROOT",
    node_attrs: {div: 0},
    children: [
      {
        name: "LARGE",
        node_attrs: {div: 0.1},
        children: [
          {name: "L1", node_attrs: {div: 0.2}},
          {name: "L2", node_attrs: {div: 0.2}},
          {name: "L3", node_attrs: {div: 0.2}}
        ]
      },
      {name: "SMALL", node_attrs: {div: 0.15}}
    ]
  };
  const model = buildTreeModel(tree);
  const nodeIds = new Set(model.nodes.map((node) => node.id));

  orderTree(model, "increasing");
  assert.equal(model.leaves[0].name, "SMALL");
  assert.equal(model.leaves.at(-1).name, "L3");

  orderTree(model, "decreasing");
  assert.equal(model.leaves[0].name, "L1");
  assert.equal(model.leaves.at(-1).name, "SMALL");

  orderTree(model, "input");
  assert.equal(model.leaves[0].name, "L1");
  assert.equal(model.leaves.at(-1).name, "SMALL");
  assert.deepEqual(new Set(model.nodes.map((node) => node.id)), nodeIds);
  assert.equal(model.root.descendantTips, 4);
});

test("unrooted layout returns finite equal-angle coordinates and a scale bar", () => {
  const model = buildTreeModel(demoDataset.tree);
  orderTree(model, "increasing");
  const layout = calculateUnrootedLayout(model, {
    mode: "divergence",
    width: 1000,
    viewportHeight: 700
  });
  assert.equal(layout.view, "unrooted");
  assert.equal(layout.mode, "divergence");
  assert.ok(layout.scaleBar.pixels > 0);
  assert.ok(layout.tipSpacing > 0);
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x));
    assert.ok(Number.isFinite(node.y));
    assert.ok(Number.isFinite(node.angle));
  }
});

test("metadata colorings and values are discovered", () => {
  const model = buildTreeModel(demoDataset.tree);
  const options = collectColoringOptions(demoDataset, model);
  assert.ok(options.some((option) => option.key === "region" && option.title === "Region"));
  const regions = traitValues(model, "region");
  assert.ok(regions.includes("North America"));
  assert.ok(regions.includes("Europe"));
});

test("tip search returns matching tips plus their ancestral paths", () => {
  const model = buildTreeModel(demoDataset.tree);
  const result = findSearchMatches(model, "usa");
  assert.equal(result.count, 2);
  assert.equal(result.matchingLeaves.size, 2);
  assert.ok(result.activeNodes.has(model.root.id));
  assert.ok([...result.matchingLeaves].every((id) => result.activeNodes.has(id)));
});

test("decimal years convert predictably", () => {
  const date = decimalYearToDate(2024.5);
  assert.ok(date instanceof Date);
  assert.equal(date.getUTCFullYear(), 2024);
  assert.match(formatDecimalYear(2024.5), /2024/);
});

test("legacy metadata can be normalized with a warning", () => {
  const legacy = {version: "v2", metadata: {title: "Legacy"}, tree: demoDataset.tree};
  const validation = validateDataset(legacy);
  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((warning) => warning.includes("legacy")));
  assert.equal(normalizeDataset(legacy).meta.title, "Legacy");
});

test("invalid input reports actionable top-level errors", () => {
  const result = validateDataset({version: "v2"});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("meta")));
  assert.ok(result.errors.some((error) => error.includes("tree")));
});


test("Newick parsing preserves topology, labels, comments, and cumulative branch lengths", () => {
  const parsed = parseNewick("[&R](('Sample A':0.1,B:2e-1)95:0.3,C:0.4)ROOT;", {title: "Newick smoke"});
  assert.equal(parsed.format, "newick");
  assert.equal(parsed.dataset.meta.title, "Newick smoke");
  assert.equal(parsed.stats.leafCount, 3);
  assert.equal(parsed.stats.nodeCount, 5);
  assert.equal(parsed.stats.commentCount, 1);
  assert.ok(parsed.warnings.some((warning) => warning.includes("comment")));

  const validation = validateDataset(parsed.dataset);
  assert.equal(validation.valid, true);
  assert.equal(validation.stats.nodesWithDivergence, 5);
  const model = buildTreeModel(parsed.dataset.tree);
  const sampleA = model.leaves.find((leaf) => leaf.name === "Sample A");
  const sampleB = model.leaves.find((leaf) => leaf.name === "B");
  const sampleC = model.leaves.find((leaf) => leaf.name === "C");
  assert.equal(sampleA.data.node_attrs.branch_length, 0.1);
  assert.ok(Math.abs(sampleA.data.node_attrs.div - 0.4) < 1e-12);
  assert.ok(Math.abs(sampleB.data.node_attrs.div - 0.5) < 1e-12);
  assert.ok(Math.abs(sampleC.data.node_attrs.div - 0.4) < 1e-12);
});

test("Newick without branch lengths falls back to branch depth", () => {
  const parsed = parseDatasetText("((A,B),C);", "topology.nwk");
  const validation = validateDataset(parsed.dataset);
  assert.equal(validation.valid, true);
  assert.equal(validation.stats.nodesWithDivergence, 0);
  assert.ok(parsed.warnings.some((warning) => warning.includes("branch depth")));
  const model = buildTreeModel(parsed.dataset.tree);
  const layout = calculateLayout(model, {mode: "divergence"});
  assert.equal(layout.mode, "depth");
});

test("dataset text detection accepts Newick extensions and reports malformed input", () => {
  const parsed = parseDatasetText("(A:0.1,B:0.2)R;", "example.tree");
  assert.equal(parsed.format, "newick");
  assert.equal(parsed.dataset.meta.title, "example");
  assert.throws(
    () => parseDatasetText("(A:0.1,B:bad)R;", "broken.nwk"),
    /Newick parse error.*invalid branch length/
  );
  assert.throws(
    () => parseDatasetText("#NEXUS", "example.txt"),
    /Unsupported file format/
  );
});
