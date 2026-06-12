import {
  createRoot,
  freshId,
  getBoxName,
  getNextId,
  setNextId,
} from "./model.js";
import type { Box, DisplayMode, Guard, NamedChild, Op, OpSubtree, PositionRecord, SerializedBox, StackEntry } from "./model.js";

export type { Guard, Op, OpSubtree, SerializedBox, StackEntry };

// Mainline key is stable for backward compatibility with existing stored data.
const MAINLINE_KEY = "consender-state";

// Each deployment (mainline vs. each preview PR) gets its own storage slot so
// that preview-only op kinds in undo stacks can't corrupt other deployments.
// import.meta.env.BASE_URL is a Vite compile-time constant:
//   mainline  → "/consender/"
//   preview   → "/consender/preview/pr-123/"
function storageKey(): string {
  const base = import.meta.env.BASE_URL;
  return base === "/consender/" ? MAINLINE_KEY : `consender-state:${base}`;
}

function tryLoadFromKey(key: string): { root: Box; worldId: string } | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as PersistedState;
    setNextId(state.nextId);
    return { root: deserializeFullTree(state.tree), worldId: state.worldId };
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

interface PersistedSerializedBox extends SerializedBox {
  undoStack: StackEntry[];
  redoStack: StackEntry[];
}

interface PersistedState {
  tree: { rootId: string; boxes: Record<string, PersistedSerializedBox> };
  worldId: string;
  nextId: number;
}

export function findBox(root: Box, id: string): Box | null {
  if (root.id === id) return root;
  for (const { box: child } of root.children) {
    const found = findBox(child, id);
    if (found) return found;
  }
  return null;
}

function collectSubtree(box: Box, acc: Record<string, SerializedBox>): void {
  acc[box.id] = {
    id: box.id,
    display: box.display,
    children: box.children.map(({ name, box: c }) => ({ id: c.id, name })),
    parentId: box.parent ? box.parent.id : null,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: box.text || undefined,
  };
  for (const { box: child } of box.children) {
    collectSubtree(child, acc);
  }
}

export function serializeOpSubtree(box: Box): OpSubtree {
  const boxes: Record<string, SerializedBox> = {};
  collectSubtree(box, boxes);
  return { rootId: box.id, boxes };
}

function deserializeChildren(
  s: SerializedBox,
  allBoxes: Record<string, SerializedBox>,
  live: Record<string, Box>
): NamedChild[] {
  const raw = s as any;
  if (raw.childIds) {
    // old format: names were on the child boxes themselves
    return (raw.childIds as string[]).map((cid: string) => ({
      name: (allBoxes[cid] as any)?.label ?? "box",
      box: live[cid],
    }));
  }
  return s.children.map(c => ({ name: c.name, box: live[c.id] }));
}

export function deserializeOpSubtree(subtree: OpSubtree): Box {
  const live: Record<string, Box> = {};
  for (const id of Object.keys(subtree.boxes)) {
    const s = subtree.boxes[id];
    live[id] = {
      id: s.id,
      display: s.display,
      children: [],
      parent: null,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      text: s.text ?? "",
      undoStack: [],
      redoStack: [],
    };
  }
  for (const id of Object.keys(subtree.boxes)) {
    const s = subtree.boxes[id];
    const box = live[id];
    box.children = deserializeChildren(s, subtree.boxes, live);
    box.parent = s.parentId ? live[s.parentId] : null;
  }
  return live[subtree.rootId];
}

function collectPersistedSubtree(
  box: Box,
  acc: Record<string, PersistedSerializedBox>
): void {
  acc[box.id] = {
    id: box.id,
    display: box.display,
    children: box.children.map(({ name, box: c }) => ({ id: c.id, name })),
    parentId: box.parent ? box.parent.id : null,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: box.text || undefined,
    undoStack: box.undoStack,
    redoStack: box.redoStack,
  };
  for (const { box: child } of box.children) {
    collectPersistedSubtree(child, acc);
  }
}

export function serializeFullTree(
  root: Box
): PersistedState["tree"] {
  const boxes: Record<string, PersistedSerializedBox> = {};
  collectPersistedSubtree(root, boxes);
  return { rootId: root.id, boxes };
}

function migrateStackEntries(raw: any[]): StackEntry[] {
  return raw.map(e => {
    const entry: StackEntry = 'op' in e ? e as StackEntry : { op: e as Op };
    const op = entry.op as any;
    if ((op.kind === "AddBox" || op.kind === "RemoveBox") && op.name === undefined) {
      op.name = "box";
    }
    if ((op.kind === "WrapInParent" || op.kind === "UnwrapFromParent") && op.childName === undefined) {
      op.childName = "box";
    }
    if ((op.kind === "GroupBoxes" || op.kind === "UngroupBoxes") && op.groupName === undefined) {
      op.groupName = "group";
    }
    if ((op.kind === "CollapseBox" || op.kind === "UncollapseBox") && op.boxName === undefined) {
      op.boxName = "box";
    }
    return entry;
  });
}

export function deserializeFullTree(data: PersistedState["tree"]): Box {
  const live: Record<string, Box> = {};
  for (const id of Object.keys(data.boxes)) {
    const s = data.boxes[id];
    live[id] = {
      id: s.id,
      display: s.display,
      children: [],
      parent: null,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      text: s.text ?? "",
      undoStack: migrateStackEntries(s.undoStack ?? []),
      redoStack: migrateStackEntries(s.redoStack ?? []),
    };
  }
  for (const id of Object.keys(data.boxes)) {
    const s = data.boxes[id];
    const box = live[id];
    box.children = deserializeChildren(s, data.boxes, live);
    box.parent = s.parentId ? live[s.parentId] : null;
  }
  return live[data.rootId];
}

export function invertOp(op: Op): Op {
  switch (op.kind) {
    case "MoveBox":
      return { kind: "MoveBox", id: op.id, x: op.prevX, y: op.prevY, prevX: op.x, prevY: op.y };
    case "ResizeBox":
      return { kind: "ResizeBox", id: op.id, w: op.prevW, h: op.prevH, prevW: op.w, prevH: op.h };
    case "RenameBox":
      return { kind: "RenameBox", id: op.id, label: op.prevLabel, prevLabel: op.label };
    case "SetBoxText":
      return { kind: "SetBoxText", id: op.id, text: op.prevText, prevText: op.text };
    case "SetDisplay":
      return { kind: "SetDisplay", id: op.id, display: op.prevDisplay, prevDisplay: op.display };
    case "AddBox":
      return { kind: "RemoveBox", parentId: op.parentId, index: op.index, name: op.name, subtree: op.subtree };
    case "RemoveBox":
      return { kind: "AddBox", parentId: op.parentId, index: op.index, name: op.name, subtree: op.subtree };
    case "WrapInParent":
      return { kind: "UnwrapFromParent", wrapperId: op.wrapperId, childId: op.childId, childName: op.childName, prevX: op.prevX, prevY: op.prevY };
    case "UnwrapFromParent":
      return { kind: "WrapInParent", wrapperId: op.wrapperId, childId: op.childId, childName: op.childName, prevX: op.prevX, prevY: op.prevY };
    case "GroupBoxes":
      return { ...op, kind: "UngroupBoxes" };
    case "UngroupBoxes":
      return { ...op, kind: "GroupBoxes" };
    case "CollapseBox":
      return { ...op, kind: "UncollapseBox" };
    case "UncollapseBox":
      return { ...op, kind: "CollapseBox" };
  }
}

export function applyOp(
  root: Box,
  worldId: string,
  op: Op
): { root: Box; worldId: string } {
  switch (op.kind) {
    case "MoveBox": {
      const box = findBox(root, op.id);
      if (box) { box.x = op.x; box.y = op.y; }
      return { root, worldId };
    }
    case "ResizeBox": {
      const box = findBox(root, op.id);
      if (box) { box.w = op.w; box.h = op.h; }
      return { root, worldId };
    }
    case "RenameBox": {
      const box = findBox(root, op.id);
      if (box?.parent) {
        const nc = box.parent.children.find(c => c.box === box);
        if (nc) nc.name = op.label;
      }
      return { root, worldId };
    }
    case "SetBoxText": {
      const box = findBox(root, op.id);
      if (box) { box.text = op.text; }
      return { root, worldId };
    }
    case "SetDisplay": {
      const box = findBox(root, op.id);
      if (box) { box.display = op.display; }
      return { root, worldId };
    }
    case "AddBox": {
      const parent = findBox(root, op.parentId);
      if (!parent) return { root, worldId };
      const newBox = deserializeOpSubtree(op.subtree);
      newBox.parent = parent;
      parent.children.splice(op.index, 0, { name: op.name, box: newBox });
      return { root, worldId };
    }
    case "RemoveBox": {
      const parent = findBox(root, op.parentId);
      if (!parent) return { root, worldId };
      const nc = parent.children[op.index];
      if (!nc) return { root, worldId };
      parent.children.splice(op.index, 1);
      nc.box.parent = null;
      let newWorldId = worldId;
      if (findBox(nc.box, worldId)) {
        newWorldId = parent.id;
      }
      return { root, worldId: newWorldId };
    }
    case "WrapInParent": {
      const child = findBox(root, op.childId);
      if (!child) return { root, worldId };
      const wrapper: Box = {
        id: op.wrapperId,
        display: "window" as DisplayMode,
        children: [{ name: op.childName, box: child }],
        parent: null,
        x: 0,
        y: 0,
        w: 180,
        h: 130,
        text: "",
        undoStack: [] as StackEntry[],
        redoStack: [] as StackEntry[],
      };
      child.parent = wrapper;
      child.display = "window";
      child.x = 40;
      child.y = 40;
      let newWorldId = worldId;
      if (worldId === child.id) {
        newWorldId = wrapper.id;
      }
      return { root: wrapper, worldId: newWorldId };
    }
    case "UnwrapFromParent": {
      const wrapper = findBox(root, op.wrapperId) ?? root;
      const child = findBox(wrapper, op.childId);
      if (!child) return { root, worldId };
      child.parent = null;
      child.x = op.prevX;
      child.y = op.prevY;
      let newWorldId = worldId;
      if (worldId === wrapper.id) {
        newWorldId = child.id;
      }
      return { root: child, worldId: newWorldId };
    }
    case "GroupBoxes": {
      const world = findBox(root, op.worldId);
      if (!world) return { root, worldId };
      const childNcMap = new Map(world.children.map(nc => [nc.box.id, nc]));
      const toGroup = op.childIds.map(id => childNcMap.get(id)).filter((nc): nc is NamedChild => nc !== undefined);
      if (toGroup.length !== op.childIds.length) return { root, worldId };
      const group: Box = {
        id: op.groupId,
        display: "window",
        children: [],
        parent: world,
        x: op.groupX,
        y: op.groupY,
        w: op.groupW,
        h: op.groupH,
        text: "",
        undoStack: [],
        redoStack: [],
      };
      for (const nc of toGroup) {
        const child = nc.box;
        const newPos = op.newPositions.find(p => p.id === child.id)!;
        child.x = newPos.x;
        child.y = newPos.y;
        child.parent = group;
        group.children.push({ name: nc.name, box: child });
      }
      if (op.groupText !== undefined) {
        world.text = op.worldNewText ?? world.text;
        group.text = op.groupText;
      }
      world.children = world.children.filter(c => !op.childIds.includes(c.box.id));
      world.children.splice(Math.min(op.groupInsertIndex, world.children.length), 0, { name: op.groupName, box: group });
      return { root, worldId };
    }
    case "UngroupBoxes": {
      const world = findBox(root, op.worldId);
      if (!world) return { root, worldId };
      const groupIdx = world.children.findIndex(c => c.box.id === op.groupId);
      if (groupIdx === -1) return { root, worldId };
      const [groupNc] = world.children.splice(groupIdx, 1);
      const group = groupNc.box;
      const restorations = op.childIds
        .map((id, i) => ({
          id,
          index: op.childIndices[i],
          prevPos: op.prevPositions.find(p => p.id === id)!,
        }))
        .sort((a, b) => a.index - b.index);
      for (const r of restorations) {
        const nc = group.children.find(c => c.box.id === r.id);
        if (!nc) continue;
        const child = nc.box;
        child.x = r.prevPos.x;
        child.y = r.prevPos.y;
        child.parent = world;
        world.children.splice(r.index, 0, { name: nc.name, box: child });
      }
      if (op.worldPrevText !== undefined) {
        world.text = op.worldPrevText;
      }
      let newWorldId = worldId;
      if (worldId === op.groupId) newWorldId = op.worldId;
      return { root, worldId: newWorldId };
    }
    case "CollapseBox": {
      const parent = findBox(root, op.parentId);
      const box = findBox(root, op.boxId);
      if (!parent || !box) return { root, worldId };
      parent.children.splice(op.boxIndex, 1);
      for (let i = 0; i < op.childIds.length; i++) {
        const nc = box.children.find(c => c.box.id === op.childIds[i]);
        if (!nc) continue;
        const child = nc.box;
        const newPos = op.newPositions.find(p => p.id === child.id)!;
        child.x = newPos.x;
        child.y = newPos.y;
        child.parent = parent;
        parent.children.splice(op.boxIndex + i, 0, { name: nc.name, box: child });
      }
      parent.text = op.parentNewText;
      let newWorldId = worldId;
      if (worldId === op.boxId) newWorldId = op.parentId;
      return { root, worldId: newWorldId };
    }
    case "UncollapseBox": {
      const parent = findBox(root, op.parentId);
      if (!parent) return { root, worldId };
      const childrenToMove = op.childIds
        .map(id => parent.children.find(c => c.box.id === id))
        .filter((nc): nc is NamedChild => nc !== undefined);
      parent.children = parent.children.filter(c => !op.childIds.includes(c.box.id));
      const sBox = op.subtree.boxes[op.boxId];
      const box: Box = {
        id: sBox.id,
        display: sBox.display,
        children: [],
        parent: parent,
        x: sBox.x,
        y: sBox.y,
        w: sBox.w,
        h: sBox.h,
        text: sBox.text ?? "",
        undoStack: [],
        redoStack: [],
      };
      for (const nc of childrenToMove) {
        const child = nc.box;
        const prevPos = op.prevPositions.find(p => p.id === child.id)!;
        child.x = prevPos.x;
        child.y = prevPos.y;
        child.parent = box;
        box.children.push({ name: nc.name, box: child });
      }
      parent.children.splice(op.boxIndex, 0, { name: op.boxName, box });
      parent.text = op.parentPrevText;
      return { root, worldId };
    }
  }
}

function stackBoxId(op: Op, root: Box): string | null {
  switch (op.kind) {
    case "MoveBox":
    case "ResizeBox":
    case "RenameBox":
      return findBox(root, op.id)?.parent?.id ?? op.id;
    case "SetDisplay":
      return null;
    case "SetBoxText":
      return op.id;
    case "AddBox":
    case "RemoveBox":
      return op.parentId;
    case "WrapInParent":
    case "UnwrapFromParent":
      return op.childId;
    case "GroupBoxes":
    case "UngroupBoxes":
      return op.worldId;
    case "CollapseBox":
    case "UncollapseBox":
      return op.parentId;
  }
}

function evaluateGuard(guard: Guard, root: Box): boolean {
  switch (guard.kind) {
    case "wrapperIsClean": {
      const wrapper = findBox(root, guard.wrapperId);
      if (!wrapper) return true;
      return (
        wrapper.children.length === 1 &&
        wrapper.children[0].box.id === guard.childId &&
        wrapper.undoStack.length === 0
      );
    }
  }
}

function guardForOp(op: Op): Guard | undefined {
  if (op.kind === "WrapInParent") {
    return { kind: "wrapperIsClean", wrapperId: op.wrapperId, childId: op.childId };
  }
  return undefined;
}

export function canUndo(box: Box, root: Box): boolean {
  const entry = box.undoStack[box.undoStack.length - 1];
  if (!entry) return false;
  if (entry.guard && !evaluateGuard(entry.guard, root)) return false;
  return true;
}

export function recordOn(
  root: Box,
  worldId: string,
  op: Op
): { root: Box; worldId: string } {
  const result = applyOp(root, worldId, op);
  const stackId = stackBoxId(op, result.root);
  if (stackId !== null) {
    const stackBox = findBox(result.root, stackId);
    if (stackBox) {
      stackBox.undoStack.push({ op, guard: guardForOp(op) });
      stackBox.redoStack = [];
    }
  }
  persist(result.root, result.worldId);
  return result;
}

export function undoBox(
  box: Box,
  root: Box,
  worldId: string
): { root: Box; worldId: string } {
  const entry = box.undoStack[box.undoStack.length - 1];
  if (!entry) return { root, worldId };
  if (entry.guard && !evaluateGuard(entry.guard, root)) return { root, worldId };
  box.undoStack.pop();
  const result = applyOp(root, worldId, invertOp(entry.op));
  const stackId = stackBoxId(entry.op, result.root);
  if (stackId !== null) {
    const stackBox = findBox(result.root, stackId);
    if (stackBox) {
      stackBox.redoStack.push(entry);
    }
  }
  persist(result.root, result.worldId);
  return result;
}

export function redoBox(
  box: Box,
  root: Box,
  worldId: string
): { root: Box; worldId: string } {
  const entry = box.redoStack.pop();
  if (!entry) return { root, worldId };
  const result = applyOp(root, worldId, entry.op);
  const stackId = stackBoxId(entry.op, result.root);
  if (stackId !== null) {
    const stackBox = findBox(result.root, stackId);
    if (stackBox) {
      stackBox.undoStack.push(entry);
    }
  }
  persist(result.root, result.worldId);
  return result;
}

export function persist(root: Box, worldId: string): void {
  const state: PersistedState = {
    tree: serializeFullTree(root),
    worldId,
    nextId: getNextId(),
  };
  localStorage.setItem(storageKey(), JSON.stringify(state));
}

export function loadOrInit(): { root: Box; worldId: string } {
  const key = storageKey();
  const loaded = tryLoadFromKey(key);
  if (loaded) return loaded;

  if (key !== MAINLINE_KEY) {
    // First visit to this preview: seed from mainline so the user starts from
    // their real state rather than a blank canvas.  Persist immediately to
    // claim the preview key; future mutations stay isolated from mainline.
    const seeded = tryLoadFromKey(MAINLINE_KEY);
    if (seeded) {
      persist(seeded.root, seeded.worldId);
      return seeded;
    }
  }

  const root = createRoot();
  return { root, worldId: root.id };
}

export function mkMoveBox(
  box: Box,
  newX: number,
  newY: number
): Op {
  return { kind: "MoveBox", id: box.id, x: newX, y: newY, prevX: box.x, prevY: box.y };
}

export function mkResizeBox(
  box: Box,
  newW: number,
  newH: number
): Op {
  return { kind: "ResizeBox", id: box.id, w: newW, h: newH, prevW: box.w, prevH: box.h };
}

export function mkRenameBox(
  box: Box,
  newLabel: string
): Op {
  return { kind: "RenameBox", id: box.id, label: newLabel, prevLabel: getBoxName(box) };
}

export function mkSetDisplay(
  box: Box,
  newDisplay: DisplayMode
): Op {
  return { kind: "SetDisplay", id: box.id, display: newDisplay, prevDisplay: box.display };
}

const NEW_BOX_W = 180;
const NEW_BOX_H = 130;
const ICON_APPROX_W = 120;
const ICON_APPROX_H = 44;

function boxFitsInParent(x: number, y: number, w: number, h: number, pw: number, ph: number): boolean {
  return x >= 0 && y >= 0 && x + w <= pw && y + h <= ph;
}

function overlapsAny(x: number, y: number, w: number, h: number, siblings: Box[]): boolean {
  for (const s of siblings) {
    const sw = s.display === "window" ? s.w : ICON_APPROX_W;
    const sh = s.display === "window" ? s.h : ICON_APPROX_H;
    if (x < s.x + sw && x + w > s.x && y < s.y + sh && y + h > s.y) return true;
  }
  return false;
}

function findClearSpot(
  siblings: Box[],
  pw: number,
  ph: number,
  w: number,
  h: number
): { x: number; y: number } | null {
  const STEP = 10;
  for (let scanY = 0; scanY + h <= ph; scanY += STEP) {
    for (let scanX = 0; scanX + w <= pw; scanX += STEP) {
      if (!overlapsAny(scanX, scanY, w, h, siblings)) return { x: scanX, y: scanY };
    }
  }
  return null;
}

function freshBoxPosition(
  parent: Box,
  pw: number,
  ph: number
): { x: number; y: number } {
  const kids = parent.children.map(nc => nc.box);

  if (kids.length >= 2) {
    const last = kids[kids.length - 1];
    const prev = kids[kids.length - 2];
    const lx = last.x + (last.x - prev.x);
    const ly = last.y + (last.y - prev.y);
    if (boxFitsInParent(lx, ly, NEW_BOX_W, NEW_BOX_H, pw, ph)) {
      return { x: lx, y: ly };
    }
  }

  const spot = findClearSpot(kids, pw, ph, NEW_BOX_W, NEW_BOX_H);
  if (spot) return spot;

  return { x: 20 + Math.random() * 80, y: 20 + Math.random() * 60 };
}

export function mkAddBox(parent: Box, parentW?: number, parentH?: number): Op {
  const id = freshId();
  const pw = parentW ?? parent.w;
  const ph = parentH ?? Math.max(0, parent.h - BAR_H);
  const { x, y } = freshBoxPosition(parent, pw, ph);
  const serialized: SerializedBox = {
    id,
    display: "window",
    children: [],
    parentId: parent.id,
    x,
    y,
    w: NEW_BOX_W,
    h: NEW_BOX_H,
  };
  const subtree: OpSubtree = {
    rootId: id,
    boxes: { [id]: serialized },
  };
  return {
    kind: "AddBox",
    parentId: parent.id,
    index: parent.children.length,
    name: "box",
    subtree,
  };
}

export function mkRemoveBox(box: Box): Op {
  if (!box.parent) throw new Error("Cannot remove root box");
  const index = box.parent.children.findIndex(c => c.box === box);
  return {
    kind: "RemoveBox",
    parentId: box.parent.id,
    index,
    name: getBoxName(box),
    subtree: serializeOpSubtree(box),
  };
}

export function mkCollapseBox(box: Box): Op {
  if (!box.parent) throw new Error("Cannot collapse root box");
  const parent = box.parent;
  const boxIndex = parent.children.findIndex(c => c.box === box);
  const childIds = box.children.map(nc => nc.box.id);
  const prevPositions: PositionRecord[] = box.children.map(nc => ({ id: nc.box.id, x: nc.box.x, y: nc.box.y }));
  const newPositions: PositionRecord[] = box.children.map(nc => ({
    id: nc.box.id,
    x: box.x + nc.box.x,
    y: box.y + BAR_H + nc.box.y,
  }));
  const parentNewText = box.text
    ? (parent.text ? parent.text + " " + box.text : box.text)
    : parent.text;
  return {
    kind: "CollapseBox",
    boxId: box.id,
    parentId: parent.id,
    boxIndex,
    boxName: getBoxName(box),
    subtree: serializeOpSubtree(box),
    childIds,
    prevPositions,
    newPositions,
    parentPrevText: parent.text,
    parentNewText,
  };
}

export function mkWrapInParent(box: Box): Op {
  const wrapperId = freshId();
  return {
    kind: "WrapInParent",
    wrapperId,
    childId: box.id,
    childName: getBoxName(box),
    prevX: box.x,
    prevY: box.y,
  };
}

export function mkSetBoxText(box: Box, newText: string): Op {
  return { kind: "SetBoxText", id: box.id, text: newText, prevText: box.text };
}

// BAR_H must match .box-window-bar min-height in CSS
const BAR_H = 44;

export function mkGroupBoxes(world: Box, toGroup: Box[], groupText = "", worldNewText = world.text, fallbackCenter?: { x: number; y: number }): Op {
  const PADDING = 20;
  let groupX: number, groupY: number, groupW: number, groupH: number;

  if (toGroup.length > 0) {
    const minX = Math.min(...toGroup.map(b => b.x));
    const minY = Math.min(...toGroup.map(b => b.y));
    const maxX = Math.max(...toGroup.map(b => b.x + (b.display === "window" ? b.w : 120)));
    const maxY = Math.max(...toGroup.map(b => b.y + (b.display === "window" ? b.h : 44)));
    groupX = minX - PADDING;
    groupY = minY - PADDING - BAR_H;
    groupW = Math.max(180, maxX - minX + 2 * PADDING);
    groupH = Math.max(130, BAR_H + maxY - minY + 2 * PADDING);
  } else {
    groupW = 180;
    groupH = BAR_H + 130;
    const cx = fallbackCenter?.x ?? PADDING + groupW / 2;
    const cy = fallbackCenter?.y ?? PADDING + groupH / 2;
    groupX = cx - groupW / 2;
    groupY = cy - groupH / 2;
  }

  const groupId = freshId();
  const childIds = toGroup.map(b => b.id);
  const childIndices = toGroup.map(b => world.children.findIndex(nc => nc.box === b));
  const prevPositions: PositionRecord[] = toGroup.map(b => ({ id: b.id, x: b.x, y: b.y }));
  const newPositions: PositionRecord[] = toGroup.map(b => ({
    id: b.id,
    x: b.x - groupX,
    y: b.y - groupY - BAR_H,
  }));

  return {
    kind: "GroupBoxes",
    worldId: world.id,
    groupId,
    groupName: "group",
    childIds,
    childIndices,
    prevPositions,
    newPositions,
    groupX,
    groupY,
    groupW,
    groupH,
    groupInsertIndex: childIndices.length > 0 ? Math.min(...childIndices) : world.children.length,
    worldPrevText: world.text,
    worldNewText,
    groupText,
  };
}
