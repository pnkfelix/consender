import type { Box } from "./model.js";
import {
  findBox,
  loadOrInit,
  mkAddBox,
  mkMoveBox,
  mkRemoveBox,
  mkRenameBox,
  mkResizeBox,
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
      const result = recordOn(root, worldId, mkSetDisplay(box, "window"));
      root = result.root;
      worldId = result.worldId;
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
  undoBtn.disabled = box.undoStack.length === 0;
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

  el.appendChild(bar);

  const content = document.createElement("div");
  content.className = "box-content";
  for (const child of box.children) {
    content.appendChild(child.display === "icon" ? buildIcon(child) : buildWindow(child));
  }
  el.appendChild(content);

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

  const undoBtn = document.createElement("button");
  undoBtn.title = "undo";
  undoBtn.textContent = "↩";
  undoBtn.disabled = box.undoStack.length === 0;
  undoBtn.onclick = () => {
    const result = undoBox(box, root, worldId);
    root = result.root;
    worldId = result.worldId;
    render();
  };
  el.appendChild(undoBtn);

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
  el.appendChild(redoBtn);

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
  el.appendChild(delBtn);

  makeDraggable(el, box);
  return el;
}

const WINDOW_BAR_H = 44;
const MIN_BODY_W = 120;
const MIN_BODY_H = 50;

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
  undoBtn.disabled = box.undoStack.length === 0;
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
  for (const child of box.children) {
    body.appendChild(tooSmall || child.display === "icon" ? buildIcon(child) : buildWindow(child));
  }
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
        const op = mkMoveBox(box, newX, newY);
        box.x = startBoxX;
        box.y = startBoxY;
        const result = recordOn(root, worldId, op);
        root = result.root;
        worldId = result.worldId;
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
        const op = mkResizeBox(box, newW, newH);
        box.w = startW;
        box.h = startH;
        const result = recordOn(root, worldId, op);
        root = result.root;
        worldId = result.worldId;
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
