export type DisplayMode = "icon" | "window";

export interface PositionRecord { id: string; x: number; y: number }

export type Op =
  | { kind: "MoveBox";          id: string; x: number; y: number; prevX: number; prevY: number }
  | { kind: "ResizeBox";        id: string; w: number; h: number; prevW: number; prevH: number }
  | { kind: "RenameBox";        id: string; label: string; prevLabel: string }
  | { kind: "SetDisplay";       id: string; display: DisplayMode; prevDisplay: DisplayMode }
  | { kind: "AddBox";           parentId: string; index: number; subtree: OpSubtree }
  | { kind: "RemoveBox";        parentId: string; index: number; subtree: OpSubtree }
  | { kind: "WrapInParent";     wrapperId: string; childId: string; prevX: number; prevY: number }
  | { kind: "UnwrapFromParent"; wrapperId: string; childId: string; prevX: number; prevY: number }
  | { kind: "GroupBoxes";
      worldId: string; groupId: string;
      childIds: string[]; childIndices: number[];
      prevPositions: PositionRecord[]; newPositions: PositionRecord[];
      groupX: number; groupY: number; groupW: number; groupH: number;
      groupInsertIndex: number }
  | { kind: "UngroupBoxes";
      worldId: string; groupId: string;
      childIds: string[]; childIndices: number[];
      prevPositions: PositionRecord[]; newPositions: PositionRecord[];
      groupX: number; groupY: number; groupW: number; groupH: number;
      groupInsertIndex: number };

export interface OpSubtree {
  rootId: string;
  boxes: Record<string, SerializedBox>;
}

export interface SerializedBox {
  id: string;
  label: string;
  display: DisplayMode;
  childIds: string[];
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  undoStack: Op[];
  redoStack: Op[];
}

let nextId = 1;

export function freshId(): string {
  return `b${nextId++}`;
}

export function getNextId(): number {
  return nextId;
}

export function setNextId(n: number): void {
  nextId = n;
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
    undoStack: [],
    redoStack: [],
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
