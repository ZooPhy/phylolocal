import assert from "node:assert/strict";
import test from "node:test";

import {buildTreeModel, normalizeDataset, parseDatasetText} from "../src/phylo-core.js";
import {analyzeTreeDiscordance, discordanceCsv, scoreColor} from "../src/reassortment-core.js";
import {radarDemoA, radarDemoB} from "../src/radar-demo.js";

function modelFromNewick(text, name) {
  const parsed = parseDatasetText(text, name);
  return buildTreeModel(normalizeDataset(parsed.dataset).tree);
}

test("Reassortment Radar ranks swapped tips as the strongest candidates", () => {
  const analysis = analyzeTreeDiscordance(
    modelFromNewick(radarDemoA, "ha.nwk"),
    modelFromNewick(radarDemoB, "na.nwk"),
    {k: 3}
  );

  assert.equal(analysis.commonCount, 10);
  assert.equal(analysis.k, 3);
  assert.deepEqual(analysis.candidates.slice(0, 2).map((candidate) => candidate.name).sort(), ["D", "H"]);
  assert.equal(analysis.candidateByName.get("D").score, 1);
  assert.equal(analysis.candidateByName.get("H").score, 1);
  assert.equal(analysis.onlyA.length, 0);
  assert.equal(analysis.onlyB.length, 0);
});

test("analysis reports unmatched tips and clamps k to available neighbors", () => {
  const treeA = modelFromNewick("((A:1,B:1):1,(C:1,D:1):1);", "a.nwk");
  const treeB = modelFromNewick("((A:1,B:1):1,(C:1,E:1):1);", "b.nwk");
  const analysis = analyzeTreeDiscordance(treeA, treeB, {k: 50});

  assert.equal(analysis.commonCount, 3);
  assert.equal(analysis.k, 2);
  assert.deepEqual(analysis.onlyA, ["D"]);
  assert.deepEqual(analysis.onlyB, ["E"]);
});

test("CSV export includes ranked scores and neighborhood columns", () => {
  const analysis = analyzeTreeDiscordance(
    modelFromNewick(radarDemoA, "ha.nwk"),
    modelFromNewick(radarDemoB, "na.nwk"),
    {k: 3}
  );
  const csv = discordanceCsv(analysis, {treeAName: "HA", treeBName: "NA"});
  assert.match(csv, /"discordance_score"/);
  assert.match(csv, /"HA_neighbors"/);
  assert.match(csv, /"NA_neighbors"/);
  assert.match(csv, /"D","1\.000000"/);
});

test("score colors progress from cool to hot", () => {
  assert.equal(scoreColor(0), "#0ea5e9");
  assert.equal(scoreColor(0.5), "#f59e0b");
  assert.equal(scoreColor(1), "#ef4444");
});

test("duplicate tip names are rejected", () => {
  const duplicate = modelFromNewick("((A:1,A:1):1,B:1);", "duplicate.nwk");
  const normal = modelFromNewick("((A:1,C:1):1,B:1);", "normal.nwk");
  assert.throws(() => analyzeTreeDiscordance(duplicate, normal), /duplicate tip names/i);
});
