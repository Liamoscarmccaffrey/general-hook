import { BrowserPod } from "@leaningtech/browserpod";
import { copyFile, copyFileTo, writeTextFile } from "./utils.js";
import {
  parseUploadedFile,
  buildOpenApiSpec,
  specToYaml,
  specToRoutes,
} from "./openapi.js";

// ── State ────────────────────────────────────────────────────────────────────
let currentTab = "builder";

let routes = [
  { method: "GET",  path: "/users",  status: 200, body: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] },
  { method: "POST", path: "/users",  status: 201, body: { id: 3, name: "New User", created: true } },
  { method: "GET",  path: "/health", status: 200, body: { status: "ok" } },
];

let uploadMode = null;           // 'routes' | 'openapi' | 'raw'
let uploadedRawContent = null;

let editingTarget = null;        // { arr, index }

const specInfo = { title: "My API", version: "1.0.0" };
let specEndpoints = [
  { method: "GET",  path: "/users", status: 200, summary: "List users",  body: [{ id: 1, name: "Alice" }] },
  { method: "POST", path: "/users", status: 201, summary: "Create user", body: { id: 3, name: "New User" } },
];

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const statusEl        = $("status");
const statusTextEl    = $("status-text");
const startBtn        = $("start-btn");
const consoleEl       = $("console");
const portalCard      = $("portal-card");
const portalUrlEl     = $("portal-url");
const copyBtn         = $("copy-btn");
const openBtn         = $("open-btn");
const exampleRoute    = $("example-route");
const bodyEditorCard  = $("body-editor-card");
const bodyEditorLabel = $("body-editor-label");
const bodyEditorTA    = $("body-editor-textarea");
const asciiSuccess    = $("ascii-success");
const asciiArtText    = $("ascii-art-text");
const consoleCard     = $("console-card");

// ── Settings dropdown ─────────────────────────────────────────────────────────
let terminalVisible = false;

$("settings-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("settings-dropdown").classList.toggle("hidden");
});

document.addEventListener("click", () => {
  $("settings-dropdown").classList.add("hidden");
});

$("toggle-terminal-btn").addEventListener("click", () => {
  terminalVisible = !terminalVisible;
  consoleCard.classList.toggle("hidden", !terminalVisible);
  $("toggle-terminal-btn").textContent = terminalVisible ? "HIDE TERMINAL" : "SEE TERMINAL";
  $("settings-dropdown").classList.add("hidden");
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t === btn)
    );
    document.querySelectorAll(".tab-panel").forEach((p) =>
      p.classList.add("hidden")
    );
    $("tab-" + currentTab).classList.remove("hidden");
  });
});

// ── Builder tab ───────────────────────────────────────────────────────────────
function renderRoutes() {
  const el = $("routes-list");
  el.innerHTML = routes.length
    ? routes.map((r, i) => routeRowHtml(r, i)).join("")
    : '<div class="empty-routes">No routes yet.</div>';
  bindRowEvents(el, routes, "builder");
}

function routeRowHtml(r, i) {
  const mc = methodCls(r.method);
  return `<div class="route-row">
    <span class="route-method ${mc}">${r.method}</span>
    <span class="route-path">${esc(r.path)}</span>
    <span class="route-status">${r.status}</span>
    <button class="route-body-btn" data-i="${i}">Edit body</button>
    <button class="route-delete" data-i="${i}" title="Remove">&#x2715;</button>
  </div>`;
}

function bindRowEvents(container, arr, source) {
  container.querySelectorAll(".route-body-btn").forEach((btn) => {
    btn.addEventListener("click", () =>
      openBodyEditor(arr, parseInt(btn.dataset.i))
    );
  });
  container.querySelectorAll(".route-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      arr.splice(parseInt(btn.dataset.i), 1);
      source === "spec" ? renderSpecEndpoints() : renderRoutes();
    });
  });
}

$("add-btn").addEventListener("click", () => {
  $("new-route-form").classList.remove("hidden");
  $("nr-path").focus();
});
$("nr-cancel").addEventListener("click", () => {
  $("new-route-form").classList.add("hidden");
  $("nr-path").value = "";
  $("nr-status").value = "200";
});
$("nr-save").addEventListener("click", () => {
  const path = $("nr-path").value.trim();
  if (!path.startsWith("/")) { $("nr-path").focus(); return; }
  routes.push({
    method: $("nr-method").value,
    path,
    status: parseInt($("nr-status").value) || 200,
    body: {},
  });
  renderRoutes();
  $("new-route-form").classList.add("hidden");
  $("nr-path").value = "";
  $("nr-status").value = "200";
});

// ── Upload tab ────────────────────────────────────────────────────────────────
const dropzone   = $("dropzone");
const fileInput  = $("file-input");
const uploadResult = $("upload-result");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    const lower = file.name.toLowerCase();

    if (lower.endsWith(".js")) {
      uploadMode = "raw";
      uploadedRawContent = content;
      showUploadResult("raw", file.name, null);
      return;
    }

    try {
      const result = parseUploadedFile(file.name, content);
      uploadMode = result.type;
      if (result.routes) routes = result.routes;
      showUploadResult(result.formatLabel, file.name, result.routes);
    } catch (err) {
      uploadResult.innerHTML = `<div class="upload-error">${esc(err.message)}</div>`;
      uploadResult.classList.remove("hidden");
    }
  };
  reader.readAsText(file);
}

function showUploadResult(formatLabel, filename, parsedRoutes) {
  const typeDesc = parsedRoutes
    ? `${parsedRoutes.length} route(s) extracted.`
    : "Will run directly. Server must listen on port 3000.";
  const previewRows =
    parsedRoutes?.length
      ? parsedRoutes
          .slice(0, 5)
          .map(
            (r) =>
              `<div class="route-row small">
                <span class="route-method ${methodCls(r.method)}">${r.method}</span>
                <span class="route-path">${esc(r.path)}</span>
                <span class="route-status">${r.status}</span>
              </div>`
          )
          .join("") +
        (parsedRoutes.length > 5
          ? `<div class="more-routes">+${parsedRoutes.length - 5} more</div>`
          : "")
      : "";

  uploadResult.innerHTML = `
    <div class="upload-success">
      <span class="upload-tag">${esc(formatLabel)}</span>
      <span class="upload-filename">${esc(filename)}</span>
      <span class="upload-desc">${typeDesc}</span>
    </div>
    ${previewRows ? `<div class="upload-routes-preview">${previewRows}</div>` : ""}
  `;
  uploadResult.classList.remove("hidden");
}

// ── Spec Generator tab ────────────────────────────────────────────────────────
function renderSpecEndpoints() {
  const el = $("spec-endpoints-list");
  el.innerHTML = specEndpoints.length
    ? specEndpoints.map((ep, i) => routeRowHtml(ep, i)).join("")
    : '<div class="empty-routes">No endpoints yet.</div>';
  bindRowEvents(el, specEndpoints, "spec");
  refreshSpecPreview();
}

function refreshSpecPreview() {
  specInfo.title   = $("spec-title").value   || "My API";
  specInfo.version = $("spec-version").value || "1.0.0";
  const spec = buildOpenApiSpec(specInfo, specEndpoints);
  const yamlStr = specToYaml(spec);
  $("spec-preview").textContent = yamlStr;
  const blob = new Blob([yamlStr], { type: "text/yaml" });
  $("spec-download-btn").href = URL.createObjectURL(blob);
}

$("spec-title").addEventListener("input", refreshSpecPreview);
$("spec-version").addEventListener("input", refreshSpecPreview);

$("spec-add-btn").addEventListener("click", () => {
  $("spec-new-form").classList.remove("hidden");
  $("sp-path").focus();
});
$("sp-cancel").addEventListener("click", () => {
  $("spec-new-form").classList.add("hidden");
  $("sp-path").value = "";
  $("sp-status").value = "200";
  $("sp-summary").value = "";
});
$("sp-save").addEventListener("click", () => {
  const path = $("sp-path").value.trim();
  if (!path.startsWith("/")) { $("sp-path").focus(); return; }
  specEndpoints.push({
    method: $("sp-method").value,
    path,
    status: parseInt($("sp-status").value) || 200,
    summary: $("sp-summary").value.trim(),
    body: {},
  });
  renderSpecEndpoints();
  $("spec-new-form").classList.add("hidden");
  $("sp-path").value = "";
  $("sp-status").value = "200";
  $("sp-summary").value = "";
});

$("spec-copy-btn").addEventListener("click", () => {
  navigator.clipboard.writeText($("spec-preview").textContent);
  $("spec-copy-btn").textContent = "COPIED!";
  setTimeout(() => { $("spec-copy-btn").textContent = "COPY"; }, 2000);
});

// ── Body editor ───────────────────────────────────────────────────────────────
function openBodyEditor(arr, index) {
  editingTarget = { arr, index };
  const r = arr[index];
  bodyEditorLabel.textContent = `${r.method} ${r.path}`;
  // Body: if binary (data URI) show the raw string; otherwise pretty-print JSON
  bodyEditorTA.value = typeof r.body === "string"
    ? r.body
    : JSON.stringify(r.body, null, 2);
  $("body-editor-ct").value = r.contentType || "application/json";
  bodyEditorCard.classList.remove("hidden");
  bodyEditorTA.focus();
}

$("body-editor-save").addEventListener("click", () => {
  const ct  = $("body-editor-ct").value;
  const raw = bodyEditorTA.value;
  const route = editingTarget.arr[editingTarget.index];

  // Store content-type on the route
  route.contentType = ct;

  if (ct === "application/json") {
    try {
      route.body = JSON.parse(raw);
    } catch (_) {
      bodyEditorTA.style.borderColor = "var(--red)";
      setTimeout(() => { bodyEditorTA.style.borderColor = ""; }, 1500);
      return;
    }
  } else {
    // Non-JSON: store body as raw string (or data URI for binary)
    route.body = raw;
  }

  bodyEditorCard.classList.add("hidden");
  if (currentTab === "spec") refreshSpecPreview();
  editingTarget = null;
});
$("body-editor-close").addEventListener("click", () => {
  bodyEditorCard.classList.add("hidden");
  editingTarget = null;
});

$("body-editor-ct").addEventListener("change", () => {
  const ct   = $("body-editor-ct").value;
  const hint = $("body-editor-hint");
  if (ct === "application/json") {
    hint.textContent = "MUST BE VALID JSON";
  } else if (ct.startsWith("image/") || ct === "application/pdf" || ct === "application/octet-stream") {
    hint.textContent = "PASTE A data:...;base64,... URI";
  } else {
    hint.textContent = "PLAIN TEXT OR MARKUP";
  }
});

// ── Copy / open portal ────────────────────────────────────────────────────────
copyBtn.addEventListener("click", () => {
  const url = openBtn.href;
  if (url && url !== "#") {
    navigator.clipboard.writeText(url);
    copyBtn.textContent = "COPIED!";
    setTimeout(() => { copyBtn.textContent = "COPY"; }, 2000);
  }
});

// ── Spectrum tape-load overlay ────────────────────────────────────────────────
// A single scanline reveals the viewport and the modal together.
// Progress advances with actual startup stages and completes when the portal is ready.

let scanProgress  = 0;
let scanTarget    = 0;
let scanAnimId    = null;
let lastTimestamp = null;
let dotsTimer     = null;

const SCAN_CATCHUP_SPEED = 140;
const SCAN_MIN_SPEED = 24;

function startSpectrumOverlay() {
  const overlay = $("spectrum-overlay");
  const screenCurtain = $("sov-screen-curtain");
  const screenScanner = $("sov-screen-scanner");
  const curtain = $("sov-curtain");
  const scanner = $("sov-scanner");

  scanProgress  = 0;
  scanTarget    = 6;
  lastTimestamp = null;
  clearInterval(dotsTimer);
  cancelAnimationFrame(scanAnimId);

  // Reset modal content
  $("sov-art").textContent = "";
  $("sov-url-row").classList.add("hidden");
  $("sov-actions").classList.add("hidden");
  $("sov-url").textContent = "";
  $("sov-meta").textContent = "";

  overlay.classList.add("active");
  overlay.classList.remove("done");
  $("sov-loading").classList.remove("hidden");
  screenCurtain.style.top = "0px";
  screenScanner.style.top = "0px";
  screenScanner.style.display = "";
  curtain.style.top = "0px";
  scanner.style.top = "0px";
  scanner.style.display = "none";

  // Animate the dots
  let dotCount = 3;
  dotsTimer = setInterval(() => {
    dotCount = dotCount === 3 ? 1 : dotCount + 1;
    $("sov-dots").textContent = ".".repeat(dotCount);
  }, 400);

  function tick(ts) {
    if (!lastTimestamp) lastTimestamp = ts;
    const dt = Math.min((ts - lastTimestamp) / 1000, 0.1);
    lastTimestamp = ts;

    const delta = Math.max(0, scanTarget - scanProgress);
    const speed = Math.max(SCAN_MIN_SPEED, delta * 3, SCAN_CATCHUP_SPEED * 0.2);
    scanProgress = Math.min(scanProgress + Math.min(delta, speed * dt), scanTarget);

    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const scanPx = (scanProgress / 100) * viewportH;
    const scanlineHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--scanline-height")) || 18;
    const modalRect = $("sov-modal").getBoundingClientRect();
    const modalReveal = Math.max(0, Math.min(modalRect.height, scanPx - modalRect.top));
    const modalLine = scanPx - modalRect.top;
    const modalScannerActive = modalLine >= 0 && modalLine <= modalRect.height + scanlineHeight;

    screenCurtain.style.top = `${scanPx}px`;
    screenScanner.style.top = `${Math.max(0, scanPx - scanlineHeight)}px`;

    curtain.style.top = `${modalReveal}px`;
    scanner.style.top = `${Math.max(0, Math.min(modalRect.height - scanlineHeight, modalReveal - scanlineHeight))}px`;
    scanner.style.display = modalScannerActive ? "" : "none";

    if (scanProgress < 100) {
      scanAnimId = requestAnimationFrame(tick);
    } else {
      screenScanner.style.display = "none";
      scanner.style.display = "none";
      $("spectrum-overlay").classList.add("done");
    }
  }

  scanAnimId = requestAnimationFrame(tick);
}

function advanceSpectrumOverlay(progress) {
  scanTarget = Math.max(scanTarget, Math.min(progress, 100));
}

function completeSpectrumOverlay(url, routeCount, isWebhook) {
  clearInterval(dotsTimer);
  $("sov-loading").classList.add("hidden"); // hide "LOADING..." text

  // Populate modal content — scanner will reveal it as it sweeps the rest
  $("sov-art").textContent = isWebhook
    ? `╔══════════════════════════════╗
║  WEBHOOK RECEIVER  LIVE      ║
║                              ║
║  ALL REQUESTS LOGGED         ║
║  OPEN URL FOR DASHBOARD      ║
╚══════════════════════════════╝`
    : `╔══════════════════════════════╗
║  SERVER  READY               ║
║                              ║
║  ROUTES : ${String(routeCount).padEnd(19)}║
║  CORS   : ENABLED            ║
╚══════════════════════════════╝`;

  $("sov-url").textContent = url;
  $("sov-open").href       = url;
  $("sov-meta").textContent = isWebhook
    ? "CAPTURING ALL HTTP REQUESTS"
    : `${routeCount} ROUTE${routeCount !== 1 ? "S" : ""} ACTIVE`;
  $("sov-url-row").classList.remove("hidden");
  $("sov-actions").classList.remove("hidden");

  advanceSpectrumOverlay(100);

  // Copy button inside modal
  $("sov-copy").onclick = () => {
    navigator.clipboard.writeText(url);
    $("sov-copy").textContent = "COPIED!";
    setTimeout(() => { $("sov-copy").textContent = "COPY"; }, 2000);
  };
}

$("sov-dismiss").addEventListener("click", () => {
  const overlay = $("spectrum-overlay");
  overlay.style.transition = "opacity 0.3s";
  overlay.style.opacity    = "0";
  setTimeout(() => {
    overlay.classList.remove("active");
    overlay.style.opacity   = "";
    overlay.style.transition = "";
  }, 300);
});

// ── Start server ──────────────────────────────────────────────────────────────
startBtn.addEventListener("click", start);

async function start() {
  startBtn.disabled = true;
  setStatus("Booting...", "loading");
  startSpectrumOverlay();

  const pod = await BrowserPod.boot({ apiKey: import.meta.env.VITE_BP_APIKEY });
  advanceSpectrumOverlay(24);
  await new Promise((r) => setTimeout(r, 500));

  const terminal = await pod.createDefaultTerminal(consoleEl);
  advanceSpectrumOverlay(40);

  pod.onPortal(({ url }) => {
    const isWebhook  = currentTab === "webhooks";
    const routeCount = getRoutes().length;
    completeSpectrumOverlay(url, routeCount, isWebhook);
    setStatus("Running", "running");
    portalUrlEl.textContent = url;
    openBtn.href = url;
    if (isWebhook) {
      exampleRoute.textContent = url + "/webhook";
    } else {
      const first = getRoutes()[0];
      if (first) exampleRoute.textContent = url + first.path;
    }
    portalCard.classList.remove("hidden");
  });

  await pod.createDirectory("/project");
  advanceSpectrumOverlay(52);

  const isRaw = currentTab === "upload" && uploadMode === "raw";
  const isWebhook = currentTab === "webhooks";

  if (isWebhook) {
    await copyFileTo(pod, "webhook/main.js", "/project/main.js");
    await copyFileTo(pod, "webhook/package.json", "/project/package.json");
    advanceSpectrumOverlay(64);
    setStatus("Installing...", "loading");
    advanceSpectrumOverlay(78);
    await pod.run("npm", ["install"], { echo: true, terminal, cwd: "/project" });
    setStatus("Starting...", "loading");
    advanceSpectrumOverlay(90);
    pod.run("node", ["main.js"], { echo: true, terminal, cwd: "/project" });
  } else if (isRaw) {
    await writeTextFile(pod, "/project/raw-server.js", uploadedRawContent);
    await copyFile(pod, "project/package.json");
    advanceSpectrumOverlay(72);
    setStatus("Starting...", "loading");
    advanceSpectrumOverlay(90);
    pod.run("node", ["raw-server.js"], { echo: true, terminal, cwd: "/project" });
  } else {
    await copyFile(pod, "project/main.js");
    await copyFile(pod, "project/package.json");
    await writeTextFile(pod, "/project/routes.json", JSON.stringify(getRoutes()));
    advanceSpectrumOverlay(68);
    setStatus("Installing...", "loading");
    advanceSpectrumOverlay(82);
    await pod.run("npm", ["install"], { echo: true, terminal, cwd: "/project" });
    setStatus("Starting...", "loading");
    advanceSpectrumOverlay(92);
    pod.run("node", ["main.js"], { echo: true, terminal, cwd: "/project" });
  }
}

function getRoutes() {
  if (currentTab === "spec") return specToRoutes(specInfo, specEndpoints);
  return routes;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(text, state) {
  statusTextEl.textContent = text;
  statusEl.className = "status status-" + state;
}

function methodCls(m) {
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m) ? m : "GET";
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderRoutes();
renderSpecEndpoints();
