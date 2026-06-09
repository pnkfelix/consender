import { addChild, removeBox, wrapInParent } from "./model.js";
import type { Box } from "./model.js";

let appEl!: HTMLElement;
let currentWorld!: Box;

export function mount(app: HTMLElement, root: Box): void {
  appEl = app;
  currentWorld = root;
  render();
}

function render(): void {
  appEl.innerHTML = "";
  appEl.appendChild(buildWorld(currentWorld));
}

function buildWorld(box: Box): HTMLElement {
  const el = document.createElement("div");
  el.className = "box-fullscreen";

  const bar = document.createElement("div");
  bar.className = "box-titlebar";
  bar.appendChild(buildCrumb(box));

  const newBtn = document.createElement("button");
  newBtn.textContent = "+ box";
  newBtn.onclick = () => { addChild(box); render(); };
  bar.appendChild(newBtn);

  const outBtn = document.createElement("button");
  outBtn.textContent = "zoom out";
  outBtn.onclick = () => {
    if (box.parent) {
      currentWorld = box.parent;
      box.display = "window";
    } else {
      currentWorld = wrapInParent(box);
    }
    render();
  };
  bar.appendChild(outBtn);

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
      span.onclick = () => { currentWorld = ancestor; render(); };
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
  expandBtn.onclick = () => { box.display = "window"; render(); };
  el.appendChild(expandBtn);

  const delBtn = document.createElement("button");
  delBtn.title = "delete";
  delBtn.textContent = "✕";
  delBtn.onclick = () => { removeBox(box); render(); };
  el.appendChild(delBtn);

  makeDraggable(el, box);
  return el;
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
    if (name !== null && name.trim()) { box.label = name.trim(); render(); }
  };
  bar.appendChild(renameBtn);

  const iconBtn = document.createElement("button");
  iconBtn.title = "minimize";
  iconBtn.textContent = "▪";
  iconBtn.onclick = () => { box.display = "icon"; render(); };
  bar.appendChild(iconBtn);

  const fullBtn = document.createElement("button");
  fullBtn.title = "zoom in";
  fullBtn.textContent = "⛶";
  fullBtn.onclick = () => { currentWorld = box; render(); };
  bar.appendChild(fullBtn);

  const delBtn = document.createElement("button");
  delBtn.title = "delete";
  delBtn.textContent = "✕";
  delBtn.onclick = () => { removeBox(box); render(); };
  bar.appendChild(delBtn);

  el.appendChild(bar);

  const body = document.createElement("div");
  body.className = "box-body";
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

    const cleanup = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", cleanup);
      handle.removeEventListener("pointercancel", cleanup);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", cleanup);
    handle.addEventListener("pointercancel", cleanup);
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

    const cleanup = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", cleanup);
      handle.removeEventListener("pointercancel", cleanup);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", cleanup);
    handle.addEventListener("pointercancel", cleanup);
  });
}
