export type DisplayMode = "icon" | "window";

export interface PositionRecord { id: string; x: number; y: number }

export interface NamedChild {
  title: string;
  box: Box;
}

export type Op =
  | { kind: "MoveBox";          id: string; x: number; y: number; prevX: number; prevY: number }
  | { kind: "ResizeBox";        id: string; w: number; h: number; prevW: number; prevH: number }
  | { kind: "RenameBox";        id: string; label: string; prevLabel: string }
  | { kind: "SetBoxText";       id: string; text: string; prevText: string }
  | { kind: "SetDisplay";       id: string; display: DisplayMode; prevDisplay: DisplayMode }
  | { kind: "AddBox";           parentId: string; index: number; title: string; subtree: OpSubtree }
  | { kind: "RemoveBox";        parentId: string; index: number; title: string; subtree: OpSubtree }
  | { kind: "WrapInParent";     wrapperId: string; childId: string; childTitle: string; prevX: number; prevY: number }
  | { kind: "UnwrapFromParent"; wrapperId: string; childId: string; childTitle: string; prevX: number; prevY: number }
  | { kind: "GroupBoxes";
      worldId: string; groupId: string; groupTitle: string;
      childIds: string[]; childIndices: number[];
      prevPositions: PositionRecord[]; newPositions: PositionRecord[];
      groupX: number; groupY: number; groupW: number; groupH: number;
      groupInsertIndex: number;
      worldPrevText?: string; worldNewText?: string; groupText?: string }
  | { kind: "UngroupBoxes";
      worldId: string; groupId: string; groupTitle: string;
      childIds: string[]; childIndices: number[];
      prevPositions: PositionRecord[]; newPositions: PositionRecord[];
      groupX: number; groupY: number; groupW: number; groupH: number;
      groupInsertIndex: number;
      worldPrevText?: string; worldNewText?: string; groupText?: string }
  | { kind: "CollapseBox";
      boxId: string; parentId: string; boxIndex: number; boxTitle: string;
      subtree: OpSubtree;
      childIds: string[];
      prevPositions: PositionRecord[];
      newPositions: PositionRecord[];
      parentPrevText: string;
      parentNewText: string; }
  | { kind: "UncollapseBox";
      boxId: string; parentId: string; boxIndex: number; boxTitle: string;
      subtree: OpSubtree;
      childIds: string[];
      prevPositions: PositionRecord[];
      newPositions: PositionRecord[];
      parentPrevText: string;
      parentNewText: string; }
  | { kind: "BatchOp"; ops: Op[] };

export interface OpSubtree {
  rootId: string;
  boxes: Record<string, SerializedBox>;
}

export interface SerializedBox {
  id: string;
  display: DisplayMode;
  children: Array<{ id: string; title: string }>;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  pointerToId?: string;
  pointerPath?: string;
}

export type Guard =
  | { kind: "wrapperIsClean"; wrapperId: string; childId: string };

export type StackEntry = { op: Op; guard?: Guard };

export interface RegularBox {
  id: string;
  display: DisplayMode;
  children: NamedChild[];
  parent: RegularBox | null;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  undoStack: StackEntry[];
  redoStack: StackEntry[];
}

export interface PointerBox {
  id: string;
  display: DisplayMode;
  parent: RegularBox | null;
  x: number;
  y: number;
  w: number;
  h: number;
  pointerToId: string;
  pointerPath?: string;
  undoStack: StackEntry[];
  redoStack: StackEntry[];
}

export type Box = RegularBox | PointerBox;

export function isPointer(box: Box): box is PointerBox {
  return "pointerToId" in box;
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

export function getBoxTitle(box: Box): string {
  if (!box.parent) return "world";
  const nc = box.parent.children.find(c => c.box === box);
  return nc?.title ?? "";
}

export function createBox(parent: RegularBox | null): RegularBox {
  return {
    id: freshId(),
    display: "window",
    children: [],
    parent,
    x: 20 + Math.random() * 80,
    y: 20 + Math.random() * 60,
    w: 180,
    h: 130,
    text: "",
    undoStack: [],
    redoStack: [],
  };
}

export function createRoot(): RegularBox {
  return createBox(null);
}

export function wrapInParent(box: Box, childTitle: string): RegularBox {
  const parent = createBox(null);
  parent.children = [{ title: childTitle, box }];
  box.parent = parent;
  box.display = "window";
  box.x = 40;
  box.y = 40;
  return parent;
}

export function addChild(parent: RegularBox, title: string): RegularBox {
  const child = createBox(parent);
  parent.children.push({ title, box: child });
  return child;
}

export function removeBox(box: Box): void {
  if (!box.parent) return;
  box.parent.children = box.parent.children.filter((c) => c.box !== box);
  box.parent = null;
}
