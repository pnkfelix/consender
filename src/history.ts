import {
  createRoot,
  freshId,
  getNextId,
  setNextId,
} from "./model.js";
import type { Box, DisplayMode, Op, OpSubtree, PositionRecord, SerializedBox } from "./model.js";

export type { Op, OpSubtree, SerializedBox };

const STORAGE_KEY = "consender-state";

interface PersistedSerializedBox extends SerializedBox {
  undoStack: Op[];
  redoStack: Op[];
}

interface PersistedState {
  tree: { rootId: string; boxes: Record<string, PersistedSerializedBox> };
  worldId: string;
  nextId: number;
}

export function findBox(root: Box, id: string): Box | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findBox(child, id);
    if (found) return found;
  }
  return null;
}

function collectSubtree(box: Box, acc: Record<string, SerializedBox>): void {
  acc[box.id] = {
    id: box.id,
    label: box.label,
    display: box.display,
    childIds: box.children.map((c) => c.id),
    parentId: box.parent ? box.parent.id : null,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: box.text || undefined,
  };
  for (const child of box.children) {
    collectSubtree(child, acc);
  }
}

export function serializeOpSubtree(box: Box): OpSubtree {
  const boxes: Record<string, SerializedBox> = {};
  collectSubtree(box, boxes);
  return { rootId: box.id, boxes };
}

export function deserializeOpSubtree(subtree: OpSubtree): Box {
  const live: Record<string, Box> = {};
  for (const id of Object.keys(subtree.boxes)) {
    const s = subtree.boxes[id];
    live[id] = {
      id: s.id,
      label: s.label,
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
    box.children = s.childIds.map((cid) => live[cid]);
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
    label: box.label,
    display: box.display,
    childIds: box.children.map((c) => c.id),
    parentId: box.parent ? box.parent.id : null,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text: box.text || undefined,
    undoStack: box.undoStack,
    redoStack: box.redoStack,
  };
  for (const child of box.children) {
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

export function deserializeFullTree(data: PersistedState["tree"]): Box {
  const live: Record<string, Box> = {};
  for (const id of Object.keys(data.boxes)) {
    const s = data.boxes[id];
    live[id] = {
      id: s.id,
      label: s.label,
      display: s.display,
      children: [],
      parent: null,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      text: s.text ?? "",
      undoStack: s.undoStack ?? [],
      redoStack: s.redoStack ?? [],
    };
  }
  for (const id of Object.keys(data.boxes)) {
    const s = data.boxes[id];
    const box = live[id];
    box.children = s.childIds.map((cid) => live[cid]);
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
      return { kind: "RemoveBox", parentId: op.parentId, index: op.index, subtree: op.subtree };
    case "RemoveBox":
      return { kind: "AddBox", parentId: op.parentId, index: op.index, subtree: op.subtree };
    case "WrapInParent":
      return { kind: "UnwrapFromParent", wrapperId: op.wrapperId, childId: op.childId, prevX: op.prevX, prevY: op.prevY };
    case "UnwrapFromParent":
      return { kind: "WrapInParent", wrapperId: op.wrapperId, childId: op.childId, prevX: op.prevX, prevY: op.prevY };
    case "GroupBoxes":
      return { ...op, kind: "UngroupBoxes" };
    case "UngroupBoxes":
      return { ...op, kind: "GroupBoxes" };
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
      if (box) { box.label = op.label; }
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
      parent.children.splice(op.index, 0, newBox);
      return { root, worldId };
    }
    case "RemoveBox": {
      const parent = findBox(root, op.parentId);
      if (!parent) return { root, worldId };
      const removed = parent.children[op.index];
      if (!removed) return { root, worldId };
      parent.children.splice(op.index, 1);
      removed.parent = null;
      let newWorldId = worldId;
      if (findBox(removed, worldId)) {
        newWorldId = parent.id;
      }
      return { root, worldId: newWorldId };
    }
    case "WrapInParent": {
      const child = findBox(root, op.childId);
      if (!child) return { root, worldId };
      const wrapper = {
        id: op.wrapperId,
        label: "world",
        display: "window" as DisplayMode,
        children: [child],
        parent: null,
        x: 0,
        y: 0,
        w: 180,
        h: 130,
        text: "",
        undoStack: [] as Op[],
        redoStack: [] as Op[],
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
      const childMap = new Map(world.children.map(c => [c.id, c]));
      const toGroup = op.childIds.map(id => childMap.get(id)).filter((b): b is Box => b !== undefined);
      if (toGroup.length !== op.childIds.length) return { root, worldId };
      const group: Box = {
        id: op.groupId,
        label: "group",
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
      for (const child of toGroup) {
        const newPos = op.newPositions.find(p => p.id === child.id)!;
        child.x = newPos.x;
        child.y = newPos.y;
        child.parent = group;
        group.children.push(child);
      }
      world.children = world.children.filter(c => !op.childIds.includes(c.id));
      world.children.splice(Math.min(op.groupInsertIndex, world.children.length), 0, group);
      return { root, worldId };
    }
    case "UngroupBoxes": {
      const world = findBox(root, op.worldId);
      if (!world) return { root, worldId };
      const groupIdx = world.children.findIndex(c => c.id === op.groupId);
      if (groupIdx === -1) return { root, worldId };
      const [group] = world.children.splice(groupIdx, 1);
      const restorations = op.childIds
        .map((id, i) => ({
          id,
          index: op.childIndices[i],
          prevPos: op.prevPositions.find(p => p.id === id)!,
        }))
        .sort((a, b) => a.index - b.index);
      for (const r of restorations) {
        const child = group.children.find(c => c.id === r.id);
        if (!child) continue;
        child.x = r.prevPos.x;
        child.y = r.prevPos.y;
        child.parent = world;
        world.children.splice(r.index, 0, child);
      }
      let newWorldId = worldId;
      if (worldId === op.groupId) newWorldId = op.worldId;
      return { root, worldId: newWorldId };
    }
  }
}

function stackBoxId(op: Op): string {
  switch (op.kind) {
    case "MoveBox":
    case "ResizeBox":
    case "RenameBox":
    case "SetBoxText":
    case "SetDisplay":
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
  }
}

export function recordOn(
  root: Box,
  worldId: string,
  op: Op
): { root: Box; worldId: string } {
  const result = applyOp(root, worldId, op);
  const stackId = stackBoxId(op);
  const stackBox = findBox(result.root, stackId);
  if (stackBox) {
    stackBox.undoStack.push(op);
    stackBox.redoStack = [];
  }
  persist(result.root, result.worldId);
  return result;
}

export function undoBox(
  box: Box,
  root: Box,
  worldId: string
): { root: Box; worldId: string } {
  const op = box.undoStack.pop();
  if (!op) return { root, worldId };
  const result = applyOp(root, worldId, invertOp(op));
  const stackId = stackBoxId(op);
  const stackBox = findBox(result.root, stackId);
  if (stackBox) {
    stackBox.redoStack.push(op);
  }
  persist(result.root, result.worldId);
  return result;
}

export function redoBox(
  box: Box,
  root: Box,
  worldId: string
): { root: Box; worldId: string } {
  const op = box.redoStack.pop();
  if (!op) return { root, worldId };
  const result = applyOp(root, worldId, op);
  const stackId = stackBoxId(op);
  const stackBox = findBox(result.root, stackId);
  if (stackBox) {
    stackBox.undoStack.push(op);
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadOrInit(): { root: Box; worldId: string } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const state = JSON.parse(raw) as PersistedState;
      setNextId(state.nextId);
      const root = deserializeFullTree(state.tree);
      return { root, worldId: state.worldId };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
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
  return { kind: "RenameBox", id: box.id, label: newLabel, prevLabel: box.label };
}

export function mkSetDisplay(
  box: Box,
  newDisplay: DisplayMode
): Op {
  return { kind: "SetDisplay", id: box.id, display: newDisplay, prevDisplay: box.display };
}

export function mkAddBox(parent: Box): Op {
  const id = freshId();
  const x = 20 + Math.random() * 80;
  const y = 20 + Math.random() * 60;
  const serialized: SerializedBox = {
    id,
    label: "box",
    display: "window",
    childIds: [],
    parentId: parent.id,
    x,
    y,
    w: 180,
    h: 130,
  };
  const subtree: OpSubtree = {
    rootId: id,
    boxes: { [id]: serialized },
  };
  return {
    kind: "AddBox",
    parentId: parent.id,
    index: parent.children.length,
    subtree,
  };
}

export function mkRemoveBox(box: Box): Op {
  if (!box.parent) throw new Error("Cannot remove root box");
  const index = box.parent.children.indexOf(box);
  return {
    kind: "RemoveBox",
    parentId: box.parent.id,
    index,
    subtree: serializeOpSubtree(box),
  };
}

export function mkWrapInParent(box: Box): Op {
  const wrapperId = freshId();
  return {
    kind: "WrapInParent",
    wrapperId,
    childId: box.id,
    prevX: box.x,
    prevY: box.y,
  };
}

export function mkSetBoxText(box: Box, newText: string): Op {
  return { kind: "SetBoxText", id: box.id, text: newText, prevText: box.text };
}

// BAR_H must match .box-window-bar min-height in CSS
const BAR_H = 44;

export function mkGroupBoxes(world: Box, toGroup: Box[], fallbackCenter?: { x: number; y: number }): Op {
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
  const childIndices = toGroup.map(b => world.children.indexOf(b));
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
    childIds,
    childIndices,
    prevPositions,
    newPositions,
    groupX,
    groupY,
    groupW,
    groupH,
    groupInsertIndex: childIndices.length > 0 ? Math.min(...childIndices) : world.children.length,
  };
}
