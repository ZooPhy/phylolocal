import {select} from "../vendor/d3-selection/index.js";
import {zoom, zoomIdentity} from "../vendor/d3-zoom/index.js";
import {
  buildTreeModel,
  calculateLayout,
  datasetTitle,
  normalizeDataset,
  orderTree,
  parseDatasetText,
  validateDataset
} from "./phylo-core.js";
import {analyzeTreeDiscordance, discordanceCsv, scoreColor} from "./reassortment-core.js";
import {radarDemoA, radarDemoB} from "./radar-demo.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const SVG_NS = "http://www.w3.org/2000/svg";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function cleanStem(name) {
  return String(name || "tree").replace(/\.(?:json|nwk|newick|tree|tre)$/i, "");
}

const SEGMENT_NAMES = ["PB2", "PB1", "PA", "HA", "NP", "NA", "M", "NS"];

function inferSegment(name) {
  const stem = cleanStem(name).toUpperCase();
  const tokens = stem.split(/[^A-Z0-9]+/).filter(Boolean);
  return SEGMENT_NAMES.find((segment) => tokens.includes(segment)) ?? null;
}

function treeDisplayTitle(slot) {
  const stem = cleanStem(slot?.fileName);
  const segment = inferSegment(slot?.fileName);
  return segment ? `${segment} segment · ${stem}` : stem;
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function pathIds(leaf) {
  const ids = new Set();
  let current = leaf;
  while (current) {
    ids.add(current.id);
    current = current.parent;
  }
  return ids;
}

function availableMode(validation) {
  return validation?.stats?.nodesWithDivergence > 0 ? "divergence" : "depth";
}

function fittedRowHeight(count, height) {
  if (count <= 1) return 18;
  return Math.max(3.2, Math.min(18, (height - 96) / (count - 1)));
}

function neighborhoodOptions(commonCount) {
  const maximum = Math.max(1, Number(commonCount) - 1);
  const values = [1, 3, 5, 10, 20].filter((value) => value <= maximum);
  if (!values.includes(maximum)) values.push(maximum);
  return [...new Set(values)].sort((left, right) => left - right);
}

export function initReassortmentRadar() {
  const refs = {
    app: document.querySelector("#radarApp"),
    fileA: document.querySelector("#radarFileA"),
    fileB: document.querySelector("#radarFileB"),
    fileNameA: document.querySelector("#radarFileNameA"),
    fileNameB: document.querySelector("#radarFileNameB"),
    dropA: document.querySelector("#radarDropA"),
    dropB: document.querySelector("#radarDropB"),
    demo: document.querySelector("#radarDemoButton"),
    k: document.querySelector("#radarKSelect"),
    threshold: document.querySelector("#radarThreshold"),
    thresholdValue: document.querySelector("#radarThresholdValue"),
    commonCount: document.querySelector("#radarCommonCount"),
    candidateCount: document.querySelector("#radarCandidateCount"),
    meanScore: document.querySelector("#radarMeanScore"),
    svg: document.querySelector("#radarSvg"),
    viewport: document.querySelector("#radarViewport"),
    stage: document.querySelector("#radarStage"),
    candidateList: document.querySelector("#radarCandidateList"),
    candidateDetails: document.querySelector("#radarCandidateDetails"),
    search: document.querySelector("#radarCandidateSearch"),
    searchField: document.querySelector("#radarSearchField"),
    clearSearch: document.querySelector("#radarClearSearchButton"),
    searchStatus: document.querySelector("#radarSearchStatus"),
    status: document.querySelector("#radarStatusText"),
    fit: document.querySelector("#radarFitButton"),
    export: document.querySelector("#radarExportCsvButton"),
    methodNote: document.querySelector("#radarMethodNote")
  };

  for (const [key, value] of Object.entries(refs)) {
    if (!value) throw new Error(`Missing Reassortment Radar element: ${key}`);
  }

  const svg = select(refs.svg);
  const viewport = select(refs.viewport);
  const state = {
    treeA: null,
    treeB: null,
    analysis: null,
    selectedName: null,
    transform: zoomIdentity,
    resizeTimer: null,
    active: false
  };

  const zoomBehavior = zoom()
    .scaleExtent([0.25, 18])
    .clickDistance(4)
    .on("zoom", (event) => {
      state.transform = event.transform;
      viewport.attr("transform", event.transform.toString());
    });
  svg.call(zoomBehavior);

  function setStatus(message, kind = "ready") {
    refs.status.textContent = message;
    refs.status.closest(".status-strip")?.classList.toggle("is-error", kind === "error");
    refs.status.closest(".status-strip")?.classList.toggle("is-busy", kind === "busy");
  }

  function makeSlot(parsed, fileName) {
    const validation = validateDataset(parsed.dataset);
    validation.warnings = [...parsed.warnings, ...validation.warnings];
    if (!validation.valid) throw new Error(validation.errors[0] || "Invalid phylogenetic dataset.");
    const dataset = normalizeDataset(parsed.dataset);
    const model = buildTreeModel(dataset.tree);
    orderTree(model, "input");
    return {dataset, model, validation, fileName};
  }

  function setSlot(which, slot) {
    state[which] = slot;
    const label = which === "treeA" ? refs.fileNameA : refs.fileNameB;
    label.textContent = slot.fileName;
    label.title = slot.fileName;
    analyze();
  }

  async function loadFile(file, which) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`${file.name} exceeds the 100 MB safety limit.`, "error");
      return;
    }
    setStatus(`Reading ${file.name} locally…`, "busy");
    try {
      const parsed = parseDatasetText(await file.text(), file.name);
      setSlot(which, makeSlot(parsed, file.name));
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      refs.fileA.value = "";
      refs.fileB.value = "";
    }
  }

  function loadDemo() {
    try {
      const parsedA = parseDatasetText(radarDemoA, "demo-HA.nwk");
      const parsedB = parseDatasetText(radarDemoB, "demo-NA.nwk");
      state.treeA = makeSlot(parsedA, "demo-HA.nwk");
      state.treeB = makeSlot(parsedB, "demo-NA.nwk");
      refs.fileNameA.textContent = state.treeA.fileName;
      refs.fileNameB.textContent = state.treeB.fileName;
      analyze();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function updateNeighborhoodControl(commonCount, effectiveK) {
    const maximum = Math.max(1, commonCount - 1);
    const options = neighborhoodOptions(commonCount);
    refs.k.replaceChildren(...options.map((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      const suffix = value === maximum ? " (maximum)" : "";
      option.textContent = `${value} neighbor${value === 1 ? "" : "s"}${suffix}`;
      return option;
    }));
    refs.k.value = String(effectiveK);
    refs.k.title = `A tip cannot be its own neighbor. With ${commonCount.toLocaleString("en-US")} shared tips, the maximum is ${maximum.toLocaleString("en-US")}.`;
  }

  function analyze() {
    if (!state.treeA || !state.treeB) {
      state.analysis = null;
      refs.commonCount.textContent = "—";
      refs.candidateCount.textContent = "—";
      refs.meanScore.textContent = "—";
      renderCandidateList();
      renderDetails(null);
      viewport.selectAll("*").remove();
      setStatus("Load two trees with matching tip names.");
      exposeState();
      return;
    }

    setStatus("Calculating phylogenetic neighborhoods locally…", "busy");
    try {
      state.analysis = analyzeTreeDiscordance(state.treeA.model, state.treeB.model, {
        k: Number(refs.k.value)
      });
      state.selectedName = state.analysis.candidates[0]?.name ?? null;
      refs.commonCount.textContent = state.analysis.commonCount.toLocaleString("en-US");
      refs.meanScore.textContent = percent(state.analysis.meanScore);
      updateNeighborhoodControl(state.analysis.commonCount, state.analysis.k);
      const maximumNeighbors = state.analysis.commonCount - 1;
      const jaccardLink = document.createElement("a");
      jaccardLink.href = "https://en.wikipedia.org/wiki/Jaccard_index";
      jaccardLink.target = "_blank";
      jaccardLink.rel = "noopener noreferrer";
      jaccardLink.textContent = "Jaccard distances";
      refs.methodNote.replaceChildren(
        document.createTextNode(`Using ${state.analysis.k} nearest neighbors per tip. A tip cannot be its own neighbor, so ${state.analysis.commonCount} shared tips allow at most ${maximumNeighbors}. Scores are `),
        jaccardLink,
        document.createTextNode(".")
      );
      updateResults();
      const unmatched = state.analysis.onlyA.length + state.analysis.onlyB.length;
      const segmentA = inferSegment(state.treeA.fileName);
      const segmentB = inferSegment(state.treeB.fileName);
      const segmentPair = segmentA && segmentB ? `${segmentA} vs ${segmentB} · ` : "";
      const sameSegmentWarning = segmentA && segmentB && segmentA === segmentB
        ? ` Warning: both filenames appear to represent ${segmentA}.`
        : "";
      setStatus(
        `${segmentPair}compared ${state.analysis.commonCount.toLocaleString("en-US")} shared tips locally${unmatched ? ` · ${unmatched.toLocaleString("en-US")} unmatched` : ""}.${sameSegmentWarning}`
      );
    } catch (error) {
      console.error(error);
      state.analysis = null;
      viewport.selectAll("*").remove();
      renderCandidateList();
      renderDetails(null);
      setStatus(error instanceof Error ? error.message : String(error), "error");
      exposeState();
    }
  }

  function searchMatches() {
    if (!state.analysis) return [];
    const query = refs.search.value.trim().toLocaleLowerCase();
    if (!query) return [];
    return state.analysis.candidates.filter((candidate) => (
      candidate.name.toLocaleLowerCase().includes(query)
    ));
  }

  function filteredCandidates() {
    if (!state.analysis) return [];
    const query = refs.search.value.trim();
    if (query) return searchMatches();
    const threshold = Number(refs.threshold.value);
    return state.analysis.candidates.filter((candidate) => candidate.score >= threshold);
  }

  function updateSearchUi({selectBestMatch = false} = {}) {
    const query = refs.search.value.trim();
    refs.searchField.classList.toggle("has-query", Boolean(query));
    refs.clearSearch.hidden = !query;

    if (!state.analysis) {
      refs.searchStatus.textContent = "Load both trees before searching matched samples.";
      return;
    }
    if (!query) {
      refs.searchStatus.textContent = "Type a sample name to select and highlight it in both trees.";
      return;
    }

    const matches = searchMatches();
    if (!matches.length) {
      refs.searchStatus.textContent = `No shared sample contains “${query}”.`;
      return;
    }

    if (selectBestMatch) {
      const lowerQuery = query.toLocaleLowerCase();
      const selected = matches.find((candidate) => candidate.name.toLocaleLowerCase() === lowerQuery)
        ?? matches.find((candidate) => candidate.name.toLocaleLowerCase().startsWith(lowerQuery))
        ?? matches[0];
      state.selectedName = selected.name;
    }

    const selected = state.analysis.candidateByName.get(state.selectedName);
    const belowThreshold = selected && selected.score < Number(refs.threshold.value);
    refs.searchStatus.textContent = `${matches.length.toLocaleString("en-US")} matched sample${matches.length === 1 ? "" : "s"}${selected ? ` · selected ${selected.name}` : ""}${belowThreshold ? " · below candidate threshold but highlighted" : ""}.`;
  }

  function updateResults({searchChanged = false} = {}) {
    refs.thresholdValue.textContent = percent(refs.threshold.value);
    updateSearchUi({selectBestMatch: searchChanged});
    const visible = filteredCandidates();
    refs.candidateCount.textContent = visible.length.toLocaleString("en-US");
    renderCandidateList(visible);
    const selected = state.analysis?.candidateByName.get(state.selectedName) ?? null;
    renderDetails(selected);
    renderRadar();
    exposeState();
  }

  function selectCandidate(name) {
    if (!state.analysis?.candidateByName.has(name)) return;
    state.selectedName = name;
    renderCandidateList(filteredCandidates());
    renderDetails(state.analysis.candidateByName.get(name));
    renderRadar();
    exposeState();
  }

  function renderCandidateList(candidates = []) {
    refs.candidateList.replaceChildren();
    if (!state.analysis) {
      refs.candidateList.append(element("p", "muted-copy", "Load both trees to rank candidate discordance."));
      return;
    }
    if (!candidates.length) {
      const hasQuery = Boolean(refs.search.value.trim());
      refs.candidateList.append(element("p", "muted-copy", hasQuery
        ? "No shared samples match this search."
        : "No samples meet the current candidate threshold."));
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const candidate of candidates.slice(0, 500)) {
      const button = element("button", `candidate-row${candidate.name === state.selectedName ? " is-selected" : ""}`);
      button.type = "button";
      button.dataset.tipName = candidate.name;
      const rank = state.analysis.candidates.indexOf(candidate) + 1;
      const rankNode = element("span", "candidate-rank", rank);
      const name = element("span", "candidate-name", candidate.name);
      name.title = candidate.name;
      const score = element("span", "candidate-score", percent(candidate.score));
      score.style.setProperty("--score-color", scoreColor(candidate.score));
      const bar = element("span", "candidate-bar");
      bar.style.setProperty("--score-width", percent(candidate.score));
      bar.style.setProperty("--score-color", scoreColor(candidate.score));
      button.append(rankNode, name, score, bar);
      button.addEventListener("click", () => selectCandidate(candidate.name));
      fragment.append(button);
    }
    refs.candidateList.append(fragment);
  }

  function chips(values, className) {
    const container = element("div", `neighbor-chips ${className}`);
    if (!values.length) container.append(element("span", "neighbor-chip is-empty", "None"));
    for (const value of values) {
      const chip = element("button", "neighbor-chip", value);
      chip.type = "button";
      chip.addEventListener("click", () => selectCandidate(value));
      container.append(chip);
    }
    return container;
  }

  function renderDetails(candidate) {
    refs.candidateDetails.replaceChildren();
    if (!candidate || !state.analysis) {
      const empty = element("div", "empty-details");
      empty.append(element("div", "empty-details-icon", "⌁"), element("p", "", "Select a ranked sample to compare its neighborhoods."));
      refs.candidateDetails.append(empty);
      return;
    }

    const header = element("div", "radar-detail-heading");
    header.append(element("h3", "radar-sample-name", candidate.name));
    const badge = element("span", "discordance-badge", `${percent(candidate.score)} discordance`);
    badge.style.setProperty("--score-color", scoreColor(candidate.score));
    header.append(badge);
    refs.candidateDetails.append(header);

    const summary = element("dl", "detail-list");
    for (const [label, value] of [
      ["Neighbors used", `${state.analysis.k} of ${state.analysis.commonCount - 1} possible`],
      ["Shared neighbors", candidate.sharedNeighbors.length],
      ["Tree A-only neighbors", candidate.uniqueA.length],
      ["Tree B-only neighbors", candidate.uniqueB.length]
    ]) {
      const row = element("div", "detail-row");
      row.append(element("dt", "", label), element("dd", "", value));
      summary.append(row);
    }
    refs.candidateDetails.append(summary);

    refs.candidateDetails.append(element("h4", "neighbor-title tree-a-title", `${treeDisplayTitle(state.treeA)} nearest neighbors`));
    refs.candidateDetails.append(chips(candidate.neighborsA, "tree-a-neighbors"));
    refs.candidateDetails.append(element("h4", "neighbor-title tree-b-title", `${treeDisplayTitle(state.treeB)} nearest neighbors`));
    refs.candidateDetails.append(chips(candidate.neighborsB, "tree-b-neighbors"));
    refs.candidateDetails.append(element("h4", "neighbor-title", "Shared in both trees"));
    refs.candidateDetails.append(chips(candidate.sharedNeighbors, "shared-neighbors"));

    const caution = element("p", "scientific-caution", "A high score flags phylogenetic discordance consistent with reassortment; it is not confirmation. Sampling, weak signal, rooting, and tree uncertainty can also change neighborhoods.");
    refs.candidateDetails.append(caution);
  }

  function drawTree(group, slot, coordinates, side, selectedPath, neighbors, selectedName) {
    const nonRoot = slot.model.nodes.filter((node) => node.parent);
    const internals = slot.model.nodes.filter((node) => node.children.length > 0);
    const yExtent = (node) => {
      const ys = node.children.map((child) => coordinates.get(child.id).y);
      return [Math.min(...ys), Math.max(...ys)];
    };

    group.selectAll(`line.radar-vertical-${side}`)
      .data(internals)
      .join("line")
      .attr("class", `radar-tree-branch radar-vertical radar-vertical-${side}`)
      .attr("x1", (node) => coordinates.get(node.id).x)
      .attr("x2", (node) => coordinates.get(node.id).x)
      .attr("y1", (node) => yExtent(node)[0])
      .attr("y2", (node) => yExtent(node)[1])
      .classed("is-selected-path", (node) => selectedPath.has(node.id));

    group.selectAll(`line.radar-horizontal-${side}`)
      .data(nonRoot)
      .join("line")
      .attr("class", `radar-tree-branch radar-horizontal radar-horizontal-${side}`)
      .attr("x1", (node) => coordinates.get(node.parent.id).x)
      .attr("x2", (node) => coordinates.get(node.id).x)
      .attr("y1", (node) => coordinates.get(node.id).y)
      .attr("y2", (node) => coordinates.get(node.id).y)
      .classed("is-selected-path", (node) => selectedPath.has(node.id));

    group.selectAll(`circle.radar-node-${side}`)
      .data(slot.model.nodes)
      .join("circle")
      .attr("class", (node) => `radar-tree-node radar-node-${side}${node.isLeaf ? " is-leaf" : ""}`)
      .attr("cx", (node) => coordinates.get(node.id).x)
      .attr("cy", (node) => coordinates.get(node.id).y)
      .attr("r", (node) => node.isLeaf ? 2.7 : 1.6)
      .classed("is-selected-tip", (node) => node.isLeaf && node.name === selectedName)
      .classed("is-neighbor-tip", (node) => node.isLeaf && neighbors.has(node.name))
      .attr("data-tip-name", (node) => node.isLeaf ? node.name : null)
      .on("click", (event, node) => {
        if (!node.isLeaf || !state.analysis.candidateByName.has(node.name)) return;
        event.stopPropagation();
        selectCandidate(node.name);
      });
  }

  function renderRadar() {
    viewport.selectAll("*").remove();
    if (!state.analysis || !state.treeA || !state.treeB || !state.active) return;

    const bounds = refs.stage.getBoundingClientRect();
    const width = Math.max(760, Math.round(bounds.width || 1000));
    const height = Math.max(430, Math.round(bounds.height || 620));
    refs.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    refs.svg.setAttribute("width", width);
    refs.svg.setAttribute("height", height);

    const gap = Math.max(220, Math.min(360, width * 0.28));
    const panelWidth = (width - gap) / 2;
    const maxTips = Math.max(state.treeA.model.leaves.length, state.treeB.model.leaves.length);
    const rowHeight = fittedRowHeight(maxTips, height);
    const margin = {top: 58, right: 24, bottom: 42, left: 30};
    const modeA = availableMode(state.treeA.validation);
    const modeB = availableMode(state.treeB.validation);
    const layoutA = calculateLayout(state.treeA.model, {mode: modeA, width: panelWidth, viewportHeight: height, rowHeight, margin});
    const coordsA = new Map(state.treeA.model.nodes.map((node) => [node.id, {x: node.x, y: node.y}]));
    const layoutB = calculateLayout(state.treeB.model, {mode: modeB, width: panelWidth, viewportHeight: height, rowHeight, margin});
    const coordsB = new Map(state.treeB.model.nodes.map((node) => [node.id, {x: width - node.x, y: node.y}]));

    zoomBehavior.extent([[0, 0], [width, height]]).translateExtent([[-160, -160], [width + 160, height + 160]]);

    viewport.append("text")
      .attr("class", "radar-tree-title")
      .attr("x", 28)
      .attr("y", 28)
      .text(treeDisplayTitle(state.treeA));
    viewport.append("text")
      .attr("class", "radar-tree-title")
      .attr("text-anchor", "end")
      .attr("x", width - 28)
      .attr("y", 28)
      .text(treeDisplayTitle(state.treeB));
    viewport.append("text")
      .attr("class", "radar-center-title")
      .attr("text-anchor", "middle")
      .attr("x", width / 2)
      .attr("y", 27)
      .text("matched tips · connector color = discordance");

    const selected = state.analysis.candidateByName.get(state.selectedName) ?? state.analysis.candidates[0];
    const leafA = state.analysis.leavesA.get(selected.name);
    const leafB = state.analysis.leavesB.get(selected.name);
    const pathA = pathIds(leafA);
    const pathB = pathIds(leafB);
    const neighborsA = new Set(selected.neighborsA);
    const neighborsB = new Set(selected.neighborsB);

    const connectionLayer = viewport.append("g").attr("class", "radar-connections");
    const maxConnectors = 1600;
    const connectorCandidates = state.analysis.candidates.slice(0, maxConnectors);
    connectionLayer.selectAll("path.radar-connector")
      .data(connectorCandidates, (candidate) => candidate.name)
      .join("path")
      .attr("class", "radar-connector")
      .attr("data-tip-name", (candidate) => candidate.name)
      .attr("d", (candidate) => {
        const left = coordsA.get(state.analysis.leavesA.get(candidate.name).id);
        const right = coordsB.get(state.analysis.leavesB.get(candidate.name).id);
        const bend = Math.max(32, (right.x - left.x) * 0.38);
        return `M${left.x},${left.y} C${left.x + bend},${left.y} ${right.x - bend},${right.y} ${right.x},${right.y}`;
      })
      .style("--score-color", (candidate) => scoreColor(candidate.score))
      .style("--score-opacity", (candidate) => String(0.17 + candidate.score * 0.58))
      .classed("is-selected", (candidate) => candidate.name === selected.name)
      .classed("is-below-threshold", (candidate) => candidate.score < Number(refs.threshold.value))
      .on("click", (event, candidate) => {
        event.stopPropagation();
        selectCandidate(candidate.name);
      })
      .append("title")
      .text((candidate) => `${candidate.name}: ${percent(candidate.score)} neighborhood discordance`);

    drawTree(viewport.append("g").attr("class", "radar-tree-a"), state.treeA, coordsA, "a", pathA, neighborsA, selected.name);
    drawTree(viewport.append("g").attr("class", "radar-tree-b"), state.treeB, coordsB, "b", pathB, neighborsB, selected.name);

    const showAllLabels = state.analysis.commonCount <= 28;
    const labelNames = new Set([selected.name, ...selected.neighborsA, ...selected.neighborsB]);
    const labelData = state.analysis.commonNames.filter((name) => showAllLabels || labelNames.has(name));

    viewport.append("g").attr("class", "radar-labels-a")
      .selectAll("text")
      .data(labelData)
      .join("text")
      .attr("class", (name) => `radar-tip-label${name === selected.name ? " is-selected" : ""}`)
      .attr("x", (name) => coordsA.get(state.analysis.leavesA.get(name).id).x - 6)
      .attr("y", (name) => coordsA.get(state.analysis.leavesA.get(name).id).y)
      .attr("text-anchor", "end")
      .text((name) => name)
      .on("click", (event, name) => {
        event.stopPropagation();
        selectCandidate(name);
      });

    viewport.append("g").attr("class", "radar-labels-b")
      .selectAll("text")
      .data(labelData)
      .join("text")
      .attr("class", (name) => `radar-tip-label${name === selected.name ? " is-selected" : ""}`)
      .attr("x", (name) => coordsB.get(state.analysis.leavesB.get(name).id).x + 6)
      .attr("y", (name) => coordsB.get(state.analysis.leavesB.get(name).id).y)
      .attr("text-anchor", "start")
      .text((name) => name)
      .on("click", (event, name) => {
        event.stopPropagation();
        selectCandidate(name);
      });

    viewport.append("text")
      .attr("class", "radar-axis-note")
      .attr("x", 28)
      .attr("y", height - 17)
      .text(`${modeA === "divergence" ? "Branch length" : "Branch depth"} · ${state.treeA.model.leaves.length.toLocaleString("en-US")} tips`);
    viewport.append("text")
      .attr("class", "radar-axis-note")
      .attr("text-anchor", "end")
      .attr("x", width - 28)
      .attr("y", height - 17)
      .text(`${modeB === "divergence" ? "Branch length" : "Branch depth"} · ${state.treeB.model.leaves.length.toLocaleString("en-US")} tips`);

    viewport.attr("transform", state.transform.toString());
  }

  function fit() {
    state.transform = zoomIdentity;
    svg.call(zoomBehavior.transform, zoomIdentity);
  }

  function exportCsv() {
    if (!state.analysis) return;
    const csv = discordanceCsv(state.analysis, {
      treeAName: cleanStem(state.treeA.fileName),
      treeBName: cleanStem(state.treeB.fileName)
    });
    const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${cleanStem(state.treeA.fileName)}-vs-${cleanStem(state.treeB.fileName)}-discordance.csv`.replace(/[^a-z0-9_.-]+/gi, "-");
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus(`Exported ${anchor.download}.`);
  }

  function exposeState() {
    window.__PHYLOLOCAL_RADAR__ = state.analysis ? {
      ready: true,
      commonCount: state.analysis.commonCount,
      candidateCount: filteredCandidates().length,
      searchQuery: refs.search.value.trim(),
      searchMatchCount: searchMatches().length,
      meanScore: state.analysis.meanScore,
      selectedName: state.selectedName,
      topCandidate: state.analysis.candidates[0]?.name ?? null,
      topScore: state.analysis.candidates[0]?.score ?? null,
      k: state.analysis.k,
      maxK: state.analysis.commonCount - 1,
      treeAName: cleanStem(state.treeA.fileName),
      treeBName: cleanStem(state.treeB.fileName),
      segmentA: inferSegment(state.treeA.fileName),
      segmentB: inferSegment(state.treeB.fileName)
    } : {ready: false};
  }

  refs.fileA.addEventListener("change", () => loadFile(refs.fileA.files?.[0], "treeA"));
  refs.fileB.addEventListener("change", () => loadFile(refs.fileB.files?.[0], "treeB"));
  refs.demo.addEventListener("click", loadDemo);
  refs.k.addEventListener("change", analyze);
  refs.threshold.addEventListener("input", () => updateResults());
  refs.search.addEventListener("input", () => updateResults({searchChanged: true}));
  refs.search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !refs.search.value) return;
    event.preventDefault();
    refs.clearSearch.click();
  });
  refs.clearSearch.addEventListener("click", () => {
    refs.search.value = "";
    if (state.analysis) {
      state.selectedName = state.analysis.candidates.find((candidate) => candidate.score >= Number(refs.threshold.value))?.name
        ?? state.analysis.candidates[0]?.name
        ?? null;
    }
    updateResults();
    refs.search.focus();
  });
  refs.fit.addEventListener("click", fit);
  refs.export.addEventListener("click", exportCsv);
  svg.on("click", () => {});

  for (const [drop, input, which] of [
    [refs.dropA, refs.fileA, "treeA"],
    [refs.dropB, refs.fileB, "treeB"]
  ]) {
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("is-dragging");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("is-dragging");
      loadFile(event.dataTransfer?.files?.[0], which);
    });
  }

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      if (!state.active) return;
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(renderRadar, 80);
    });
    observer.observe(refs.stage);
  }

  loadDemo();

  return {
    activate() {
      state.active = true;
      requestAnimationFrame(() => {
        fit();
        renderRadar();
      });
    },
    deactivate() {
      state.active = false;
    },
    refresh: renderRadar
  };
}
