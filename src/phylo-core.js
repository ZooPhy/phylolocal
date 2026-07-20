const SPECIAL_NODE_ATTRIBUTES = new Set([
  "div",
  "num_date",
  "vaccine",
  "hidden",
  "url",
  "author",
  "accession",
  "branch_length"
]);

const DEFAULT_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
  "#9333ea",
  "#0f766e",
  "#b45309",
  "#475569"
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteExtent(values) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const value of values) {
    if (!isFiniteNumber(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    count += 1;
  }
  return {min, max, count};
}

export function readAttributeValue(attribute) {
  if (isRecord(attribute) && Object.prototype.hasOwnProperty.call(attribute, "value")) {
    return attribute.value;
  }
  if (["string", "number", "boolean"].includes(typeof attribute)) return attribute;
  return undefined;
}

export function getNodeAttribute(nodeData, key) {
  if (!isRecord(nodeData?.node_attrs)) return undefined;
  return readAttributeValue(nodeData.node_attrs[key]);
}


function newickLocation(text, index) {
  const prefix = text.slice(0, Math.max(0, index));
  const line = prefix.split("\n").length;
  const previousBreak = prefix.lastIndexOf("\n");
  const column = index - previousBreak;
  return {line, column};
}

function newickSyntaxError(text, index, message) {
  const {line, column} = newickLocation(text, index);
  return new SyntaxError(`Newick parse error at line ${line}, column ${column}: ${message}`);
}

function filenameStem(fileName) {
  const clean = String(fileName ?? "").split(/[\\/]/).pop() || "Newick tree";
  const stem = clean.replace(/\.(?:nwk|newick|tree|tre)$/i, "").trim();
  return stem || "Newick tree";
}

/**
 * Parse a single Newick tree and convert it to the normalized Auspice-like
 * structure used by this viewer. Newick comments are intentionally ignored;
 * topology, labels, and branch lengths are preserved.
 */
export function parseNewick(text, {title = "Newick tree", maxNodes = 200000} = {}) {
  if (typeof text !== "string") throw new TypeError("Newick input must be text.");
  const source = text.replace(/^\uFEFF/, "");
  let index = 0;
  let commentCount = 0;
  let nodeCount = 0;
  let leafCount = 0;
  let branchLengthCount = 0;
  let missingBranchLengthCount = 0;
  let generatedInternalCount = 0;
  let generatedTipCount = 0;
  const warnings = [];

  function skipIgnorable() {
    while (index < source.length) {
      if (/\s/.test(source[index])) {
        index += 1;
        continue;
      }
      if (source[index] !== "[") break;
      commentCount += 1;
      let depth = 1;
      index += 1;
      while (index < source.length && depth > 0) {
        if (source[index] === "[") depth += 1;
        else if (source[index] === "]") depth -= 1;
        index += 1;
      }
      if (depth !== 0) throw newickSyntaxError(source, index, "unterminated comment annotation.");
    }
  }

  function parseLabel() {
    skipIgnorable();
    const quote = source[index];
    if (quote === "'" || quote === '"') {
      index += 1;
      let label = "";
      while (index < source.length) {
        const character = source[index];
        if (character === quote) {
          if (source[index + 1] === quote) {
            label += quote;
            index += 2;
            continue;
          }
          index += 1;
          return label;
        }
        label += character;
        index += 1;
      }
      throw newickSyntaxError(source, index, "unterminated quoted node label.");
    }

    const start = index;
    while (index < source.length && !/[(),:;\[\]\s]/.test(source[index])) index += 1;
    return source.slice(start, index).trim();
  }

  function parseBranchLength() {
    skipIgnorable();
    if (source[index] !== ":") return null;
    index += 1;
    skipIgnorable();
    const start = index;
    while (index < source.length && !/[,);\[\]\s]/.test(source[index])) index += 1;
    const token = source.slice(start, index).trim();
    if (!token) throw newickSyntaxError(source, start, "missing branch length after ':'.");
    const value = Number(token);
    if (!Number.isFinite(value)) throw newickSyntaxError(source, start, `invalid branch length ${JSON.stringify(token)}.`);
    branchLengthCount += 1;
    if (value < 0) warnings.push(`Negative branch length ${token} was preserved but will be visually clamped to its parent position.`);
    return value;
  }

  function parseSubtree() {
    skipIgnorable();
    if (index >= source.length) throw newickSyntaxError(source, index, "unexpected end of file while reading a subtree.");
    nodeCount += 1;
    if (nodeCount > maxNodes) throw new RangeError(`Newick tree exceeds the ${maxNodes.toLocaleString()} node safety limit.`);

    const raw = {label: "", length: null, children: []};
    if (source[index] === "(") {
      index += 1;
      skipIgnorable();
      if (source[index] === ")") throw newickSyntaxError(source, index, "internal node has no children.");
      while (true) {
        raw.children.push(parseSubtree());
        skipIgnorable();
        if (source[index] === ",") {
          index += 1;
          continue;
        }
        if (source[index] === ")") {
          index += 1;
          break;
        }
        throw newickSyntaxError(source, index, "expected ',' or ')' after a child subtree.");
      }
      raw.label = parseLabel();
    } else {
      raw.label = parseLabel();
      if (!raw.label) generatedTipCount += 1;
      leafCount += 1;
    }
    raw.length = parseBranchLength();
    if (raw.length === null) missingBranchLengthCount += 1;
    skipIgnorable();
    return raw;
  }

  skipIgnorable();
  if (!source.slice(index).trim()) throw new SyntaxError("Newick input is empty.");
  const rawRoot = parseSubtree();
  skipIgnorable();
  if (source[index] === ";") index += 1;
  else warnings.push("The Newick tree did not end with a semicolon; it was accepted anyway.");
  skipIgnorable();
  if (index < source.length) throw newickSyntaxError(source, index, "additional content was found after the first tree.");

  const hasBranchLengths = branchLengthCount > 0;
  let internalSequence = 0;
  let tipSequence = 0;

  function convert(raw, parentDivergence = 0, isRoot = false) {
    const isLeaf = raw.children.length === 0;
    let name = raw.label.trim();
    if (!name) {
      if (isLeaf) name = `TIP_${String(++tipSequence).padStart(6, "0")}`;
      else if (isRoot) name = "ROOT";
      else name = `NODE_${String(++internalSequence).padStart(6, "0")}`;
      if (!isLeaf && !isRoot) generatedInternalCount += 1;
    }

    const nodeAttrs = {};
    if (raw.length !== null) nodeAttrs.branch_length = raw.length;
    if (hasBranchLengths) {
      const edgeLength = isRoot ? 0 : Math.max(0, raw.length ?? 0);
      nodeAttrs.div = parentDivergence + edgeLength;
    }

    const node = {name, node_attrs: nodeAttrs};
    if (raw.children.length) {
      const divergence = hasBranchLengths ? nodeAttrs.div : parentDivergence;
      node.children = raw.children.map((child) => convert(child, divergence, false));
    }
    return node;
  }

  const tree = convert(rawRoot, 0, true);
  if (commentCount > 0) warnings.push(`Ignored ${commentCount.toLocaleString()} Newick comment annotation${commentCount === 1 ? "" : "s"}.`);
  if (!hasBranchLengths) {
    warnings.push("No branch lengths were found; branch depth will be used for positioning.");
  } else if (missingBranchLengthCount > 1) {
    const missingEdges = missingBranchLengthCount - 1;
    warnings.push(`${missingEdges.toLocaleString()} non-root edge${missingEdges === 1 ? "" : "s"} lacked a branch length and were treated as zero.`);
  }
  if (generatedInternalCount > 0) warnings.push(`Generated names for ${generatedInternalCount.toLocaleString()} unnamed internal node${generatedInternalCount === 1 ? "" : "s"}.`);
  if (generatedTipCount > 0) warnings.push(`Generated names for ${generatedTipCount.toLocaleString()} unnamed tip${generatedTipCount === 1 ? "" : "s"}.`);
  warnings.push("Newick supplies topology, labels, and optional branch lengths only; categorical metadata coloring requires Auspice JSON.");

  return {
    dataset: {
      version: "v2",
      meta: {
        title: String(title || "Newick tree"),
        description: "Imported locally from Newick"
      },
      tree
    },
    warnings,
    stats: {nodeCount, leafCount, branchLengthCount, commentCount},
    format: "newick"
  };
}

export function parseDatasetText(text, fileName = "local-dataset") {
  if (typeof text !== "string") throw new TypeError("Dataset input must be text.");
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("The selected file is empty.");
  const extension = (String(fileName).match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  const newickExtensions = new Set(["nwk", "newick", "tree", "tre"]);

  if (newickExtensions.has(extension)) {
    return parseNewick(trimmed, {title: filenameStem(fileName)});
  }

  if (extension === "json") {
    try {
      return {dataset: JSON.parse(trimmed), warnings: [], format: "auspice-json"};
    } catch (error) {
      throw new SyntaxError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (trimmed.startsWith("(") || trimmed.startsWith("[")) {
    try {
      return parseNewick(trimmed, {title: filenameStem(fileName)});
    } catch (newickError) {
      if (trimmed.startsWith("[")) {
        try {
          return {dataset: JSON.parse(trimmed), warnings: [], format: "auspice-json"};
        } catch {
          throw newickError;
        }
      }
      throw newickError;
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      return {dataset: JSON.parse(trimmed), warnings: [], format: "auspice-json"};
    } catch (error) {
      throw new SyntaxError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error("Unsupported file format. Choose an Auspice v2 .json file or a Newick .nwk, .newick, .tree, or .tre file.");
}

export function normalizeDataset(input) {
  if (!isRecord(input)) throw new TypeError("Dataset must be a JSON object.");
  const meta = isRecord(input.meta)
    ? input.meta
    : isRecord(input.metadata)
      ? input.metadata
      : {};
  const treeValue = Array.isArray(input.tree) ? input.tree[0] : input.tree;
  return {
    ...input,
    meta,
    tree: treeValue
  };
}

export function validateDataset(input, {maxNodes = 200000} = {}) {
  const errors = [];
  const warnings = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: ["The top-level JSON value must be an object."],
      warnings,
      stats: {nodeCount: 0, leafCount: 0, maxDepth: 0, duplicateNames: 0}
    };
  }

  if (input.version !== "v2") {
    if (input.version == null) warnings.push("Missing top-level version; Auspice v2 normally uses \"version\": \"v2\".");
    else warnings.push(`Expected Auspice version \"v2\" but found ${JSON.stringify(input.version)}.`);
  }

  if (!isRecord(input.meta) && isRecord(input.metadata)) {
    warnings.push("Using legacy top-level \"metadata\" as \"meta\".");
  } else if (!isRecord(input.meta)) {
    errors.push("Missing required top-level object \"meta\".");
  }

  let tree = input.tree;
  if (Array.isArray(tree)) {
    if (tree.length === 0) errors.push("The top-level tree array is empty.");
    else {
      if (tree.length > 1) warnings.push(`This MVP displays the first of ${tree.length} trees.`);
      tree = tree[0];
    }
  }

  if (!isRecord(tree)) {
    errors.push("Missing required top-level tree object.");
    return {
      valid: false,
      errors,
      warnings,
      stats: {nodeCount: 0, leafCount: 0, maxDepth: 0, duplicateNames: 0}
    };
  }

  let nodeCount = 0;
  let leafCount = 0;
  let maxDepth = 0;
  let duplicateNames = 0;
  let nodesWithDivergence = 0;
  let nodesWithDate = 0;
  const names = new Set();
  const stack = [{node: tree, path: "tree", depth: 0}];

  while (stack.length) {
    const {node, path, depth} = stack.pop();
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, depth);

    if (nodeCount > maxNodes) {
      errors.push(`Dataset exceeds the ${maxNodes.toLocaleString()} node safety limit.`);
      break;
    }

    if (!isRecord(node)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    if (typeof node.name !== "string" || node.name.trim() === "") {
      errors.push(`${path}.name must be a non-empty string.`);
    } else if (names.has(node.name)) {
      duplicateNames += 1;
      if (duplicateNames <= 10) warnings.push(`Duplicate node name: ${node.name}`);
    } else {
      names.add(node.name);
    }

    if (!isRecord(node.node_attrs)) {
      errors.push(`${path}.node_attrs must be an object.`);
    } else {
      if (isFiniteNumber(node.node_attrs.div)) nodesWithDivergence += 1;
      if (isFiniteNumber(readAttributeValue(node.node_attrs.num_date))) nodesWithDate += 1;
    }

    if (node.children == null) {
      leafCount += 1;
    } else if (!Array.isArray(node.children)) {
      errors.push(`${path}.children must be an array when present.`);
    } else if (node.children.length === 0) {
      leafCount += 1;
      warnings.push(`${path}.children is empty; treating the node as a tip.`);
    } else {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push({node: node.children[index], path: `${path}.children[${index}]`, depth: depth + 1});
      }
    }
  }

  if (duplicateNames > 10) warnings.push(`${duplicateNames - 10} additional duplicate node names were omitted from the warning list.`);
  if (nodesWithDivergence === 0 && nodesWithDate === 0) {
    warnings.push("No divergence or numeric-date values were found; branch depth will be used for the x-axis.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodeCount,
      leafCount,
      maxDepth,
      duplicateNames,
      nodesWithDivergence,
      nodesWithDate
    }
  };
}

export function buildTreeModel(treeRoot) {
  if (!isRecord(treeRoot)) throw new TypeError("Tree root must be an object.");

  let nextId = 0;
  const root = {
    id: nextId++,
    name: String(treeRoot.name ?? "root"),
    data: treeRoot,
    parent: null,
    children: [],
    depth: 0,
    isLeaf: false,
    descendantTips: 0,
    yUnit: 0,
    xRaw: 0,
    x: 0,
    y: 0,
    angle: 0,
    inputOrder: 0
  };
  const nodes = [root];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const rawChildren = Array.isArray(current.data.children) ? current.data.children : [];
    current.children = rawChildren.map((childData, childIndex) => {
      const child = {
        id: nextId++,
        name: String(childData?.name ?? `node-${nextId}`),
        data: childData,
        parent: current,
        children: [],
        depth: current.depth + 1,
        isLeaf: false,
        descendantTips: 0,
        yUnit: 0,
        xRaw: 0,
        x: 0,
        y: 0,
        angle: 0,
        inputOrder: childIndex
      };
      nodes.push(child);
      return child;
    });
    for (let index = current.children.length - 1; index >= 0; index -= 1) stack.push(current.children[index]);
  }

  const leaves = [];
  for (const node of nodes) {
    node.isLeaf = node.children.length === 0;
    if (node.isLeaf) {
      node.yUnit = leaves.length;
      node.descendantTips = 1;
      leaves.push(node);
    }
  }

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.isLeaf) continue;
    node.descendantTips = node.children.reduce((sum, child) => sum + child.descendantTips, 0);
    const weightedY = node.children.reduce((sum, child) => sum + child.yUnit * child.descendantTips, 0);
    node.yUnit = node.descendantTips ? weightedY / node.descendantTips : 0;
  }

  return {root, nodes, leaves};
}

function recomputeLeafOrder(model) {
  const leaves = [];
  const stack = [model.root];
  while (stack.length) {
    const node = stack.pop();
    if (node.children.length === 0) {
      node.isLeaf = true;
      node.descendantTips = 1;
      node.yUnit = leaves.length;
      leaves.push(node);
      continue;
    }
    node.isLeaf = false;
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
  }

  for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
    const node = model.nodes[index];
    if (node.isLeaf) continue;
    node.descendantTips = node.children.reduce((sum, child) => sum + child.descendantTips, 0);
    const weightedY = node.children.reduce((sum, child) => sum + child.yUnit * child.descendantTips, 0);
    node.yUnit = node.descendantTips ? weightedY / node.descendantTips : 0;
  }

  model.leaves = leaves;
  return model;
}

export function orderTree(model, order = "input") {
  if (!model?.root || !Array.isArray(model.nodes)) throw new TypeError("A built tree model is required.");
  const normalized = ["input", "increasing", "decreasing"].includes(order) ? order : "input";

  for (const node of model.nodes) {
    if (node.children.length < 2) continue;
    node.children.sort((left, right) => {
      if (normalized === "input") return left.inputOrder - right.inputOrder;
      const difference = left.descendantTips - right.descendantTips;
      if (difference !== 0) return normalized === "increasing" ? difference : -difference;
      return left.inputOrder - right.inputOrder;
    });
  }

  recomputeLeafOrder(model);
  return model;
}

function numericValueForMode(node, mode) {
  if (mode === "date") return getNodeAttribute(node.data, "num_date");
  if (mode === "divergence") return getNodeAttribute(node.data, "div");
  return node.depth;
}

function assignRawX(model, mode) {
  const actual = model.nodes.map((node) => numericValueForMode(node, mode));
  const actualExtent = finiteExtent(actual);
  if (mode === "depth" || actualExtent.count === 0) {
    let maximumDepth = 1;
    for (const node of model.nodes) {
      node.xRaw = node.depth;
      maximumDepth = Math.max(maximumDepth, node.depth);
    }
    return {resolvedMode: "depth", min: 0, max: maximumDepth};
  }

  const overallMin = actualExtent.min;
  const descendantMinimum = new Map();
  for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
    const node = model.nodes[index];
    const value = actual[index];
    let minimum = isFiniteNumber(value) ? value : Infinity;
    for (const child of node.children) minimum = Math.min(minimum, descendantMinimum.get(child.id) ?? Infinity);
    descendantMinimum.set(node.id, minimum);
  }

  for (let index = 0; index < model.nodes.length; index += 1) {
    const node = model.nodes[index];
    const value = actual[index];
    const parentValue = node.parent?.xRaw;
    const descendantValue = descendantMinimum.get(node.id);
    let resolved;
    if (isFiniteNumber(value)) resolved = value;
    else if (isFiniteNumber(parentValue)) resolved = parentValue;
    else if (isFiniteNumber(descendantValue)) resolved = descendantValue;
    else resolved = overallMin;

    if (node.parent && resolved < node.parent.xRaw) resolved = node.parent.xRaw;
    node.xRaw = resolved;
  }

  const values = model.nodes.map((node) => node.xRaw);
  const resolvedExtent = finiteExtent(values);
  let {min, max} = resolvedExtent;
  if (min === max) {
    const padding = Math.abs(min || 1) * 0.05;
    min -= padding;
    max += padding;
  }
  return {resolvedMode: mode, min, max};
}

function niceStep(span, targetTicks) {
  const rough = span / Math.max(1, targetTicks);
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const error = rough / power;
  const multiplier = error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1;
  return multiplier * power;
}

export function createTicks(min, max, targetTicks = 6) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const step = niceStep(span, targetTicks);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = start; value <= max + step * 0.001; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  if (!ticks.length) ticks.push(min, max);
  return ticks;
}

export function calculateLayout(model, {
  mode = "divergence",
  width = 1200,
  viewportHeight = 700,
  rowHeight = 24,
  margin = {top: 36, right: 220, bottom: 64, left: 72}
} = {}) {
  const horizontalSpace = Math.max(180, width - margin.left - margin.right);
  const {resolvedMode, min, max} = assignRawX(model, mode);
  const worldHeight = Math.max(viewportHeight, margin.top + margin.bottom + Math.max(1, model.leaves.length - 1) * rowHeight);
  const yBottom = worldHeight - margin.bottom;
  const ySpan = Math.max(1, model.leaves.length - 1) * rowHeight;
  const availableTreeHeight = Math.max(1, yBottom - margin.top);
  const yOffset = margin.top + Math.max(0, (availableTreeHeight - ySpan) / 2);

  for (const node of model.nodes) {
    node.x = margin.left + ((node.xRaw - min) / (max - min)) * horizontalSpace;
    node.y = yOffset + node.yUnit * rowHeight;
    node.angle = 0;
  }

  const ticks = createTicks(min, max, 7).map((value) => ({
    value,
    x: margin.left + ((value - min) / (max - min)) * horizontalSpace,
    y: yBottom
  }));

  return {
    mode: resolvedMode,
    requestedMode: mode,
    width,
    height: worldHeight,
    yBottom,
    xDomain: [min, max],
    ticks,
    margin,
    rowHeight,
    nodes: model.nodes,
    leaves: model.leaves
  };
}

function assignAngularSectors(model) {
  const leafCount = Math.max(1, model.leaves.length);
  const startAngle = -Math.PI / 2;
  const step = (Math.PI * 2) / leafCount;

  for (let index = 0; index < model.leaves.length; index += 1) {
    const leaf = model.leaves[index];
    leaf._leafStart = index;
    leaf._leafEnd = index;
    leaf.angle = startAngle + index * step;
  }

  for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
    const node = model.nodes[index];
    if (node.isLeaf) continue;
    let leafStart = Infinity;
    let leafEnd = -Infinity;
    for (const child of node.children) {
      leafStart = Math.min(leafStart, child._leafStart);
      leafEnd = Math.max(leafEnd, child._leafEnd);
    }
    node._leafStart = leafStart;
    node._leafEnd = leafEnd;
    const midpoint = (node._leafStart + node._leafEnd) / 2;
    node.angle = startAngle + midpoint * step;
  }

  return {leafCount, step};
}

export function calculateUnrootedLayout(model, {
  mode = "divergence",
  width = 1200,
  viewportHeight = 700,
  margin = {top: 54, right: 86, bottom: 70, left: 86}
} = {}) {
  const {resolvedMode, min, max} = assignRawX(model, mode);
  const span = Math.max(Number.EPSILON, max - min);
  const {leafCount, step} = assignAngularSectors(model);

  model.root._unitX = 0;
  model.root._unitY = 0;
  const traversal = [model.root];
  while (traversal.length) {
    const node = traversal.pop();
    for (const child of node.children) {
      const rawLength = Math.max(0, child.xRaw - node.xRaw);
      const normalizedLength = rawLength / span;
      child._unitX = node._unitX + Math.cos(child.angle) * normalizedLength;
      child._unitY = node._unitY + Math.sin(child.angle) * normalizedLength;
      traversal.push(child);
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of model.nodes) {
    minX = Math.min(minX, node._unitX);
    maxX = Math.max(maxX, node._unitX);
    minY = Math.min(minY, node._unitY);
    maxY = Math.max(maxY, node._unitY);
  }

  const availableWidth = Math.max(120, width - margin.left - margin.right);
  const availableHeight = Math.max(120, viewportHeight - margin.top - margin.bottom);
  const unitWidth = Math.max(0.001, maxX - minX);
  const unitHeight = Math.max(0.001, maxY - minY);
  const scale = Math.min(availableWidth / unitWidth, availableHeight / unitHeight);
  const drawingWidth = unitWidth * scale;
  const drawingHeight = unitHeight * scale;
  const offsetX = margin.left + (availableWidth - drawingWidth) / 2 - minX * scale;
  const offsetY = margin.top + (availableHeight - drawingHeight) / 2 - minY * scale;

  for (const node of model.nodes) {
    node.x = offsetX + node._unitX * scale;
    node.y = offsetY + node._unitY * scale;
  }

  let maximumRadius = 1;
  for (const leaf of model.leaves) {
    maximumRadius = Math.max(maximumRadius, Math.hypot(leaf.x - model.root.x, leaf.y - model.root.y));
  }
  const tipSpacing = (Math.PI * 2 * maximumRadius) / leafCount;
  const scaleBarRaw = niceStep(span / 5, 1);
  const scaleBarPixels = Math.max(24, (scaleBarRaw / span) * scale);

  return {
    view: "unrooted",
    mode: resolvedMode,
    requestedMode: mode,
    width,
    height: viewportHeight,
    xDomain: [min, max],
    margin,
    nodes: model.nodes,
    leaves: model.leaves,
    centerX: model.root.x,
    centerY: model.root.y,
    tipSpacing,
    angleStep: step,
    scaleBar: {
      raw: scaleBarRaw,
      pixels: scaleBarPixels,
      x: margin.left,
      y: viewportHeight - Math.max(24, margin.bottom / 2)
    }
  };
}

export function decimalYearToDate(decimalYear) {
  if (!isFiniteNumber(decimalYear)) return null;
  const year = Math.floor(decimalYear);
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return new Date(start + (decimalYear - year) * (end - start));
}

export function formatDecimalYear(decimalYear) {
  const date = decimalYearToDate(decimalYear);
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

export function formatAxisValue(value, mode) {
  if (!isFiniteNumber(value)) return "";
  if (mode === "date") {
    const year = Math.floor(value);
    const fraction = value - year;
    if (Math.abs(fraction) < 0.001) return String(year);
    return `${year}.${String(Math.round(fraction * 100)).padStart(2, "0")}`;
  }
  if (mode === "depth") return String(Math.round(value));
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(1);
  return Number(value.toPrecision(4)).toString();
}

export function collectColoringOptions(dataset, model) {
  const options = [];
  const seen = new Set();
  const configured = Array.isArray(dataset?.meta?.colorings) ? dataset.meta.colorings : [];

  for (const coloring of configured) {
    if (!isRecord(coloring) || typeof coloring.key !== "string" || seen.has(coloring.key)) continue;
    seen.add(coloring.key);
    options.push({
      key: coloring.key,
      title: typeof coloring.title === "string" ? coloring.title : coloring.key,
      type: typeof coloring.type === "string" ? coloring.type : "categorical"
    });
  }

  const discovered = new Set();
  for (const node of model.nodes) {
    const attrs = isRecord(node.data?.node_attrs) ? node.data.node_attrs : {};
    for (const key of Object.keys(attrs)) {
      if (SPECIAL_NODE_ATTRIBUTES.has(key) || seen.has(key)) continue;
      const value = getNodeAttribute(node.data, key);
      if (["string", "number", "boolean"].includes(typeof value)) discovered.add(key);
    }
  }

  for (const key of [...discovered].sort((a, b) => a.localeCompare(b))) {
    seen.add(key);
    options.push({key, title: key, type: "categorical"});
  }
  return options;
}

export function traitValues(model, key) {
  const values = new Set();
  for (const node of model.nodes) {
    const value = getNodeAttribute(node.data, key);
    if (value !== undefined && value !== null && value !== "") values.add(String(value));
  }
  return [...values].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
}

export function createColorMap(values, palette = DEFAULT_PALETTE) {
  const map = new Map();
  values.forEach((value, index) => map.set(String(value), palette[index % palette.length]));
  return map;
}

export function findSearchMatches(model, query) {
  const normalized = String(query ?? "").trim().toLocaleLowerCase();
  if (!normalized) return {matchingLeaves: new Set(), activeNodes: new Set(), count: 0};
  const matchingLeaves = new Set();
  const activeNodes = new Set();
  for (const leaf of model.leaves) {
    if (!leaf.name.toLocaleLowerCase().includes(normalized)) continue;
    matchingLeaves.add(leaf.id);
    let current = leaf;
    while (current) {
      activeNodes.add(current.id);
      current = current.parent;
    }
  }
  return {matchingLeaves, activeNodes, count: matchingLeaves.size};
}

export function nodeAttributeEntries(nodeData) {
  const attrs = isRecord(nodeData?.node_attrs) ? nodeData.node_attrs : {};
  return Object.keys(attrs)
    .map((key) => [key, readAttributeValue(attrs[key])])
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
    .sort(([a], [b]) => a.localeCompare(b));
}

export function datasetTitle(dataset, fallback = "Local phylogenetic dataset") {
  return typeof dataset?.meta?.title === "string" && dataset.meta.title.trim()
    ? dataset.meta.title.trim()
    : fallback;
}

export {DEFAULT_PALETTE};
