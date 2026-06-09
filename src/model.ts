export type DisplayMode = "icon" | "window";

export interface Box {
  id: string;
  label: string;
  display: DisplayMode;
  children: Box[];
  parent: Box | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

let nextId = 1;

function freshId(): string {
  return `b${nextId++}`;
}

export function createBox(label: string, parent: Box | null): Box {
  return {
    id: freshId(),
    label,
    display: "window",
    children: [],
    parent,
    x: 20 + Math.random() * 80,
    y: 20 + Math.random() * 60,
    w: 180,
    h: 130,
  };
}

export function createRoot(): Box {
  return createBox("world", null);
}

export function wrapInParent(box: Box): Box {
  const parent = createBox("world", null);
  parent.children = [box];
  box.parent = parent;
  box.display = "window";
  box.x = 40;
  box.y = 40;
  return parent;
}

export function addChild(parent: Box): Box {
  const child = createBox("box", parent);
  parent.children.push(child);
  return child;
}

export function removeBox(box: Box): void {
  if (!box.parent) return;
  box.parent.children = box.parent.children.filter((c) => c !== box);
  box.parent = null;
}
