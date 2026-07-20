import {getNodeAttribute} from "./phylo-core.js";

const DEFAULT_MAX_SHARED_TIPS = 3000;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function edgeLength(node) {
  const explicit = getNodeAttribute(node.data, "branch_length");
  if (finiteNumber(explicit)) return Math.max(0, explicit);

  const divergence = getNodeAttribute(node.data, "div");
  const parentDivergence = node.parent ? getNodeAttribute(node.parent.data, "div") : undefined;
  if (finiteNumber(divergence) && finiteNumber(parentDivergence)) {
    return Math.max(0, divergence - parentDivergence);
  }
  return node.parent ? 1 : 0;
}

function uniqueLeafMap(model, label) {
  const map = new Map();
  const duplicates = new Set();
  for (const leaf of model.leaves) {
    if (map.has(leaf.name)) duplicates.add(leaf.name);
    else map.set(leaf.name, leaf);
  }
  if (duplicates.size) {
    const preview = [...duplicates].slice(0, 5).join(", ");
    throw new Error(`${label} contains duplicate tip names (${preview}${duplicates.size > 5 ? ", …" : ""}). Tip names must be unique for tree matching.`);
  }
  return map;
}

function prepareDistances(model, names, leafMap) {
  const rootDistance = new Map([[model.root.id, 0]]);
  const stack = [model.root];
  while (stack.length) {
    const node = stack.pop();
    const parentDistance = rootDistance.get(node.id) ?? 0;
    for (const child of node.children) {
      rootDistance.set(child.id, parentDistance + edgeLength(child));
      stack.push(child);
    }
  }

  const paths = new Map();
  for (const name of names) {
    const leaf = leafMap.get(name);
    const path = [];
    let current = leaf;
    while (current) {
      path.push(current);
      current = current.parent;
    }
    path.reverse();
    paths.set(name, path);
  }

  function distance(leftName, rightName) {
    const leftPath = paths.get(leftName);
    const rightPath = paths.get(rightName);
    const limit = Math.min(leftPath.length, rightPath.length);
    let lca = model.root;
    for (let index = 0; index < limit; index += 1) {
      if (leftPath[index] !== rightPath[index]) break;
      lca = leftPath[index];
    }
    const leftLeaf = leafMap.get(leftName);
    const rightLeaf = leafMap.get(rightName);
    return (rootDistance.get(leftLeaf.id) ?? 0)
      + (rootDistance.get(rightLeaf.id) ?? 0)
      - 2 * (rootDistance.get(lca.id) ?? 0);
  }

  return {distance, rootDistance};
}

function addNearest(list, entry, limit) {
  list.push(entry);
  list.sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name));
  if (list.length > limit) list.pop();
}

function jaccardDistance(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? 1 - intersection / union : 0;
}

export function analyzeTreeDiscordance(modelA, modelB, {
  k = 5,
  maxSharedTips = DEFAULT_MAX_SHARED_TIPS
} = {}) {
  if (!modelA?.leaves || !modelB?.leaves) throw new TypeError("Two built tree models are required.");

  const leavesA = uniqueLeafMap(modelA, "Tree A");
  const leavesB = uniqueLeafMap(modelB, "Tree B");
  const commonNames = modelA.leaves.map((leaf) => leaf.name).filter((name) => leavesB.has(name));
  if (commonNames.length < 3) throw new Error("At least three identically named tips must be shared by both trees.");
  if (commonNames.length > maxSharedTips) {
    throw new RangeError(`Reassortment Radar currently supports up to ${maxSharedTips.toLocaleString()} shared tips per comparison.`);
  }

  const effectiveK = Math.max(1, Math.min(Math.trunc(Number(k) || 5), commonNames.length - 1));
  const distancesA = prepareDistances(modelA, commonNames, leavesA);
  const distancesB = prepareDistances(modelB, commonNames, leavesB);
  const nearestA = new Map(commonNames.map((name) => [name, []]));
  const nearestB = new Map(commonNames.map((name) => [name, []]));

  for (let leftIndex = 0; leftIndex < commonNames.length; leftIndex += 1) {
    const leftName = commonNames[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < commonNames.length; rightIndex += 1) {
      const rightName = commonNames[rightIndex];
      const distanceA = distancesA.distance(leftName, rightName);
      const distanceB = distancesB.distance(leftName, rightName);
      addNearest(nearestA.get(leftName), {name: rightName, distance: distanceA}, effectiveK);
      addNearest(nearestA.get(rightName), {name: leftName, distance: distanceA}, effectiveK);
      addNearest(nearestB.get(leftName), {name: rightName, distance: distanceB}, effectiveK);
      addNearest(nearestB.get(rightName), {name: leftName, distance: distanceB}, effectiveK);
    }
  }

  const candidates = commonNames.map((name) => {
    const neighborsA = nearestA.get(name).map((entry) => entry.name);
    const neighborsB = nearestB.get(name).map((entry) => entry.name);
    const setA = new Set(neighborsA);
    const setB = new Set(neighborsB);
    const sharedNeighbors = neighborsA.filter((neighbor) => setB.has(neighbor));
    const uniqueA = neighborsA.filter((neighbor) => !setB.has(neighbor));
    const uniqueB = neighborsB.filter((neighbor) => !setA.has(neighbor));
    return {
      name,
      score: jaccardDistance(neighborsA, neighborsB),
      neighborsA,
      neighborsB,
      sharedNeighbors,
      uniqueA,
      uniqueB,
      distancesA: nearestA.get(name),
      distancesB: nearestB.get(name)
    };
  });

  candidates.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  const meanScore = candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length;
  const maxScore = candidates[0]?.score ?? 0;
  const commonSet = new Set(commonNames);
  const onlyA = modelA.leaves.filter((leaf) => !commonSet.has(leaf.name)).map((leaf) => leaf.name);
  const onlyB = modelB.leaves.filter((leaf) => !commonSet.has(leaf.name)).map((leaf) => leaf.name);

  return {
    k: effectiveK,
    requestedK: k,
    commonNames,
    commonCount: commonNames.length,
    onlyA,
    onlyB,
    candidates,
    candidateByName: new Map(candidates.map((candidate) => [candidate.name, candidate])),
    meanScore,
    maxScore,
    leavesA,
    leavesB
  };
}

export function scoreColor(score) {
  const value = Math.max(0, Math.min(1, Number(score) || 0));
  if (value < 0.25) return "#0ea5e9";
  if (value < 0.5) return "#8b5cf6";
  if (value < 0.75) return "#f59e0b";
  return "#ef4444";
}

export function discordanceCsv(analysis, {treeAName = "Tree A", treeBName = "Tree B"} = {}) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = [
    "sample",
    "discordance_score",
    "k_neighbors",
    "shared_neighbors",
    `${treeAName}_neighbors`,
    `${treeBName}_neighbors`,
    `${treeAName}_unique_neighbors`,
    `${treeBName}_unique_neighbors`
  ];
  const rows = analysis.candidates.map((candidate) => [
    candidate.name,
    candidate.score.toFixed(6),
    analysis.k,
    candidate.sharedNeighbors.join(";"),
    candidate.neighborsA.join(";"),
    candidate.neighborsB.join(";"),
    candidate.uniqueA.join(";"),
    candidate.uniqueB.join(";")
  ]);
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}
