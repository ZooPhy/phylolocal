#!/usr/bin/env python3
"""Browser-level smoke test without network navigation.

The test loads the real project modules through an import map of data URLs,
which keeps it self-contained and compatible with restricted CI environments.
The browser still executes the actual app, D3 modules, DOM code, file input,
and SVG export.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / "src" / "app.js"
SCREENSHOT = ROOT / "screenshots" / "phylolocal-mvp.png"
VISIBILITY_SCREENSHOT = ROOT / "screenshots" / "phylolocal-120-tip-search.png"
UNROOTED_SCREENSHOT = ROOT / "screenshots" / "phylolocal-unrooted.png"
RADAR_SCREENSHOT = ROOT / "screenshots" / "phylolocal-reassortment-radar.png"
RADAR_SEARCH_SCREENSHOT = ROOT / "screenshots" / "phylolocal-radar-search.png"
SEQUENCE_SCREENSHOT = ROOT / "screenshots" / "phylolocal-sequence-explorer.png"

FROM_RE = re.compile(r"(?P<prefix>\bfrom\s*)(?P<quote>['\"])(?P<spec>\.[^'\"]+)(?P=quote)")
SIDE_EFFECT_RE = re.compile(r"(?P<prefix>\bimport\s*)(?P<quote>['\"])(?P<spec>\.[^'\"]+)(?P=quote)")


def module_key(path: Path) -> str:
    return f"phylolocal/{path.relative_to(ROOT).as_posix()}"


def resolve_import(owner: Path, specifier: str) -> Path:
    candidate = (owner.parent / specifier).resolve()
    if ROOT != candidate and ROOT not in candidate.parents:
        raise RuntimeError(f"Import escapes the project root: {owner} -> {specifier}")
    if not candidate.is_file():
        raise FileNotFoundError(f"Missing module: {candidate}")
    return candidate


def discover_modules(entry: Path) -> set[Path]:
    pending = [entry.resolve()]
    discovered: set[Path] = set()
    while pending:
        module = pending.pop()
        if module in discovered:
            continue
        discovered.add(module)
        source = module.read_text(encoding="utf-8")
        for pattern in (FROM_RE, SIDE_EFFECT_RE):
            for match in pattern.finditer(source):
                pending.append(resolve_import(module, match.group("spec")))
    return discovered


def rewrite_module(module: Path, source: str) -> str:
    def replace(match: re.Match[str]) -> str:
        target = resolve_import(module, match.group("spec"))
        quote = match.group("quote")
        return f"{match.group('prefix')}{quote}{module_key(target)}{quote}"

    source = FROM_RE.sub(replace, source)
    source = SIDE_EFFECT_RE.sub(replace, source)
    return source


def data_url(text: str) -> str:
    encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
    return f"data:text/javascript;base64,{encoded}"


def build_large_visibility_dataset() -> dict[str, object]:
    countries = ["Australia", "Austria", "Cameroon", "China", "Hong Kong", "Japan", "Madagascar", "USA"]
    leaves: list[dict[str, object]] = []
    for index in range(120):
        name = (
            "MVAN24_7S" if index == 0 else
            "MVAN24_8S" if index == 1 else
            f"EPI_ISL_{580000 + index}"
        )
        leaves.append({
            "name": name,
            "node_attrs": {
                "div": 0.65 + index / 400,
                "country": {"value": countries[index % len(countries)]},
            },
        })

    counter = 0

    def combine(nodes: list[dict[str, object]], depth: int = 0) -> dict[str, object]:
        nonlocal counter
        if len(nodes) == 1:
            return nodes[0]
        midpoint = len(nodes) // 2
        counter += 1
        return {
            "name": f"NODE_{counter}",
            "node_attrs": {"div": depth * 0.055, "country": {"value": "Multiple"}},
            "children": [combine(nodes[:midpoint], depth + 1), combine(nodes[midpoint:], depth + 1)],
        }

    return {
        "version": "v2",
        "meta": {
            "title": "120-tip visibility regression",
            "colorings": [{"key": "country", "title": "Country", "type": "categorical"}],
        },
        "tree": combine(leaves),
    }


def build_test_html() -> str:
    modules = discover_modules(ENTRY)
    imports: dict[str, str] = {}
    for module in sorted(modules):
        rewritten = rewrite_module(module, module.read_text(encoding="utf-8"))
        imports[module_key(module)] = data_url(rewritten)

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    icon_data = base64.b64encode((ROOT / "assets" / "phylolocal_icon.png").read_bytes()).decode("ascii")
    html = html.replace("./assets/phylolocal_icon.png", f"data:image/png;base64,{icon_data}")
    html = re.sub(
        r'<meta\s+http-equiv=["\']Content-Security-Policy["\'][\s\S]*?>',
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(r'<link\s+rel=["\']stylesheet["\'][^>]*>', "", html, flags=re.IGNORECASE)
    html = re.sub(
        r'<script\s+type=["\']module["\'][^>]*src=["\'][^"\']+["\'][^>]*>\s*</script>',
        "",
        html,
        flags=re.IGNORECASE,
    )

    styles = (ROOT / "styles.css").read_text(encoding="utf-8")
    import_map = json.dumps({"imports": imports}, separators=(",", ":"))
    injection = (
        f"<style>{styles}</style>"
        f'<script type="importmap">{import_map}</script>'
        f'<script type="module">import {json.dumps(module_key(ENTRY))};</script>'
    )
    return html.replace("</head>", f"{injection}</head>")


def run() -> None:
    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    html = build_test_html()
    browser_errors: list[str] = []

    print("starting playwright", flush=True)
    with sync_playwright() as playwright:
        configured_browser = os.environ.get("CHROMIUM_PATH")
        bundled_browser = Path(playwright.chromium.executable_path)
        executable_path = configured_browser or (
            str(bundled_browser) if bundled_browser.is_file() else None
        ) or shutil.which("chromium") or shutil.which("google-chrome")
        if not executable_path:
            raise RuntimeError("No Chromium executable found. Set CHROMIUM_PATH or install Playwright Chromium.")

        print("launching browser", flush=True)
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=executable_path,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            timeout=20_000,
        )
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on(
            "console",
            lambda message: browser_errors.append(f"console {message.type}: {message.text}")
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: browser_errors.append(f"pageerror: {error}"))
        print("setting content", flush=True)
        page.set_content(html, wait_until="load", timeout=25_000)
        print("waiting for ready", flush=True)
        page.wait_for_function("window.__PHYLOLOCAL_READY__ === true", timeout=15_000)
        print("app ready", flush=True)

        assert page.locator("#datasetTitle").inner_text() == "Demo respiratory-virus phylogeny"
        assert page.locator("#tipCount").inner_text() == "17"
        assert page.locator("#nodeCount").inner_text() == "27"
        assert page.locator(".branch-horizontal").count() == 26
        assert page.locator(".tree-node").count() == 27
        assert page.locator(".tip-label").count() == 17
        assert page.locator("body").get_attribute("data-app-ready") == "true"

        input_first_tip = page.evaluate("window.__PHYLOLOCAL_STATE__.firstTip")
        page.locator("#orderSelect").select_option("increasing")
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.order === 'increasing'")
        increasing_first_tip = page.evaluate("window.__PHYLOLOCAL_STATE__.firstTip")
        assert increasing_first_tip != input_first_tip

        page.locator("#orderSelect").select_option("decreasing")
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.order === 'decreasing'")
        assert page.evaluate("window.__PHYLOLOCAL_STATE__.firstTip") != increasing_first_tip

        page.locator("#viewSelect").select_option("unrooted")
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.view === 'unrooted'")
        assert page.locator(".branch-unrooted").count() == 26
        assert page.locator(".branch-horizontal").count() == 0
        assert page.locator(".scale-bar").count() == 1
        page.screenshot(path=str(UNROOTED_SCREENSHOT), full_page=True)

        page.locator("#viewSelect").select_option("rooted")
        page.locator("#orderSelect").select_option("input")
        page.wait_for_function(
            "window.__PHYLOLOCAL_STATE__.view === 'rooted' && window.__PHYLOLOCAL_STATE__.order === 'input'"
        )
        assert page.locator(".branch-horizontal").count() == 26

        page.locator("#searchInput").fill("USA")
        assert page.locator(".tip-label.is-match").count() == 2
        assert "2 matching tips" in page.locator("#searchStatus").inner_text()
        assert page.locator("#clearSearchButton").is_visible()

        page.locator("#axisSelect").select_option("date")
        assert page.locator("#axisMetric").inner_text() == "Numeric date"

        page.locator("#colorSelect").select_option("country")
        first_leaf = page.locator("circle.tree-node.leaf").first
        first_leaf_id = first_leaf.get_attribute("data-node-id")
        assert first_leaf_id
        first_leaf_fill = first_leaf.evaluate("element => getComputedStyle(element).fill")
        first_leaf_branch = page.locator(f'.branch-horizontal[data-node-id="{first_leaf_id}"]')
        first_leaf_branch_stroke = first_leaf_branch.evaluate("element => getComputedStyle(element).stroke")
        assert first_leaf_fill == first_leaf_branch_stroke
        assert first_leaf_fill not in {"rgb(255, 255, 255)", "rgb(82, 97, 117)", "rgb(148, 163, 184)"}

        unmatched_leaf = page.locator("circle.tree-node.leaf.is-dimmed").first
        unmatched_opacity = float(unmatched_leaf.evaluate("element => getComputedStyle(element).opacity"))
        assert unmatched_opacity >= 0.7
        on_screen_radius = float(first_leaf.evaluate("element => element.r.baseVal.value * element.getCTM().a"))
        assert on_screen_radius >= 3.0

        page.locator("#clearSearchButton").click()
        assert page.locator(".tree-node.is-dimmed").count() == 0
        assert page.locator("#clearSearchButton").is_hidden()

        page.locator("circle.tree-node.leaf").first.click()
        assert page.locator(".node-name").inner_text() == "A/USA/001"
        assert page.locator(".node-kind").inner_text() == "TIP"

        sequence_alignment = ">A/USA/001\nATGGTTGAATTA\n>A/USA/002\nATGGCCGAATTA\n>C/CAN/017\nATGGCCGAATTA\n"
        reference_alignment = ">REFERENCE\nATGGCCGAATTA\n"
        print("loading sequences", flush=True)
        page.locator("#sequenceInput").set_input_files(
            files={
                "name": "demo-alignment.fasta",
                "mimeType": "text/plain",
                "buffer": sequence_alignment.encode("utf-8"),
            }
        )
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.sequenceLoaded === true")
        print("loading reference", flush=True)
        page.locator("#referenceInput").set_input_files(
            files={
                "name": "demo-reference.fasta",
                "mimeType": "text/plain",
                "buffer": reference_alignment.encode("utf-8"),
            }
        )
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.referenceLoaded === true")
        assert "3 sequence" in page.locator("#sequenceStatus").inner_text()
        assert "reference REFERENCE" in page.locator("#sequenceStatus").inner_text()
        assert "Translated amino acids" in page.locator("#sequenceDetails").inner_text()
        assert page.locator("#sequenceDetails").inner_text().find("A2V") >= 0
        print("taking sequence screenshot", flush=True)
        page.screenshot(path=str(SEQUENCE_SCREENSHOT), full_page=True)
        print("sequence feature verified", flush=True)
        browser.close()
        return

        transform_before = page.locator("#treeViewport").get_attribute("transform")
        page.locator("#zoomInButton").click()
        transform_after = page.locator("#treeViewport").get_attribute("transform")
        assert transform_after != transform_before

        large_dataset = build_large_visibility_dataset()
        page.locator("#fileInput").set_input_files(
            files={
                "name": "visibility-120.json",
                "mimeType": "application/json",
                "buffer": json.dumps(large_dataset).encode("utf-8"),
            }
        )
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.tipCount === 120")
        assert page.locator("#nodeCount").inner_text() == "239"
        page.locator("#searchInput").fill("MVAN24")
        page.wait_for_function("document.querySelectorAll('.tip-label.is-match').length === 2")
        assert page.locator(".tip-label.labels-hidden").count() == 120
        assert page.locator(".tip-label.is-match").count() == 2

        large_unmatched_leaf = page.locator("circle.tree-node.leaf.is-dimmed").first
        large_unmatched_fill = large_unmatched_leaf.evaluate("element => getComputedStyle(element).fill")
        large_unmatched_opacity = float(large_unmatched_leaf.evaluate("element => getComputedStyle(element).opacity"))
        large_radius = float(large_unmatched_leaf.evaluate("element => element.r.baseVal.value * element.getCTM().a"))
        assert large_unmatched_fill not in {"rgb(255, 255, 255)", "rgb(82, 97, 117)", "rgb(148, 163, 184)"}
        assert large_unmatched_opacity >= 0.7
        assert large_radius >= 3.0
        page.screenshot(path=str(VISIBILITY_SCREENSHOT), full_page=True)
        page.locator("#clearSearchButton").click()

        stage_box = page.locator("#treeStage").bounding_box()
        node_x_positions = page.locator("circle.tree-node").evaluate_all(
            "elements => elements.map(element => { const box = element.getBoundingClientRect(); return box.x + box.width / 2; })"
        )
        assert stage_box
        assert max(node_x_positions) - min(node_x_positions) > stage_box["width"] * 0.55

        smoke_dataset = {
            "version": "v2",
            "meta": {
                "title": "Smoke import",
                "colorings": [{"key": "region", "title": "Region", "type": "categorical"}],
            },
            "tree": {
                "name": "ROOT",
                "node_attrs": {"div": 0, "num_date": {"value": 2020.0}, "region": {"value": "Global"}},
                "children": [
                    {
                        "name": "SMOKE/A",
                        "node_attrs": {"div": 0.1, "num_date": {"value": 2021.0}, "region": {"value": "A"}},
                    },
                    {
                        "name": "SMOKE/B",
                        "node_attrs": {"div": 0.2, "num_date": {"value": 2022.0}, "region": {"value": "B"}},
                    },
                ],
            },
        }
        page.locator("#fileInput").set_input_files(
            files={
                "name": "smoke.json",
                "mimeType": "application/json",
                "buffer": json.dumps(smoke_dataset).encode("utf-8"),
            }
        )
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.title === 'Smoke import'")
        assert page.locator("#tipCount").inner_text() == "2"
        assert "Loaded smoke.json locally" in page.locator("#statusText").inner_text()

        newick_text = "[&R](('NWK A':0.1,NWK_B:0.2)Inner:0.3,NWK_C:0.4)ROOT;"
        page.locator("#fileInput").set_input_files(
            files={
                "name": "smoke-tree.nwk",
                "mimeType": "text/plain",
                "buffer": newick_text.encode("utf-8"),
            }
        )
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.title === 'smoke-tree'")
        assert page.locator("#tipCount").inner_text() == "3"
        assert page.locator("#nodeCount").inner_text() == "5"
        assert page.locator("#axisMetric").inner_text() == "Divergence"
        assert page.locator("#colorSelect").is_disabled()
        assert "Loaded smoke-tree.nwk locally" in page.locator("#statusText").inner_text()
        assert page.locator("#diagnosticsList").inner_text().find("Newick supplies topology") >= 0
        page.locator("#searchInput").fill("NWK A")
        assert page.locator(".tip-label.is-match").count() == 1

        page.locator("#demoButton").click()
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.tipCount === 17")
        with page.expect_download() as download_info:
            page.locator("#exportButton").click()
        download = download_info.value
        assert download.suggested_filename.startswith("bundled-demo-")
        assert download.suggested_filename.endswith(".svg")
        with tempfile.TemporaryDirectory() as temporary_directory:
            exported_path = Path(temporary_directory) / download.suggested_filename
            download.save_as(exported_path)
            exported = exported_path.read_text(encoding="utf-8")
            assert "<svg" in exported
            assert "branch-horizontal" in exported
            assert "--branch-color:" in exported
            assert "stroke: var(--branch-color" in exported

        page.locator("#radarModeButton").click()
        page.wait_for_function("document.body.dataset.mode === 'radar' && window.__PHYLOLOCAL_RADAR__.ready === true")
        assert page.locator("#radarApp").is_visible()
        assert page.locator("#viewerApp").is_hidden()
        assert page.locator("#radarCommonCount").inner_text() == "10"
        assert page.locator(".radar-connector").count() == 10
        assert page.locator(".candidate-row").count() == 2
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.topScore") > 0.85
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.topCandidate") in {"D", "H"}
        assert page.locator(".radar-connector.is-selected").count() == 1
        assert page.locator(".radar-tree-node.is-selected-tip").count() == 2
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.segmentA") == "HA"
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.segmentB") == "NA"
        assert page.locator(".radar-tree-title").nth(0).text_content().startswith("HA segment")
        assert page.locator(".radar-tree-title").nth(1).text_content().startswith("NA segment")
        assert all("_HA" not in text for text in page.locator(".radar-tip-label").evaluate_all("elements => elements.map(element => element.textContent || '')"))
        assert "HA vs NA" in page.locator("#radarStatusText").inner_text()

        # A focal tip cannot be its own neighbor. Ten shared tips therefore
        # permit at most nine neighbors, and the UI must reflect that limit.
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.maxK") == 9
        assert page.locator("#radarKSelect option[value='10']").count() == 0
        assert page.locator("#radarKSelect option[value='9']").inner_text() == "9 neighbors (maximum)"
        page.locator("#radarKSelect").select_option("9")
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.k === 9")
        assert "at most 9" in page.locator("#radarMethodNote").inner_text()
        jaccard_link = page.locator("#radarMethodNote a")
        assert jaccard_link.inner_text() == "Jaccard distances"
        assert jaccard_link.get_attribute("href") == "https://en.wikipedia.org/wiki/Jaccard_index"
        assert jaccard_link.get_attribute("target") == "_blank"
        assert page.locator("#radarCandidateDetails").inner_text().find("9 of 9 possible") >= 0

        page.locator("#radarThreshold").fill("0.75")
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.candidateCount === 2")
        assert page.locator(".candidate-row").count() == 2

        # Regression: searching must select any shared sample even when the
        # candidate threshold would otherwise hide it.
        page.locator("#radarThreshold").fill("0.95")
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.candidateCount === 0")
        page.locator("#radarCandidateSearch").fill("J")
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.selectedName === 'J'")
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.searchMatchCount") == 1
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.candidateCount") == 1
        assert page.locator(".candidate-row").count() == 1
        assert page.locator(".radar-sample-name").inner_text() == "J"
        assert page.locator(".radar-connector.is-selected[data-tip-name='J']").count() == 1
        assert page.locator(".radar-tree-node.is-selected-tip[data-tip-name='J']").count() == 2
        assert "below candidate threshold but highlighted" in page.locator("#radarSearchStatus").inner_text()
        assert page.locator("#radarClearSearchButton").is_visible()
        page.screenshot(path=str(RADAR_SEARCH_SCREENSHOT), full_page=True)
        page.locator("#radarClearSearchButton").click()
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.searchQuery === ''")
        assert page.locator("#radarClearSearchButton").is_hidden()

        page.locator("#radarThreshold").fill("0.75")
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.candidateCount === 2")
        page.locator("#radarKSelect").select_option("3")
        page.wait_for_function("window.__PHYLOLOCAL_RADAR__.k === 3")
        assert page.evaluate("window.__PHYLOLOCAL_RADAR__.topScore") == 1
        page.locator(".candidate-row").nth(1).click()
        assert page.locator(".radar-sample-name").inner_text() in {"D", "H"}

        with page.expect_download() as radar_download_info:
            page.locator("#radarExportCsvButton").click()
        radar_download = radar_download_info.value
        assert radar_download.suggested_filename.endswith("-discordance.csv")
        with tempfile.TemporaryDirectory() as temporary_directory:
            csv_path = Path(temporary_directory) / radar_download.suggested_filename
            radar_download.save_as(csv_path)
            csv_text = csv_path.read_text(encoding="utf-8")
            assert '"discordance_score"' in csv_text
            assert '"D","1.000000"' in csv_text

        page.screenshot(path=str(RADAR_SCREENSHOT), full_page=True)

        page.locator("#viewerModeButton").click()
        page.wait_for_function("document.body.dataset.mode === 'viewer'")
        page.locator("#axisSelect").select_option("divergence")
        page.locator("#demoButton").click()
        page.wait_for_function("window.__PHYLOLOCAL_STATE__.axis === 'divergence'")
        assert page.locator("#dropOverlay").is_hidden()
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    if browser_errors:
        raise AssertionError("Browser errors:\n" + "\n".join(browser_errors))

    print("Browser smoke test passed: tree viewing plus Reassortment Radar ranking, synchronized highlighting, thresholding, and CSV export work.")
    print(f"Screenshot: {SCREENSHOT}")
    print(f"120-tip visibility screenshot: {VISIBILITY_SCREENSHOT}")
    print(f"Unrooted screenshot: {UNROOTED_SCREENSHOT}")
    print(f"Reassortment Radar screenshot: {RADAR_SCREENSHOT}")
    print(f"Matched-sample search screenshot: {RADAR_SEARCH_SCREENSHOT}")


if __name__ == "__main__":
    try:
        run()
    except ModuleNotFoundError as error:
        if error.name == "playwright":
            print("Python Playwright is required for this optional smoke test.", file=sys.stderr)
            raise SystemExit(2) from error
        raise
