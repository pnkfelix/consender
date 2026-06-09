export type DisplayMode = "icon" | "window";

export interface Box {
  id: string;
  label: string;
  display: DisplayMode;
  children: Box[];
  parent: Box | null;
  x: number;
  y: number;
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
    x: 40 + Math.random() * 200,
    y: 40 + Math.random() * 120,
  };
}

export function createRoot(): Box {
  return createBox("world", null);
}

/** Wrap box in a new parent and return the parent. */
export function wrapInParent(box: Box): Box {
  const parent = createBox("world", null);
  parent.children = [box];
  box.parent = parent;
  box.display = "window";
  box.x = 60;
  box.y = 60;
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
