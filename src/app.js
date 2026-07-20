import {select} from "../vendor/d3-selection/index.js";
import {zoom, zoomIdentity} from "../vendor/d3-zoom/index.js";
import {demoDataset} from "./demo-data.js";
import {initReassortmentRadar} from "./radar-app.js";
import {
  buildTreeModel,
  calculateLayout,
  calculateUnrootedLayout,
  collectColoringOptions,
  createColorMap,
  datasetTitle,
  findSearchMatches,
  formatAxisValue,
  formatDecimalYear,
  getNodeAttribute,
  nodeAttributeEntries,
  normalizeDataset,
  orderTree,
  parseDatasetText,
  traitValues,
  validateDataset
} from "./phylo-core.js";

const AXIS_LABELS = {
  divergence: "Divergence",
  date: "Numeric date",
  depth: "Branch depth"
};

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const NO_COLOR = "#526175";
const INTERNAL_COLOR = "#ffffff";
const UNKNOWN_COLOR = "#94a3b8";

const refs = {
  axisMetric: document.querySelector("#axisMetric"),
  axisSelect: document.querySelector("#axisSelect"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  colorSelect: document.querySelector("#colorSelect"),
  colorStatus: document.querySelector("#colorStatus"),
  datasetTitle: document.querySelector("#datasetTitle"),
  demoButton: document.querySelector("#demoButton"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  diagnosticsSection: document.querySelector("#diagnosticsSection"),
  dropOverlay: document.querySelector("#dropOverlay"),
  dropZone: document.querySelector("#dropZone"),
  exportButton: document.querySelector("#exportButton"),
  fileInput: document.querySelector("#fileInput"),
  legend: document.querySelector("#legend"),
  nodeCount: document.querySelector("#nodeCount"),
  nodeDetails: document.querySelector("#nodeDetails"),
  orderSelect: document.querySelector("#orderSelect"),
  resetButton: document.querySelector("#resetButton"),
  searchField: document.querySelector("#searchField"),
  searchInput: document.querySelector("#searchInput"),
  searchStatus: document.querySelector("#searchStatus"),
  statusStrip: document.querySelector("#statusStrip"),
  statusText: document.querySelector("#statusText"),
  tipCount: document.querySelector("#tipCount"),
  treeStage: document.querySelector("#treeStage"),
  treeSvg: document.querySelector("#treeSvg"),
  treeViewport: document.querySelector("#treeViewport"),
  viewSelect: document.querySelector("#viewSelect"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton")
};

for (const [key, value] of Object.entries(refs)) {
  if (!value) throw new Error(`Missing required interface element: ${key}`);
}

const svg = select(refs.treeSvg);
const viewport = select(refs.treeViewport);

const state = {
  dataset: null,
  model: null,
  validation: null,
  layout: null,
  fileName: "bundled-demo.json",
  colorOptions: [],
  colorKey: "",
  colorMap: new Map(),
  selectedId: null,
  search: {matchingLeaves: new Set(), activeNodes: new Set(), count: 0},
  orderMode: "input",
  viewMode: "rooted",
  currentTransform: zoomIdentity,
  fitAfterRender: true,
  resizeTimer: null
};

const zoomBehavior = zoom()
  .scaleExtent([0.06, 30])
  .clickDistance(4)
  .on("zoom", (event) => {
    state.currentTransform = event.transform;
    viewport.attr("transform", event.transform.toString());
    updateZoomDependentStyles(event.transform);
  });

svg.call(zoomBehavior);

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function setStatus(message, kind = "ready") {
  refs.statusText.textContent = message;
  refs.statusStrip.classList.toggle("is-error", kind === "error");
  refs.statusStrip.classList.toggle("is-busy", kind === "busy");
}

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

function renderDiagnostics(messages = [], kind = "warning") {
  refs.diagnosticsList.replaceChildren();
  const unique = [...new Set(messages.filter(Boolean))];
  for (const message of unique) refs.diagnosticsList.append(createElement("li", "", message));
  refs.diagnosticsSection.hidden = unique.length === 0;
  refs.diagnosticsSection.dataset.kind = kind;
}

function availableAxis(validation) {
  if (validation?.stats?.nodesWithDivergence > 0) return "divergence";
  if (validation?.stats?.nodesWithDate > 0) return "date";
  return "depth";
}

function updateAxisControls(validation) {
  const divergenceOption = refs.axisSelect.querySelector('option[value="divergence"]');
  const dateOption = refs.axisSelect.querySelector('option[value="date"]');
  divergenceOption.disabled = validation.stats.nodesWithDivergence === 0;
  dateOption.disabled = validation.stats.nodesWithDate === 0;

  const requested = refs.axisSelect.value;
  if ((requested === "divergence" && divergenceOption.disabled) || (requested === "date" && dateOption.disabled)) {
    refs.axisSelect.value = availableAxis(validation);
  }
}

function populateColorControls(dataset, model) {
  const previous = state.colorKey;
  state.colorOptions = collectColoringOptions(dataset, model);
  refs.colorSelect.replaceChildren();

  const noColorOption = document.createElement("option");
  noColorOption.value = "";
  noColorOption.textContent = "No coloring";
  refs.colorSelect.append(noColorOption);

  for (const option of state.colorOptions) {
    const element = document.createElement("option");
    element.value = option.key;
    element.textContent = option.title;
    refs.colorSelect.append(element);
  }

  const canReuse = state.colorOptions.some((option) => option.key === previous);
  state.colorKey = canReuse ? previous : (state.colorOptions[0]?.key ?? "");
  refs.colorSelect.value = state.colorKey;
  refs.colorSelect.disabled = state.colorOptions.length === 0;
  refreshColorState();
}

function refreshColorState() {
  if (!state.model || !state.colorKey) {
    state.colorMap = new Map();
    refs.colorStatus.textContent = state.model && state.colorOptions.length === 0
      ? "No categorical metadata were found in this file."
      : "Choose a metadata field to color the tree.";
    renderLegend();
    return;
  }
  state.colorMap = createColorMap(traitValues(state.model, state.colorKey));
  refs.colorStatus.textContent = "Applied to horizontal branches and tip markers; connectors remain neutral.";
  renderLegend();
}

function nodeColor(node) {
  if (!state.colorKey) return NO_COLOR;
  const value = getNodeAttribute(node.data, state.colorKey);
  return value === undefined || value === null || value === ""
    ? UNKNOWN_COLOR
    : state.colorMap.get(String(value)) ?? UNKNOWN_COLOR;
}

function renderLegend() {
  refs.legend.replaceChildren();
  if (!state.model || !state.colorKey) {
    const message = state.model && state.colorOptions.length === 0
      ? "No categorical metadata are available."
      : "Choose a metadata field.";
    refs.legend.append(createElement("p", "muted-copy", message));
    return;
  }

  const option = state.colorOptions.find((candidate) => candidate.key === state.colorKey);
  const counts = new Map();
  for (const leaf of state.model.leaves) {
    const raw = getNodeAttribute(leaf.data, state.colorKey);
    const value = raw === undefined || raw === null || raw === "" ? "Unknown" : String(raw);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const entries = [...state.colorMap.entries()];
  if (counts.has("Unknown")) entries.push(["Unknown", UNKNOWN_COLOR]);
  const visibleEntries = entries.slice(0, 16);

  for (const [value, color] of visibleEntries) {
    const row = createElement("div", "legend-item");
    const swatchSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    swatchSvg.setAttribute("class", "legend-swatch");
    swatchSvg.setAttribute("viewBox", "0 0 10 10");
    swatchSvg.setAttribute("aria-hidden", "true");
    const swatch = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    swatch.setAttribute("width", "10");
    swatch.setAttribute("height", "10");
    swatch.setAttribute("rx", "2.5");
    swatch.setAttribute("fill", color);
    swatchSvg.append(swatch);
    const label = createElement("span", "legend-value", value);
    label.title = value;
    const count = createElement("span", "legend-count", counts.get(value) ?? "—");
    row.append(swatchSvg, label, count);
    refs.legend.append(row);
  }

  if (entries.length > visibleEntries.length) {
    refs.legend.append(createElement("p", "muted-copy", `+ ${entries.length - visibleEntries.length} additional values`));
  }

  refs.legend.setAttribute("aria-label", option ? `${option.title} legend` : "Color legend");
}

function axisName(mode) {
  return AXIS_LABELS[mode] ?? mode;
}

function rowHeightForTipCount(count) {
  if (count <= 30) return 27;
  if (count <= 100) return 19;
  if (count <= 500) return 13;
  if (count <= 2000) return 8;
  return 5;
}

function fittedRowHeight(count, viewHeight, margin) {
  const base = rowHeightForTipCount(count);
  if (count <= 1) return base;
  const available = Math.max(80, viewHeight - margin.top - margin.bottom);
  return Math.max(3.4, Math.min(base, available / (count - 1)));
}

function nodeScreenRadius(node) {
  if (node.isLeaf) return state.model.leaves.length > 1000 ? 3.1 : 3.8;
  return state.model.leaves.length > 1000 ? 1.8 : 2.3;
}

function updateZoomDependentStyles(transform = state.currentTransform) {
  if (!state.model || !state.layout) return;
  const scale = Math.max(0.001, Number(transform?.k) || 1);
  const nominalSpacing = state.layout.view === "unrooted"
    ? state.layout.tipSpacing
    : state.layout.rowHeight;
  const showAllLabels = state.model.leaves.length <= 40 || nominalSpacing * scale >= 12;

  viewport.selectAll("circle.tree-node")
    .attr("r", (node) => nodeScreenRadius(node) / scale);

  viewport.selectAll("text.tip-label")
    .attr("x", (node) => {
      if (state.layout.view !== "unrooted") return node.x + 8 / scale;
      return node.x + Math.cos(node.angle) * 8 / scale;
    })
    .attr("y", (node) => {
      if (state.layout.view !== "unrooted") return node.y;
      return node.y + Math.sin(node.angle) * 8 / scale;
    })
    .attr("text-anchor", (node) => {
      if (state.layout.view !== "unrooted") return "start";
      return Math.cos(node.angle) < -0.08 ? "end" : Math.cos(node.angle) > 0.08 ? "start" : "middle";
    })
    .style("font-size", `${10.5 / scale}px`)
    .classed("labels-hidden", !showAllLabels);
}

function childYExtent(node) {
  let min = Infinity;
  let max = -Infinity;
  for (const child of node.children) {
    min = Math.min(min, child.y);
    max = Math.max(max, child.y);
  }
  return [min, max];
}

function selectNode(node) {
  state.selectedId = node.id;
  applyInteractiveClasses();
  renderNodeDetails(node);
}

function renderNodeDetails(node) {
  refs.nodeDetails.replaceChildren();
  if (!node) {
    const empty = createElement("div", "empty-details");
    empty.append(createElement("div", "empty-details-icon", "◎"), createElement("p", "", "Select a node or tip in the tree."));
    refs.nodeDetails.append(empty);
    return;
  }

  refs.nodeDetails.append(createElement("h3", "node-name", node.name));
  refs.nodeDetails.append(createElement("span", "node-kind", node.isLeaf ? "Tip" : "Internal node"));

  const details = [];
  details.push(["Depth", node.depth]);
  details.push(["Descendant tips", node.descendantTips]);

  if (state.layout) {
    const rawLabel = state.layout.mode === "date"
      ? `${formatDecimalYear(node.xRaw)} (${Number(node.xRaw).toFixed(4)})`
      : formatAxisValue(node.xRaw, state.layout.mode);
    details.push([axisName(state.layout.mode), rawLabel]);
  }

  for (const [key, value] of nodeAttributeEntries(node.data)) {
    if (key === "div" || key === "num_date") continue;
    details.push([key.replaceAll("_", " "), value]);
  }

  const list = createElement("dl", "detail-list");
  for (const [label, value] of details) {
    const row = createElement("div", "detail-row");
    row.append(createElement("dt", "", label), createElement("dd", "", value));
    list.append(row);
  }
  refs.nodeDetails.append(list);
}

function renderAxis(axisLayer, layout) {
  axisLayer.selectAll("*").remove();
  const xStart = layout.margin.left;
  const xEnd = layout.width - layout.margin.right;

  axisLayer.append("line")
    .attr("class", "axis-domain")
    .attr("x1", xStart)
    .attr("x2", xEnd)
    .attr("y1", layout.yBottom)
    .attr("y2", layout.yBottom);

  const ticks = axisLayer.selectAll("g.axis-tick-group")
    .data(layout.ticks, (tick) => tick.value)
    .join("g")
    .attr("class", "axis-tick-group")
    .attr("transform", (tick) => `translate(${tick.x},${layout.yBottom})`);

  ticks.append("line")
    .attr("class", "axis-tick")
    .attr("y1", 0)
    .attr("y2", 6);

  ticks.append("text")
    .attr("class", "axis-tick-label")
    .attr("text-anchor", "middle")
    .attr("y", 20)
    .text((tick) => formatAxisValue(tick.value, layout.mode));

  axisLayer.append("text")
    .attr("class", "axis-title")
    .attr("text-anchor", "middle")
    .attr("x", (xStart + xEnd) / 2)
    .attr("y", layout.yBottom + 43)
    .text(axisName(layout.mode));
}

function renderScaleBar(scaleLayer, layout) {
  scaleLayer.selectAll("*").remove();
  const {x, y, pixels, raw} = layout.scaleBar;
  scaleLayer.append("line")
    .attr("class", "scale-bar")
    .attr("x1", x)
    .attr("x2", x + pixels)
    .attr("y1", y)
    .attr("y2", y);
  scaleLayer.append("line")
    .attr("class", "scale-bar-tick")
    .attr("x1", x)
    .attr("x2", x)
    .attr("y1", y - 4)
    .attr("y2", y + 4);
  scaleLayer.append("line")
    .attr("class", "scale-bar-tick")
    .attr("x1", x + pixels)
    .attr("x2", x + pixels)
    .attr("y1", y - 4)
    .attr("y2", y + 4);
  scaleLayer.append("text")
    .attr("class", "scale-bar-label")
    .attr("x", x + pixels / 2)
    .attr("y", y - 8)
    .attr("text-anchor", "middle")
    .text(`${formatAxisValue(raw, layout.mode)} ${axisName(layout.mode).toLowerCase()}`);
}

function renderTree({fit = false} = {}) {
  if (!state.model) return;

  const bounds = refs.treeStage.getBoundingClientRect();
  const viewWidth = Math.max(560, Math.round(bounds.width || 960));
  const viewHeight = Math.max(360, Math.round(bounds.height || 620));
  const worldWidth = Math.max(760, viewWidth);
  const viewMode = refs.viewSelect.value;
  const isRooted = viewMode === "rooted";
  state.viewMode = viewMode;
  state.orderMode = refs.orderSelect.value;

  if (isRooted) {
    const rightMargin = state.model.leaves.length > 80 ? 108 : 225;
    const margin = {top: 38, right: rightMargin, bottom: 68, left: 72};
    const rowHeight = fittedRowHeight(state.model.leaves.length, viewHeight, margin);
    state.layout = calculateLayout(state.model, {
      mode: refs.axisSelect.value,
      width: worldWidth,
      viewportHeight: viewHeight,
      rowHeight,
      margin
    });
    state.layout.view = "rooted";
  } else {
    state.layout = calculateUnrootedLayout(state.model, {
      mode: refs.axisSelect.value,
      width: worldWidth,
      viewportHeight: viewHeight,
      margin: {top: 58, right: 92, bottom: 72, left: 92}
    });
  }

  refs.treeSvg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
  refs.treeSvg.setAttribute("width", String(viewWidth));
  refs.treeSvg.setAttribute("height", String(viewHeight));
  refs.treeSvg.dataset.worldWidth = String(state.layout.width);
  refs.treeSvg.dataset.worldHeight = String(state.layout.height);
  refs.treeSvg.dataset.viewMode = viewMode;

  zoomBehavior
    .extent([[0, 0], [viewWidth, viewHeight]])
    .translateExtent([[-180, -180], [state.layout.width + 280, state.layout.height + 180]]);

  const axisLayer = viewport.selectAll("g.axis-layer")
    .data(isRooted ? [state.layout] : [])
    .join("g")
    .attr("class", "axis-layer");
  if (isRooted) renderAxis(axisLayer, state.layout);

  const scaleLayer = viewport.selectAll("g.scale-layer")
    .data(isRooted ? [] : [state.layout])
    .join("g")
    .attr("class", "scale-layer");
  if (!isRooted) renderScaleBar(scaleLayer, state.layout);

  const internalNodes = state.model.nodes.filter((node) => node.children.length > 0);
  viewport.selectAll("line.branch-vertical")
    .data(isRooted ? internalNodes : [], (node) => node.id)
    .join("line")
    .attr("class", "branch-vertical")
    .attr("data-node-id", (node) => node.id)
    .attr("x1", (node) => node.x)
    .attr("x2", (node) => node.x)
    .attr("y1", (node) => childYExtent(node)[0])
    .attr("y2", (node) => childYExtent(node)[1]);

  const nonRootNodes = state.model.nodes.filter((node) => node.parent);
  viewport.selectAll("line.branch-horizontal")
    .data(isRooted ? nonRootNodes : [], (node) => node.id)
    .join("line")
    .attr("class", "branch-horizontal")
    .attr("data-node-id", (node) => node.id)
    .attr("x1", (node) => node.parent.x)
    .attr("x2", (node) => node.x)
    .attr("y1", (node) => node.y)
    .attr("y2", (node) => node.y)
    .style("--branch-color", (node) => nodeColor(node));

  viewport.selectAll("line.branch-unrooted")
    .data(isRooted ? [] : nonRootNodes, (node) => node.id)
    .join("line")
    .attr("class", "branch-unrooted")
    .attr("data-node-id", (node) => node.id)
    .attr("x1", (node) => node.parent.x)
    .attr("x2", (node) => node.x)
    .attr("y1", (node) => node.parent.y)
    .attr("y2", (node) => node.y)
    .style("--branch-color", (node) => nodeColor(node));

  const nodes = viewport.selectAll("circle.tree-node")
    .data(state.model.nodes, (node) => node.id)
    .join("circle")
    .attr("class", (node) => `tree-node ${node.isLeaf ? "leaf" : "internal"}${node === state.model.root ? " root-node" : ""}`)
    .attr("data-node-id", (node) => node.id)
    .attr("cx", (node) => node.x)
    .attr("cy", (node) => node.y)
    .attr("r", (node) => nodeScreenRadius(node))
    .style("--node-color", (node) => node.isLeaf ? nodeColor(node) : INTERNAL_COLOR)
    .style("--branch-color", (node) => nodeColor(node))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (node) => `${node.isLeaf ? "Tip" : "Internal node"}: ${node.name}`)
    .on("click", (event, node) => {
      event.stopPropagation();
      selectNode(node);
    })
    .on("keydown", (event, node) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(node);
      }
    });

  nodes.selectAll("title")
    .data((node) => [node])
    .join("title")
    .text((node) => `${node.name}\n${node.isLeaf ? "Tip" : `${node.descendantTips} descendant tips`}`);

  viewport.selectAll("text.tip-label")
    .data(state.model.leaves, (node) => node.id)
    .join("text")
    .attr("class", "tip-label")
    .attr("data-node-id", (node) => node.id)
    .attr("x", (node) => node.x + 8)
    .attr("y", (node) => node.y)
    .text((node) => node.name)
    .on("click", (event, node) => {
      event.stopPropagation();
      selectNode(node);
    });

  refs.axisMetric.textContent = axisName(state.layout.mode);
  refs.colorStatus.textContent = state.colorKey
    ? (isRooted
      ? "Applied to horizontal branches and tip markers; connectors remain neutral."
      : "Applied to all unrooted branches and tip markers.")
    : (state.colorOptions.length === 0
      ? "No categorical metadata were found in this file."
      : "Choose a metadata field to color the tree.");
  refs.treeSvg.setAttribute(
    "aria-label",
    `${datasetTitle(state.dataset)}: ${formatCount(state.model.leaves.length)} tips, ${viewMode} view, ${axisName(state.layout.mode)} axis`
  );
  applyInteractiveClasses();
  updateZoomDependentStyles(state.currentTransform);

  if (fit || state.fitAfterRender) {
    state.fitAfterRender = false;
    fitTreeToView();
  } else {
    viewport.attr("transform", state.currentTransform.toString());
  }

  exposeTestState();
}

function applyInteractiveClasses() {
  if (!state.model) return;
  const hasQuery = refs.searchInput.value.trim().length > 0;
  const active = state.search.activeNodes;
  const matching = state.search.matchingLeaves;

  viewport.selectAll("line.branch-horizontal")
    .classed("is-dimmed", (node) => hasQuery && !active.has(node.id))
    .classed("is-match", (node) => hasQuery && active.has(node.id));

  viewport.selectAll("line.branch-unrooted")
    .classed("is-dimmed", (node) => hasQuery && !active.has(node.id))
    .classed("is-match", (node) => hasQuery && active.has(node.id));

  viewport.selectAll("line.branch-vertical")
    .classed("is-dimmed", (node) => hasQuery && !active.has(node.id))
    .classed("is-match", false);

  viewport.selectAll("circle.tree-node")
    .classed("is-dimmed", (node) => hasQuery && !active.has(node.id))
    .classed("is-match", (node) => hasQuery && matching.has(node.id))
    .classed("is-selected", (node) => node.id === state.selectedId);

  viewport.selectAll("text.tip-label")
    .classed("is-dimmed", (node) => hasQuery && !matching.has(node.id))
    .classed("is-match", (node) => hasQuery && matching.has(node.id))
    .classed("is-selected", (node) => node.id === state.selectedId);
}

function updateSearch() {
  if (!state.model) return;
  const query = refs.searchInput.value;
  state.search = findSearchMatches(state.model, query);
  const trimmed = query.trim();
  refs.clearSearchButton.hidden = trimmed.length === 0;
  refs.searchField.classList.toggle("has-query", trimmed.length > 0);
  if (!trimmed) refs.searchStatus.textContent = "Type to highlight matching tips.";
  else if (state.search.count === 0) refs.searchStatus.textContent = "No matching tips. Tree colors remain visible.";
  else refs.searchStatus.textContent = `${formatCount(state.search.count)} matching ${state.search.count === 1 ? "tip" : "tips"}; non-matches stay visible.`;
  applyInteractiveClasses();
  exposeTestState();
}

function clearSearch() {
  refs.searchInput.value = "";
  updateSearch();
  refs.searchInput.focus();
}

function fitTreeToView() {
  if (!state.layout) return;
  const bounds = refs.treeStage.getBoundingClientRect();
  const viewWidth = Math.max(560, Math.round(bounds.width || 960));
  const viewHeight = Math.max(360, Math.round(bounds.height || 620));
  const padding = 26;
  const worldWidth = Math.max(1, state.layout.width);
  const worldHeight = Math.max(1, state.layout.height);
  const scaleX = (viewWidth - padding * 2) / worldWidth;
  const scaleY = (viewHeight - padding * 2) / worldHeight;
  const scale = Math.max(0.06, Math.min(1.35, scaleX, scaleY));
  const x = (viewWidth - worldWidth * scale) / 2;
  const y = (viewHeight - worldHeight * scale) / 2;
  svg.call(zoomBehavior.transform, zoomIdentity.translate(x, y).scale(scale));
}

function renderDatasetSummary() {
  refs.datasetTitle.textContent = datasetTitle(state.dataset, state.fileName);
  refs.datasetTitle.title = refs.datasetTitle.textContent;
  refs.tipCount.textContent = formatCount(state.model.leaves.length);
  refs.nodeCount.textContent = formatCount(state.model.nodes.length);
}

function exposeTestState() {
  document.body.dataset.appReady = state.model ? "true" : "false";
  window.__PHYLOLOCAL_READY__ = Boolean(state.model);
  window.__PHYLOLOCAL_STATE__ = state.model ? {
    title: datasetTitle(state.dataset, state.fileName),
    nodeCount: state.model.nodes.length,
    tipCount: state.model.leaves.length,
    axis: state.layout?.mode ?? null,
    view: state.viewMode,
    order: state.orderMode,
    firstTip: state.model.leaves[0]?.name ?? null,
    lastTip: state.model.leaves.at(-1)?.name ?? null,
    colorBy: state.colorKey,
    searchMatches: state.search.count,
    selectedId: state.selectedId
  } : null;
}

function loadDataset(input, fileName = "local-dataset.json", sourceWarnings = []) {
  setStatus(`Validating ${fileName}…`, "busy");
  const validation = validateDataset(input);
  validation.warnings = [...sourceWarnings, ...validation.warnings];
  if (!validation.valid) {
    const messages = [...validation.errors, ...validation.warnings];
    renderDiagnostics(messages, "error");
    setStatus(`Could not load ${fileName}: ${validation.errors[0] ?? "invalid dataset"}`, "error");
    exposeTestState();
    return false;
  }

  try {
    const dataset = normalizeDataset(input);
    const model = buildTreeModel(dataset.tree);
    orderTree(model, refs.orderSelect.value);
    state.dataset = dataset;
    state.model = model;
    state.validation = validation;
    state.fileName = fileName;
    state.selectedId = null;
    state.orderMode = refs.orderSelect.value;
    state.viewMode = refs.viewSelect.value;
    state.search = {matchingLeaves: new Set(), activeNodes: new Set(), count: 0};
    state.fitAfterRender = true;
    refs.searchInput.value = "";
    refs.clearSearchButton.hidden = true;
    refs.searchField.classList.remove("has-query");
    refs.searchStatus.textContent = "Type to highlight matching tips.";

    updateAxisControls(validation);
    populateColorControls(dataset, model);
    renderDatasetSummary();
    renderNodeDetails(null);
    renderDiagnostics(validation.warnings, "warning");
    renderTree({fit: true});

    const warningSuffix = validation.warnings.length ? ` · ${validation.warnings.length} note${validation.warnings.length === 1 ? "" : "s"}` : "";
    setStatus(`Loaded ${fileName} locally · ${formatCount(model.leaves.length)} tips${warningSuffix}`);
    return true;
  } catch (error) {
    console.error(error);
    renderDiagnostics([error instanceof Error ? error.message : String(error)], "error");
    setStatus(`Could not render ${fileName}.`, "error");
    exposeTestState();
    return false;
  }
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    const limit = Math.round(MAX_FILE_BYTES / (1024 * 1024));
    renderDiagnostics([`The selected file is larger than the ${limit} MB safety limit.`], "error");
    setStatus(`File is too large to open safely in this browser tab.`, "error");
    return;
  }

  setStatus(`Reading ${file.name} locally…`, "busy");
  try {
    const text = await file.text();
    const parsed = parseDatasetText(text, file.name);
    loadDataset(parsed.dataset, file.name, parsed.warnings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderDiagnostics([message], "error");
    setStatus(`Could not read ${file.name}.`, "error");
  } finally {
    refs.fileInput.value = "";
  }
}

function exportCurrentSvg() {
  if (!state.layout) return;
  const clone = refs.treeSvg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `0 0 ${state.layout.width} ${state.layout.height}`);
  clone.setAttribute("width", String(Math.round(state.layout.width)));
  clone.setAttribute("height", String(Math.round(state.layout.height)));
  clone.querySelector("#treeViewport")?.setAttribute("transform", zoomIdentity.toString());
  clone.querySelector(".canvas-background")?.setAttribute("width", String(state.layout.width));
  clone.querySelector(".canvas-background")?.setAttribute("height", String(state.layout.height));

  const nodesById = new Map(state.model.nodes.map((node) => [node.id, node]));
  for (const circle of clone.querySelectorAll("circle.tree-node")) {
    const node = nodesById.get(circle.getAttribute("data-node-id"));
    if (node) circle.setAttribute("r", String(nodeScreenRadius(node)));
  }
  for (const label of clone.querySelectorAll("text.tip-label")) {
    const node = nodesById.get(label.getAttribute("data-node-id"));
    if (node && state.layout.view === "unrooted") {
      label.setAttribute("x", String(node.x + Math.cos(node.angle) * 8));
      label.setAttribute("y", String(node.y + Math.sin(node.angle) * 8));
      label.setAttribute("text-anchor", Math.cos(node.angle) < -0.08 ? "end" : Math.cos(node.angle) > 0.08 ? "start" : "middle");
    } else if (node) {
      label.setAttribute("x", String(node.x + 8));
      label.setAttribute("y", String(node.y));
      label.setAttribute("text-anchor", "start");
    }
    label.style.fontSize = "10.5px";
    label.classList.remove("labels-hidden");
  }

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    text { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .canvas-background { fill: #ffffff; }
    .axis-domain, .axis-tick { stroke: #8f9cae; stroke-width: 1; }
    .axis-tick-label, .axis-title { fill: #718096; font-size: 10px; }
    .axis-title { font-size: 10.5px; font-weight: 700; }
    .scale-bar, .scale-bar-tick { stroke: #718096; stroke-width: 1.2; }
    .scale-bar-label { fill: #718096; font-size: 10px; }
    .branch-vertical { stroke: #9aa6b7; stroke-width: 1.25; fill: none; }
    .branch-horizontal { stroke: var(--branch-color, #526175); stroke-width: 1.9; stroke-linecap: round; fill: none; }
    .branch-unrooted { stroke: var(--branch-color, #526175); stroke-width: 1.9; stroke-linecap: round; fill: none; }
    .tree-node { fill: var(--node-color, #ffffff); stroke: var(--branch-color, #526175); stroke-width: 1.35; }
    .tree-node.leaf { stroke-width: 1.7; }
    .tree-node.internal { fill: #ffffff; }
    .tip-label { fill: #344054; font-size: 10.5px; dominant-baseline: central; paint-order: stroke; stroke: #ffffff; stroke-width: 2.4px; }
    .branch-horizontal.is-dimmed { opacity: 0.48; }
    .branch-unrooted.is-dimmed { opacity: 0.48; }
    .branch-vertical.is-dimmed { opacity: 0.3; }
    .tree-node.is-dimmed { opacity: 0.78; }
    .tip-label.is-dimmed { opacity: 0.2; }
    .branch-horizontal.is-match { stroke-width: 3.1; opacity: 1; }
    .branch-unrooted.is-match { stroke-width: 3.1; opacity: 1; }
    .tree-node.is-match { stroke: #111827; stroke-width: 2.5; opacity: 1; }
    .tree-node.is-selected { stroke: #111827; stroke-width: 3; }
    .tip-label.is-match, .tip-label.is-selected { fill: #111827; font-weight: 800; opacity: 1; }
    .labels-hidden { display: none; }
    .labels-hidden.is-match, .labels-hidden.is-selected { display: block; }
  `;
  clone.insertBefore(style, clone.firstChild);

  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], {type: "image/svg+xml;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stem = state.fileName.replace(/\.(?:json|nwk|newick|tree|tre)$/i, "").replace(/[^a-z0-9_-]+/gi, "-") || "phylogeny";
  anchor.href = url;
  anchor.download = `${stem}-${state.layout.view}-${state.layout.mode}.svg`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(`Exported ${anchor.download}.`);
}

function setDropState(active) {
  refs.dropZone.classList.toggle("is-dragging", active);
  refs.dropOverlay.hidden = !active;
}

refs.fileInput.addEventListener("change", () => loadFile(refs.fileInput.files?.[0]));
refs.demoButton.addEventListener("click", () => loadDataset(demoDataset, "bundled-demo.json"));
refs.axisSelect.addEventListener("change", () => renderTree({fit: true}));
refs.viewSelect.addEventListener("change", () => {
  state.viewMode = refs.viewSelect.value;
  renderTree({fit: true});
});
refs.orderSelect.addEventListener("change", () => {
  if (!state.model) return;
  state.orderMode = refs.orderSelect.value;
  orderTree(state.model, state.orderMode);
  renderTree({fit: true});
});
refs.colorSelect.addEventListener("change", () => {
  state.colorKey = refs.colorSelect.value;
  refreshColorState();
  renderTree();
});
refs.searchInput.addEventListener("input", updateSearch);
refs.clearSearchButton.addEventListener("click", clearSearch);
refs.zoomInButton.addEventListener("click", () => svg.call(zoomBehavior.scaleBy, 1.3));
refs.zoomOutButton.addEventListener("click", () => svg.call(zoomBehavior.scaleBy, 1 / 1.3));
refs.resetButton.addEventListener("click", () => renderTree({fit: true}));
refs.exportButton.addEventListener("click", exportCurrentSvg);

for (const target of [refs.dropZone, refs.treeStage]) {
  target.addEventListener("dragenter", (event) => {
    event.preventDefault();
    setDropState(true);
  });
  target.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDropState(true);
  });
  target.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    setDropState(false);
  });
  target.addEventListener("drop", (event) => {
    event.preventDefault();
    setDropState(false);
    loadFile(event.dataTransfer?.files?.[0]);
  });
}

window.addEventListener("dragend", () => setDropState(false));
window.addEventListener("drop", () => setDropState(false));

if (typeof ResizeObserver === "function") {
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => renderTree({fit: true}), 80);
  });
  resizeObserver.observe(refs.treeStage);
} else {
  window.addEventListener("resize", () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => renderTree({fit: true}), 120);
  });
}

const modeRefs = {
  viewerButton: document.querySelector("#viewerModeButton"),
  radarButton: document.querySelector("#radarModeButton"),
  viewerApp: document.querySelector("#viewerApp"),
  radarApp: document.querySelector("#radarApp")
};
for (const [key, value] of Object.entries(modeRefs)) {
  if (!value) throw new Error(`Missing application mode element: ${key}`);
}

const radarController = initReassortmentRadar();

function setApplicationMode(mode) {
  const radarActive = mode === "radar";
  modeRefs.viewerApp.hidden = radarActive;
  modeRefs.radarApp.hidden = !radarActive;
  modeRefs.viewerButton.classList.toggle("is-active", !radarActive);
  modeRefs.radarButton.classList.toggle("is-active", radarActive);
  modeRefs.viewerButton.setAttribute("aria-pressed", String(!radarActive));
  modeRefs.radarButton.setAttribute("aria-pressed", String(radarActive));
  document.body.dataset.mode = radarActive ? "radar" : "viewer";
  if (radarActive) radarController.activate();
  else {
    radarController.deactivate();
    requestAnimationFrame(() => renderTree({fit: true}));
  }
}

modeRefs.viewerButton.addEventListener("click", () => setApplicationMode("viewer"));
modeRefs.radarButton.addEventListener("click", () => setApplicationMode("radar"));

loadDataset(demoDataset, "bundled-demo.json");
setApplicationMode("viewer");
