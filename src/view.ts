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

  const bar = document.createElement("div");
  bar.className = "box-titlebar box-window-bar";

  const label = document.createElement("span");
  label.className = "box-label";
  label.textContent = box.label;
  label.contentEditable = "true";
  label.addEventListener("blur", () => { box.label = label.textContent ?? box.label; });
  bar.appendChild(label);

  const iconBtn = document.createElement("button");
  iconBtn.title = "minimize";
  iconBtn.textContent = "▪";
  iconBtn.onclick = () => { box.display = "icon"; render(); };
  bar.appendChild(iconBtn);

  const fullBtn = document.createElement("button");
  fullBtn.title = "zoom in (fullscreen)";
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

  makeDraggable(bar, box, el);
  return el;
}

function makeDraggable(handle: HTMLElement, box: Box, mover?: HTMLElement): void {
  const target = mover ?? handle;

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    if ((e.target as HTMLElement).isContentEditable) return;
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

    const onUp = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}
