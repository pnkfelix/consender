import type { Box } from "./model.js";
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

let appEl!: HTMLElement;
let root!: Box;
let worldId!: string;

export function mount(app: HTMLElement): void {
  appEl = app;
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
    const op = mkAddBox(box);
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

  const textBtn = document.createElement("button");
  textBtn.title = "edit text";
  textBtn.textContent = "T";
  if (box.text) textBtn.classList.add("box-btn-has-text");
  bar.appendChild(textBtn);

  el.appendChild(bar);

  const content = document.createElement("div");
  content.className = "box-content";
  content.style.touchAction = "none";
  for (const child of box.children) {
    content.appendChild(child.display === "icon" ? buildIcon(child) : buildWindow(child));
  }
  makeLassoGesture(content, box);
  if (box.text) {
    const tl = buildTextLayer(box, window.innerWidth, window.innerHeight - 48);
    tl.dataset.worldTextLayer = "1";
    content.insertBefore(tl, content.firstChild);
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
    span.textContent = ancestor.label;
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

function buildIcon(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "box-icon";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;

  const label = document.createElement("span");
  label.textContent = box.label;
  el.appendChild(label);

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

  const regions = box.children.map(c => ({
    x: c.x,
    y: c.y,
    w: c.display === "window" ? c.w : Math.max(80, ctx.measureText(c.label).width + 68),
    h: c.display === "window" ? c.h : 44,
  }));

  const words = box.text.split(/\s+/).filter(Boolean);
  let wi = 0;

  for (let y = BODY_PAD; wi < words.length && y + LINE_H <= bodyH - BODY_PAD; y += LINE_H) {
    const spans = freeSpans(y, BODY_PAD, bodyW - BODY_PAD, regions);
    for (const [sx, ex] of spans) {
      const avail = ex - sx;
      if (avail < TEXT_SIZE * 2) continue;
      const lineWords: string[] = [];
      let lineW = 0;
      while (wi < words.length) {
        const sep = lineWords.length > 0 ? " " : "";
        const cw = ctx.measureText(sep + words[wi]).width;
        if (lineWords.length > 0 && lineW + cw > avail) break;
        lineWords.push(words[wi++]);
        lineW += cw;
      }
      if (lineWords.length > 0) {
        const s = document.createElement("span");
        s.className = "box-text";
        s.style.cssText = `position:absolute;left:${sx}px;top:${y}px;white-space:nowrap;`;
        s.textContent = lineWords.join(" ");
        layer.appendChild(s);
      }
    }
  }

  return layer;
}

function buildWindow(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "box-window";
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;

  const bar = document.createElement("div");
  bar.className = "box-titlebar box-window-bar";

  const label = document.createElement("span");
  label.className = "box-label";
  label.textContent = box.label;
  bar.appendChild(label);

  const renameBtn = document.createElement("button");
  renameBtn.title = "rename";
  renameBtn.textContent = "✎";
  renameBtn.onclick = () => {
    const name = window.prompt("Name:", box.label);
    if (name !== null && name.trim()) {
      const result = recordOn(root, worldId, mkRenameBox(box, name.trim()));
      root = result.root;
      worldId = result.worldId;
      render();
    }
  };
  bar.appendChild(renameBtn);

  const iconBtn = document.createElement("button");
  iconBtn.title = "minimize";
  iconBtn.textContent = "▪";
  iconBtn.onclick = () => {
    const result = recordOn(root, worldId, mkSetDisplay(box, "icon"));
    root = result.root;
    worldId = result.worldId;
    render();
  };
  bar.appendChild(iconBtn);

  const fullBtn = document.createElement("button");
  fullBtn.title = "zoom in";
  fullBtn.textContent = "⛶";
  fullBtn.onclick = () => {
    worldId = box.id;
    persist(root, worldId);
    render();
  };
  bar.appendChild(fullBtn);

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

  const textBtn = document.createElement("button");
  textBtn.title = "edit text";
  textBtn.textContent = "T";
  if (box.text) textBtn.classList.add("box-btn-has-text");
  bar.appendChild(textBtn);

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
  bar.appendChild(collapseBtn);

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
  bar.appendChild(delBtn);

  el.appendChild(bar);

  const body = document.createElement("div");
  body.className = "box-body";
  const tooSmall = box.w < MIN_BODY_W || (box.h - WINDOW_BAR_H) < MIN_BODY_H;

  // Child boxes always use absolute positioning — unchanged from text-free behavior.
  // The text layer (when present) is inserted first so it paints behind the boxes.
  for (const child of box.children) {
    body.appendChild((tooSmall || child.display === "icon") ? buildIcon(child) : buildWindow(child));
  }
  if (box.text) {
    body.insertBefore(buildTextLayer(box), body.firstChild);
  }

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

    const onMove = (ev: PointerEvent): void => {
      box.x = startBoxX + (ev.clientX - startX);
      box.y = startBoxY + (ev.clientY - startY);
      target.style.left = `${box.x}px`;
      target.style.top = `${box.y}px`;
    };

    const onUp = (ev: PointerEvent): void => {
      const newX = startBoxX + (ev.clientX - startX);
      const newY = startBoxY + (ev.clientY - startY);
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

function makeLassoGesture(content: HTMLElement, world: Box): void {
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
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) cancelled = true;
    points.push({ x, y });
    setPath(pathEl, points, false);
  });

  content.addEventListener("pointerup", (e: PointerEvent) => {
    if (activePtId !== e.pointerId) return;
    activePtId = null;
    const rect = content.getBoundingClientRect();
    points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (!cancelled && isClosedLasso(points)) {
      const encircled = findEncircledBoxes(world, points);
      const { groupText, worldNewText } = computeTextMigration(content, points, world.text);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const center = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
      const op = mkGroupBoxes(world, encircled, groupText, worldNewText, center);
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

function findEncircledBoxes(world: Box, polygon: Pt[]): Box[] {
  return world.children.filter(child => {
    const cx = child.x + (child.display === "window" ? child.w / 2 : 60);
    const cy = child.y + (child.display === "window" ? child.h / 2 : 22);
    return pointInPolygon(cx, cy, polygon);
  });
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
