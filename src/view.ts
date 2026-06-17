import { marked } from "marked";
import { runScript } from "./script.js";
import type { Box } from "./model.js";
import { getBoxTitle } from "./model.js";
import {
  canUndo,
  findBox,
  loadOrInit,
  mkAddBox,
  mkCollapseBox,
  mkGroupBoxes,
  mkMoveBox,
  mkRemoveBox,
  mkRenameBox,
  mkResizeBox,
  mkSetBoxText,
  mkSetDisplay,
  mkWrapInParent,
  persist,
  recordOn,
  redoBox,
  undoBox,
} from "./history.js";

type ToolbarPolicy = "always" | "focus";

let appEl!: HTMLElement;
let root!: Box;
let worldId!: string;
const selectedBoxIds = new Set<string>();
type Mode = "select" | "act";
let mode: Mode = "select";
let focusedBoxId: string | null = null;
let helpEl!: HTMLDivElement;

// Map box labels to context-sensitive help text shown in the help bar.
const helpMap: Record<string, string> = {
  "toolbarPolicy": "Controls toolbar visibility for sibling boxes. " +
    "Text: \"focus\" hides buttons until a box is tapped; \"always\" keeps them visible. " +
    "Place inside a parent to configure all its children. Walks up the tree if not found.",
  "render": "Child-box property: sets the rendering mode for its parent box. " +
    "Supported text values: \"svg\" — interprets the parent's text as inline SVG markup; " +
    "\"markdown\" — renders the parent's text as formatted Markdown (CommonMark). " +
    "A raw/mode toggle button appears in the parent's title bar to switch between source and rendered views.",
  "help": "consender: an infinite canvas of nested boxes. " +
    "Zoom in/out to navigate, create and group boxes, edit text, undo/redo. " +
    "Label child boxes with built-in names to configure behavior — see the builtinLabels entry.",
  "builtinLabels": "Built-in labels: world, box, group, toolbarPolicy, render.",
};

// A box's toolbarPolicy comes from its own children first, then ancestor
// children walking up the chain. Nearer ancestor takes precedence.
function resolveToolbarPolicy(box: Box): ToolbarPolicy {
  let cur: Box | null = box;
  while (cur !== null) {
    const cfg = cur.children.find(c => c.title === "toolbarPolicy");
    if (cfg) {
      const t = cfg.box.text.trim().toLowerCase();
      if (t === "focus") return "focus";
      if (t === "always") return "always";
    }
    cur = cur.parent;
  }
  return "always";
}

function updateHelpBar(): void {
  const lastId = [...selectedBoxIds].at(-1);
  const selectedBox = lastId ? findBox(root, lastId) : null;
  const world = findBox(root, worldId);
  const name = selectedBox != null ? getBoxTitle(selectedBox) : world != null ? getBoxTitle(world) : "";
  const text = helpMap[name];
  helpEl.textContent = text ?? "";
  helpEl.style.display = text != null ? "block" : "none";
}

function updateSelection(): void {
  document.querySelectorAll<HTMLElement>(".box-window, .box-icon").forEach(el => {
    el.classList.toggle("box-selected", selectedBoxIds.has(el.dataset.boxId ?? ""));
  });
  updateHelpBar();
}

function updateFocusHighlight(): void {
  document.querySelectorAll<HTMLElement>(".box-window, .box-icon").forEach(el => {
    el.classList.toggle("box-focused", el.dataset.boxId === focusedBoxId);
  });
}

function buildModeSwitcher(): HTMLElement {
  const el = document.createElement("div");
  el.className = "mode-switcher";
  for (const m of ["select", "act"] as Mode[]) {
    const btn = document.createElement("button");
    btn.textContent = m;
    if (mode === m) btn.classList.add("mode-btn-active");
    btn.onclick = () => {
      if (mode === m) return;
      mode = m;
      render();
    };
    el.appendChild(btn);
  }
  return el;
}

// Boxes in this set are showing raw source even when a render mode is active.
const rawViewBoxIds = new Set<string>();

const KNOWN_RENDER_MODES = new Set(["svg", "markdown"]);

function getBoxRenderMode(box: Box): string {
  const renderChild = box.children.find(c => c.title.trim().toLowerCase() === "render");
  if (!renderChild) return "text";
  const mode = renderChild.box.text.trim().toLowerCase();
  return KNOWN_RENDER_MODES.has(mode) ? mode : "text";
}

function buildSvgLayer(box: Box): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "box-svg-layer";
  layer.innerHTML = box.text;
  return layer;
}

function buildMarkdownLayer(box: Box): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "box-markdown-layer";
  layer.innerHTML = marked.parse(box.text) as string;
  return layer;
}

function buildRenderLayer(box: Box): HTMLElement {
  const mode = getBoxRenderMode(box);
  return mode === "markdown" ? buildMarkdownLayer(box) : buildSvgLayer(box);
}

function buildRenderToggleBtn(box: Box): HTMLButtonElement | null {
  const mode = getBoxRenderMode(box);
  if (mode === "text") return null;
  const isRaw = rawViewBoxIds.has(box.id);
  const btn = document.createElement("button");
  btn.title = isRaw ? `render as ${mode}` : "show raw source";
  btn.textContent = isRaw ? mode : "raw";
  if (!isRaw) btn.classList.add("box-btn-rendering");
  btn.onclick = () => {
    if (rawViewBoxIds.has(box.id)) rawViewBoxIds.delete(box.id);
    else rawViewBoxIds.add(box.id);
    render();
  };
  return btn;
}

export function mount(app: HTMLElement): void {
  appEl = app;

  helpEl = document.createElement("div");
  helpEl.className = "help-bar";
  helpEl.style.display = "none";
  document.body.appendChild(helpEl);

  const loaded = loadOrInit();
  root = loaded.root;
  worldId = loaded.worldId;
  render();

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      const world = findBox(root, worldId);
      if (world) {
        const result = undoBox(world, root, worldId);
        root = result.root;
        worldId = result.worldId;
        render();
      }
    } else if (e.ctrlKey && (e.key === "y" || e.key === "Z")) {
      e.preventDefault();
      const world = findBox(root, worldId);
      if (world) {
        const result = redoBox(world, root, worldId);
        root = result.root;
        worldId = result.worldId;
        render();
      }
    }
  });
}

function render(): void {
  const world = findBox(root, worldId);
  if (!world) return;
  appEl.innerHTML = "";
  appEl.appendChild(buildWorld(world));
  updateHelpBar();
}

function buildWorld(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "box-fullscreen";

  const bar = document.createElement("div");
  bar.className = "box-titlebar";
  bar.appendChild(buildCrumb(box));

  const newBtn = document.createElement("button");
  newBtn.textContent = "+ box";
  newBtn.onclick = () => {
    const op = mkAddBox(box, window.innerWidth, window.innerHeight - WINDOW_BAR_H);
    const result = recordOn(root, worldId, op);
    root = result.root;
    worldId = result.worldId;
    render();
  };
  bar.appendChild(newBtn);

  const outBtn = document.createElement("button");
  outBtn.textContent = "zoom out";
  outBtn.onclick = () => {
    if (box.parent) {
      worldId = box.parent.id;
      persist(root, worldId);
      render();
    } else {
      const op = mkWrapInParent(box);
      const result = recordOn(root, worldId, op);
      root = result.root;
      worldId = result.worldId;
      render();
    }
  };
  bar.appendChild(outBtn);

  const isRawMode = getBoxRenderMode(box) === "text" || rawViewBoxIds.has(box.id);

  if (isRawMode) {
    const undoBtn = document.createElement("button");
    undoBtn.title = "undo";
    undoBtn.textContent = "↩";
    undoBtn.disabled = !canUndo(box, root);
    undoBtn.onclick = () => {
      const result = undoBox(box, root, worldId);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    bar.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.title = "redo";
    redoBtn.textContent = "↪";
    redoBtn.disabled = box.redoStack.length === 0;
    redoBtn.onclick = () => {
      const result = redoBox(box, root, worldId);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    bar.appendChild(redoBtn);
  }

  const textBtn = document.createElement("button");
  textBtn.title = "edit text";
  textBtn.textContent = "T";
  if (box.text) textBtn.classList.add("box-btn-has-text");
  bar.appendChild(textBtn);

  const renderToggle = buildRenderToggleBtn(box);
  if (renderToggle) bar.appendChild(renderToggle);

  bar.appendChild(buildModeSwitcher());

  el.appendChild(bar);

  const content = document.createElement("div");
  content.className = "box-content";
  content.style.touchAction = "none";

  content.addEventListener("pointerdown", () => {
    if (focusedBoxId !== null) { focusedBoxId = null; updateFocusHighlight(); }
    if (mode === "select" && selectedBoxIds.size > 0) { selectedBoxIds.clear(); updateSelection(); }
  });

  const isRenderedWorld = getBoxRenderMode(box) !== "text" && !rawViewBoxIds.has(box.id);
  if (!isRenderedWorld) {
    for (const { box: child } of box.children) {
      content.appendChild(child.display === "icon" ? buildIcon(child) : buildWindow(child));
    }
  }
  makeLassoGesture(content, box);
  if (box.text) {
    if (isRenderedWorld) {
      content.insertBefore(buildRenderLayer(box), content.firstChild);
    } else {
      const tl = buildTextLayer(box, window.innerWidth, window.innerHeight - 48);
      tl.dataset.worldTextLayer = "1";
      content.insertBefore(tl, content.firstChild);
    }
  }
  el.appendChild(content);

  textBtn.onclick = () => {
    const existing = content.querySelector(".box-text-editor") as HTMLTextAreaElement | null;
    if (existing) { existing.focus(); return; }
    content.innerHTML = "";

    const ta = document.createElement("textarea");
    ta.className = "box-text-editor";
    ta.value = box.text;
    ta.placeholder = "Enter text…";

    const prevText = box.text;
    let done = false;

    const commit = () => {
      if (done) return;
      done = true;
      if (ta.value !== prevText) {
        const result = recordOn(root, worldId, mkSetBoxText(box, ta.value));
        root = result.root;
        worldId = result.worldId;
      }
      render();
    };

    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (ke: KeyboardEvent) => {
      ke.stopPropagation();
      if (ke.key === "Escape") { ke.preventDefault(); done = true; render(); }
    });

    content.appendChild(ta);
    ta.focus();
  };

  return el;
}

function buildCrumb(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "breadcrumb";

  const path: Box[] = [];
  let b: Box | null = box;
  while (b) { path.unshift(b); b = b.parent; }

  path.forEach((ancestor, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = " › ";
      el.appendChild(sep);
    }
    const span = document.createElement("span");
    span.textContent = getBoxTitle(ancestor);
    if (i < path.length - 1) {
      span.className = "crumb-link";
      span.onclick = () => {
        worldId = ancestor.id;
        persist(root, worldId);
        render();
      };
    } else {
      span.className = "crumb-current";
    }
    el.appendChild(span);
  });

  return el;
}

// Returns the single-word text value for icon display, or null if not applicable.
// Only applies when box has no children and its text is exactly one non-whitespace word.
function iconValueWord(box: Box): string | null {
  const trimmed = box.text.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed) || box.children.length > 0) return null;
  return trimmed;
}

function buildIcon(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "box-icon";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;

  const label = document.createElement("span");
  label.className = "box-icon-label";
  label.textContent = getBoxTitle(box);
  el.appendChild(label);

  const value = iconValueWord(box);
  if (value !== null) {
    const sep = document.createElement("span");
    sep.className = "box-icon-sep";
    sep.textContent = ":";
    el.appendChild(sep);
    const valueSpan = document.createElement("span");
    valueSpan.className = "box-icon-value";
    valueSpan.textContent = value;
    el.appendChild(valueSpan);
  }

  if (box.text.trim().length > 0) {
    const runBtn = document.createElement("button");
    runBtn.className = "box-run-btn";
    runBtn.title = "run script";
    runBtn.textContent = "▶";
    runBtn.onclick = () => {
      const result = runScript(box.text, root, worldId, selectedBoxIds);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    el.appendChild(runBtn);
  }

  const expandBtn = document.createElement("button");
  expandBtn.title = "expand";
  expandBtn.textContent = "⬜";
  expandBtn.onclick = () => {
    const result = recordOn(root, worldId, mkSetDisplay(box, "window"));
    root = result.root;
    worldId = result.worldId;
    render();
  };
  el.appendChild(expandBtn);

  el.dataset.boxId = box.id;
  const policy = resolveToolbarPolicy(box);
  el.dataset.toolbarPolicy = policy;
  if (selectedBoxIds.has(box.id)) el.classList.add("box-selected");
  if (focusedBoxId === box.id) el.classList.add("box-focused");
  el.addEventListener("pointerdown", (e: PointerEvent) => {
    const wasFocused = focusedBoxId === box.id;
    if (!wasFocused) { focusedBoxId = box.id; updateFocusHighlight(); }
    const onButton = !!(e.target as HTMLElement).closest("button");
    if (!onButton && mode === "select") {
      if (selectedBoxIds.has(box.id)) selectedBoxIds.delete(box.id);
      else selectedBoxIds.add(box.id);
      updateSelection();
    }
    // Eat the click so buttons hidden by focus policy don't fire on the focus-gaining tap.
    if (!wasFocused && policy === "focus" && !onButton) {
      el.addEventListener("click", (ce) => ce.stopPropagation(), { capture: true, once: true });
    }
    e.stopPropagation();
  });

  makeDraggable(el, box);
  return el;
}

const WINDOW_BAR_H = 44;
const MIN_BODY_W = 120;
const MIN_BODY_H = 50;
const BODY_PAD = 6;
const TEXT_SIZE = 13;
const LINE_H = Math.ceil(TEXT_SIZE * 1.55);

// Returns horizontal free spans [start, end] at a given text-line band,
// after subtracting the footprints of all child boxes (plus a small gap).
function freeSpans(
  lineY: number,
  minX: number, maxX: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>
): Array<[number, number]> {
  const GAP = 4;
  let spans: Array<[number, number]> = [[minX, maxX]];
  for (const r of regions) {
    if (r.y + r.h <= lineY || r.y >= lineY + LINE_H) continue;
    const rx = r.x - GAP, re = r.x + r.w + GAP;
    const next: Array<[number, number]> = [];
    for (const [sx, ex] of spans) {
      if (re <= sx || rx >= ex) { next.push([sx, ex]); continue; }
      if (sx < rx) next.push([sx, rx]);
      if (re < ex) next.push([re, ex]);
    }
    spans = next;
  }
  return spans;
}

// Builds the text overlay layer for a box that has text content.
// Child boxes keep their absolute positions; text fills the gaps.
// bodyW/bodyH default to the box's own stored size; pass larger values for fullscreen.
function buildTextLayer(box: Box, bodyW = box.w, bodyH = box.h - WINDOW_BAR_H): HTMLElement {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;";

  // Use canvas for accurate monospace glyph measurement.
  const cvs = document.createElement("canvas");
  const ctx = cvs.getContext("2d");
  if (!ctx) return layer;
  ctx.font = `${TEXT_SIZE}px ui-monospace, Menlo, Consolas, monospace`;

  const regions = box.children.map(({ title, box: c }) => ({
    x: c.x,
    y: c.y,
    w: c.display === "window" ? c.w : (() => {
        const v = iconValueWord(c);
        const extra = v !== null ? ctx.measureText(": " + v).width : 0;
        return Math.max(80, ctx.measureText(title).width + extra + 68);
      })(),
    h: c.display === "window" ? c.h : 44,
  }));

  // Split into paragraphs on newlines; each paragraph word-wraps independently.
  const paraWords = box.text.replace(/\r\n|\r/g, "\n").split("\n").map(p => p.split(/\s+/).filter(Boolean));
  let pIdx = 0;
  let wIdx = 0;

  for (let y = BODY_PAD; pIdx < paraWords.length && y + LINE_H <= bodyH - BODY_PAD; y += LINE_H) {
    if (paraWords[pIdx].length === 0) { pIdx++; continue; }
    const spans = freeSpans(y, BODY_PAD, bodyW - BODY_PAD, regions);
    for (const [sx, ex] of spans) {
      const avail = ex - sx;
      if (avail < TEXT_SIZE * 2) continue;
      const lineWords: string[] = [];
      let lineW = 0;
      while (wIdx < paraWords[pIdx].length) {
        const sep = lineWords.length > 0 ? " " : "";
        const cw = ctx.measureText(sep + paraWords[pIdx][wIdx]).width;
        if (lineWords.length > 0 && lineW + cw > avail) break;
        lineWords.push(paraWords[pIdx][wIdx++]);
        lineW += cw;
      }
      const endOfParagraph = wIdx >= paraWords[pIdx].length;
      if (endOfParagraph) { pIdx++; wIdx = 0; }
      if (lineWords.length > 0) {
        const s = document.createElement("span");
        s.className = "box-text";
        s.style.cssText = `position:absolute;left:${sx}px;top:${y}px;white-space:nowrap;`;
        s.textContent = lineWords.join(" ");
        layer.appendChild(s);
      }
      if (endOfParagraph || pIdx >= paraWords.length) break;
    }
  }

  return layer;
}

function buildWindow(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "box-window";
  el.dataset.boxId = box.id;
  const policy = resolveToolbarPolicy(box);
  el.dataset.toolbarPolicy = policy;
  if (selectedBoxIds.has(box.id)) el.classList.add("box-selected");
  if (focusedBoxId === box.id) el.classList.add("box-focused");
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;

  el.addEventListener("pointerdown", (e: PointerEvent) => {
    const wasFocused = focusedBoxId === box.id;
    if (!wasFocused) { focusedBoxId = box.id; updateFocusHighlight(); }
    const onButton = !!(e.target as HTMLElement).closest("button");
    if (!onButton && mode === "select") {
      if (selectedBoxIds.has(box.id)) selectedBoxIds.delete(box.id);
      else selectedBoxIds.add(box.id);
      updateSelection();
    }
    // Eat the click so buttons hidden by focus policy don't fire on the focus-gaining tap.
    if (!wasFocused && policy === "focus" && !onButton) {
      el.addEventListener("click", (ce) => ce.stopPropagation(), { capture: true, once: true });
    }
    e.stopPropagation();
  });

  const bar = document.createElement("div");
  bar.className = "box-titlebar box-window-bar";

  const label = document.createElement("span");
  label.className = "box-label";
  label.textContent = getBoxTitle(box);
  bar.appendChild(label);

  const ribbon = document.createElement("div");
  ribbon.className = "box-ribbon";

  if (box.text.trim().length > 0) {
    const runBtn = document.createElement("button");
    runBtn.title = "run script";
    runBtn.textContent = "▶";
    runBtn.onclick = () => {
      const result = runScript(box.text, root, worldId, selectedBoxIds);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    ribbon.appendChild(runBtn);
  }

  const renameBtn = document.createElement("button");
  renameBtn.title = "rename";
  renameBtn.textContent = "✎";
  renameBtn.onclick = () => {
    const newTitle = window.prompt("Title:", getBoxTitle(box));
    if (newTitle !== null) {
      const result = recordOn(root, worldId, mkRenameBox(box, newTitle.trim()));
      root = result.root;
      worldId = result.worldId;
      render();
    }
  };
  ribbon.appendChild(renameBtn);

  const iconBtn = document.createElement("button");
  iconBtn.title = "minimize";
  iconBtn.textContent = "▪";
  iconBtn.onclick = () => {
    const result = recordOn(root, worldId, mkSetDisplay(box, "icon"));
    root = result.root;
    worldId = result.worldId;
    render();
  };
  ribbon.appendChild(iconBtn);

  const fullBtn = document.createElement("button");
  fullBtn.title = "zoom in";
  fullBtn.textContent = "⛶";
  fullBtn.onclick = () => {
    worldId = box.id;
    persist(root, worldId);
    render();
  };
  ribbon.appendChild(fullBtn);

  const isRawModeW = getBoxRenderMode(box) === "text" || rawViewBoxIds.has(box.id);

  if (isRawModeW) {
    const undoBtn = document.createElement("button");
    undoBtn.title = "undo";
    undoBtn.textContent = "↩";
    undoBtn.disabled = !canUndo(box, root);
    undoBtn.onclick = () => {
      const result = undoBox(box, root, worldId);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    ribbon.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.title = "redo";
    redoBtn.textContent = "↪";
    redoBtn.disabled = box.redoStack.length === 0;
    redoBtn.onclick = () => {
      const result = redoBox(box, root, worldId);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    ribbon.appendChild(redoBtn);
  }

  const textBtn = document.createElement("button");
  textBtn.title = "edit text";
  textBtn.textContent = "T";
  if (box.text) textBtn.classList.add("box-btn-has-text");
  ribbon.appendChild(textBtn);

  const renderToggleW = buildRenderToggleBtn(box);
  if (renderToggleW) ribbon.appendChild(renderToggleW);

  if (isRawModeW) {
    const collapseBtn = document.createElement("button");
    collapseBtn.title = "collapse into parent";
    collapseBtn.textContent = "⤵";
    collapseBtn.onclick = () => {
      if (!box.parent) return;
      const op = mkCollapseBox(box);
      const result = recordOn(root, worldId, op);
      root = result.root;
      worldId = result.worldId;
      render();
    };
    ribbon.appendChild(collapseBtn);
  }

  const delBtn = document.createElement("button");
  delBtn.title = "delete";
  delBtn.textContent = "✕";
  delBtn.onclick = () => {
    if (!box.parent) return;
    const op = mkRemoveBox(box);
    const result = recordOn(root, worldId, op);
    root = result.root;
    worldId = result.worldId;
    render();
  };
  ribbon.appendChild(delBtn);

  bar.appendChild(ribbon);
  el.appendChild(bar);

  const body = document.createElement("div");
  body.className = "box-body";
  const tooSmall = box.w < MIN_BODY_W || (box.h - WINDOW_BAR_H) < MIN_BODY_H;
  const isRenderedWindow = getBoxRenderMode(box) !== "text" && !rawViewBoxIds.has(box.id);

  if (!isRenderedWindow) {
    for (const { box: child } of box.children) {
      body.appendChild((tooSmall || child.display === "icon") ? buildIcon(child) : buildWindow(child));
    }
  }
  if (box.text) {
    const layer = isRenderedWindow ? buildRenderLayer(box) : buildTextLayer(box);
    if (!isRenderedWindow) layer.dataset.worldTextLayer = "1";
    body.insertBefore(layer, body.firstChild);
  }
  body.style.touchAction = "none";
  makeLassoGesture(body, box, true);

  textBtn.onclick = () => {
    const existing = body.querySelector(".box-text-editor") as HTMLTextAreaElement | null;
    if (existing) { existing.focus(); return; }
    body.innerHTML = "";

    const ta = document.createElement("textarea");
    ta.className = "box-text-editor";
    ta.value = box.text;
    ta.placeholder = "Enter text…";

    const prevText = box.text;
    let done = false;

    const commit = () => {
      if (done) return;
      done = true;
      if (ta.value !== prevText) {
        const result = recordOn(root, worldId, mkSetBoxText(box, ta.value));
        root = result.root;
        worldId = result.worldId;
      }
      render();
    };

    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (ke: KeyboardEvent) => {
      ke.stopPropagation();
      if (ke.key === "Escape") { ke.preventDefault(); done = true; render(); }
    });

    body.appendChild(ta);
    ta.focus();
  };

  el.appendChild(body);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "box-resize";
  el.appendChild(resizeHandle);

  makeDraggable(bar, box, el);
  makeResizable(resizeHandle, box, el);
  return el;
}

function makeDraggable(handle: HTMLElement, box: Box, mover?: HTMLElement): void {
  const target = mover ?? handle;

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startBoxX = box.x;
    const startBoxY = box.y;
    const containerH = target.parentElement?.clientHeight ?? Infinity;
    // For windows (mover provided), only the titlebar must stay in view.
    // For icons (no mover), the whole element must stay in view.
    const barH = mover !== undefined ? WINDOW_BAR_H : target.offsetHeight;

    const clamp = (rawX: number, rawY: number): [number, number] => [
      Math.max(0, rawX),
      Math.max(0, Math.min(rawY, containerH - barH)),
    ];

    const onMove = (ev: PointerEvent): void => {
      [box.x, box.y] = clamp(startBoxX + (ev.clientX - startX), startBoxY + (ev.clientY - startY));
      target.style.left = `${box.x}px`;
      target.style.top = `${box.y}px`;
    };

    const onUp = (ev: PointerEvent): void => {
      const [newX, newY] = clamp(startBoxX + (ev.clientX - startX), startBoxY + (ev.clientY - startY));
      if (newX !== startBoxX || newY !== startBoxY) {
        box.x = startBoxX;
        box.y = startBoxY;
        const op = mkMoveBox(box, newX, newY);
        const result = recordOn(root, worldId, op);
        root = result.root;
        worldId = result.worldId;
        render();
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };

    const onCancel = (): void => {
      box.x = startBoxX;
      box.y = startBoxY;
      target.style.left = `${box.x}px`;
      target.style.top = `${box.y}px`;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  });
}

function makeResizable(handle: HTMLElement, box: Box, el: HTMLElement): void {
  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = box.w;
    const startH = box.h;

    const onMove = (ev: PointerEvent): void => {
      box.w = Math.max(120, startW + (ev.clientX - startX));
      box.h = Math.max(80, startH + (ev.clientY - startY));
      el.style.width = `${box.w}px`;
      el.style.height = `${box.h}px`;
    };

    const onUp = (ev: PointerEvent): void => {
      const newW = Math.max(120, startW + (ev.clientX - startX));
      const newH = Math.max(80, startH + (ev.clientY - startY));
      if (newW !== startW || newH !== startH) {
        box.w = startW;
        box.h = startH;
        const op = mkResizeBox(box, newW, newH);
        const result = recordOn(root, worldId, op);
        root = result.root;
        worldId = result.worldId;
        render();
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };

    const onCancel = (): void => {
      box.w = startW;
      box.h = startH;
      el.style.width = `${box.w}px`;
      el.style.height = `${box.h}px`;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  });
}

// ---- text migration helpers for lasso gesture ----

function computeTextMigration(
  content: HTMLElement,
  polygon: Pt[],
  worldText: string
): { groupText: string; worldNewText: string } {
  if (!worldText) return { groupText: "", worldNewText: "" };
  const tl = content.querySelector<HTMLElement>("[data-world-text-layer]");
  if (!tl) return { groupText: "", worldNewText: worldText };

  const contentRect = content.getBoundingClientRect();
  const allWords = worldText.split(/\s+/).filter(Boolean);
  const encircledIndices = new Set<number>();

  let wordIdx = 0;
  for (const span of tl.querySelectorAll<HTMLElement>(".box-text")) {
    const spanWords = (span.textContent ?? "").split(/\s+/).filter(Boolean);
    const spanStart = wordIdx;
    wordIdx += spanWords.length;
    const r = span.getBoundingClientRect();
    const cx = r.left - contentRect.left + r.width / 2;
    const cy = r.top - contentRect.top + r.height / 2;
    if (pointInPolygon(cx, cy, polygon)) {
      for (let i = spanStart; i < spanStart + spanWords.length; i++) encircledIndices.add(i);
    }
  }

  return {
    groupText: allWords.filter((_, i) => encircledIndices.has(i)).join(" "),
    worldNewText: allWords.filter((_, i) => !encircledIndices.has(i)).join(" "),
  };
}

// ---- lasso gesture: draw a closed loop to group encircled boxes ----

type Pt = { x: number; y: number };

function makeLassoGesture(content: HTMLElement, world: Box, constrainToContent = false): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:1000;";
  content.appendChild(svg);

  const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathEl.setAttribute("fill", "rgba(80,130,255,0.1)");
  pathEl.setAttribute("stroke", "rgba(80,130,255,0.75)");
  pathEl.setAttribute("stroke-width", "2");
  pathEl.setAttribute("stroke-dasharray", "6 3");
  pathEl.setAttribute("stroke-linecap", "round");
  svg.appendChild(pathEl);

  const ghostEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  ghostEl.setAttribute("fill", "rgba(80,130,255,0.06)");
  ghostEl.setAttribute("stroke", "rgba(80,130,255,0.55)");
  ghostEl.setAttribute("stroke-width", "1.5");
  ghostEl.setAttribute("stroke-dasharray", "8 4");
  ghostEl.setAttribute("rx", "4");
  ghostEl.setAttribute("visibility", "hidden");
  svg.appendChild(ghostEl);

  let activePtId: number | null = null;
  let points: Pt[] = [];
  let cancelled = false;

  content.addEventListener("pointerdown", (e: PointerEvent) => {
    if (activePtId !== null) return;
    if ((e.target as HTMLElement) !== content) return;
    e.preventDefault();
    content.setPointerCapture(e.pointerId);
    activePtId = e.pointerId;
    cancelled = false;
    const rect = content.getBoundingClientRect();
    points = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
    setPath(pathEl, points, false);
  });

  content.addEventListener("pointermove", (e: PointerEvent) => {
    if (activePtId !== e.pointerId) return;
    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!constrainToContent && (x < 0 || y < 0 || x > rect.width || y > rect.height)) cancelled = true;
    points.push({ x, y });
    setPath(pathEl, points, false);
    const bf = constrainToContent ? { w: content.clientWidth, h: content.clientHeight } : undefined;
    updateGhostBox(ghostEl, world, points, cancelled, bf);
  });

  content.addEventListener("pointerup", (e: PointerEvent) => {
    if (activePtId !== e.pointerId) return;
    activePtId = null;
    const rect = content.getBoundingClientRect();
    points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    ghostEl.setAttribute("visibility", "hidden");

    if (!cancelled && isClosedLasso(points)) {
      const bf = constrainToContent ? { w: content.clientWidth, h: content.clientHeight } : undefined;
      const encircled = findEncircledBoxes(world, points, bf);
      const { groupText, worldNewText } = computeTextMigration(content, points, world.text);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const center = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
      let op = mkGroupBoxes(world, encircled, groupText, worldNewText, center);
      if (constrainToContent && op.kind === "GroupBoxes") {
        const bw = content.clientWidth;
        const bh = content.clientHeight;
        const clampedX = Math.max(0, Math.min(op.groupX, bw - op.groupW));
        const clampedY = Math.max(0, Math.min(op.groupY, bh - op.groupH));
        const dx = clampedX - op.groupX;
        const dy = clampedY - op.groupY;
        if (dx !== 0 || dy !== 0) {
          op = { ...op, groupX: clampedX, groupY: clampedY,
                 newPositions: op.newPositions.map(p => ({ ...p, x: p.x - dx, y: p.y - dy })) };
        }
      }
      const result = recordOn(root, worldId, op);
      root = result.root;
      worldId = result.worldId;
      render();
      return;
    }

    points = [];
    setPath(pathEl, points, false);
  });

  content.addEventListener("pointercancel", (e: PointerEvent) => {
    if (activePtId !== e.pointerId) return;
    activePtId = null;
    points = [];
    setPath(pathEl, points, false);
    ghostEl.setAttribute("visibility", "hidden");
  });
}

function setPath(pathEl: SVGPathElement, points: Pt[], close: boolean): void {
  if (points.length < 2) { pathEl.setAttribute("d", ""); return; }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  if (close) d += " Z";
  pathEl.setAttribute("d", d);
}

function isClosedLasso(points: Pt[]): boolean {
  if (points.length < 10) return false;
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  if (len < 150) return false;
  const dx = points[points.length - 1].x - points[0].x;
  const dy = points[points.length - 1].y - points[0].y;
  return Math.sqrt(dx * dx + dy * dy) < 60;
}

function findEncircledBoxes(world: Box, polygon: Pt[], boundsFilter?: { w: number; h: number }): Box[] {
  return world.children
    .filter(({ box: child }) => {
      const cx = child.x + (child.display === "window" ? child.w / 2 : 60);
      const cy = child.y + (child.display === "window" ? child.h / 2 : 22);
      if (boundsFilter && (cx < 0 || cy < 0 || cx > boundsFilter.w || cy > boundsFilter.h)) return false;
      return pointInPolygon(cx, cy, polygon);
    })
    .map(({ box }) => box);
}

function pointInPolygon(x: number, y: number, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function computePreviewRect(world: Box, points: Pt[], boundsFilter?: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const encircled = findEncircledBoxes(world, points, boundsFilter);
  const PADDING = 20;
  if (encircled.length > 0) {
    const minX = Math.min(...encircled.map(b => b.x));
    const minY = Math.min(...encircled.map(b => b.y));
    const maxX = Math.max(...encircled.map(b => b.x + (b.display === "window" ? b.w : 120)));
    const maxY = Math.max(...encircled.map(b => b.y + (b.display === "window" ? b.h : 44)));
    return {
      x: minX - PADDING,
      y: minY - PADDING - WINDOW_BAR_H,
      w: Math.max(180, maxX - minX + 2 * PADDING),
      h: Math.max(130, WINDOW_BAR_H + maxY - minY + 2 * PADDING),
    };
  }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = 180;
  const h = WINDOW_BAR_H + 130;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function updateGhostBox(ghostEl: SVGRectElement, world: Box, points: Pt[], cancelled: boolean, boundsFilter?: { w: number; h: number }): void {
  if (!cancelled && isClosedLasso(points)) {
    const r = computePreviewRect(world, points, boundsFilter);
    ghostEl.setAttribute("x", String(r.x));
    ghostEl.setAttribute("y", String(r.y));
    ghostEl.setAttribute("width", String(r.w));
    ghostEl.setAttribute("height", String(r.h));
    ghostEl.setAttribute("visibility", "visible");
  } else {
    ghostEl.setAttribute("visibility", "hidden");
  }
}
