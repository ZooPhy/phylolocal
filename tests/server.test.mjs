import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function waitForServer(url, child, stderr) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited early: ${stderr.value}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Server did not become ready: ${stderr.value}`);
}

test("loopback server serves assets and rejects unsupported requests", async (context) => {
  const port = 43000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const stderr = {value: ""};
  const child = spawn(process.execPath, ["server.mjs", "--port", String(port)], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", (chunk) => { stderr.value += chunk; });
  context.after(() => {
    if (child.exitCode == null) child.kill("SIGTERM");
  });

  await waitForServer(`${baseUrl}/`, child, stderr);

  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await index.text(), /PhyloLocal/);

  const module = await fetch(`${baseUrl}/src/app.js`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(await module.text(), /zoomBehavior/);

  const logo = await fetch(`${baseUrl}/assets/phylolocal_icon.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.ok((await logo.arrayBuffer()).byteLength > 1000);

  const post = await fetch(`${baseUrl}/`, {method: "POST"});
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");

  const missing = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(missing.status, 404);
});
