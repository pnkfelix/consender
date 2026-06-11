import {
  createRoot,
  freshId,
  getNextId,
  setNextId,
} from "./model.js";
import type { Box, DisplayMode, Guard, Line, LineOp, Op, OpSubtree, PositionRecord, SerializedBox, SerializedLine, StackEntry } from "./model.js";

export type { Guard, Line, LineOp, Op, OpSubtree, SerializedBox, SerializedLine, StackEntry };

// Mainline key is stable for backward compatibility with existing stored data.
const MAINLINE_KEY = "consender-state";

// --- line helpers ---

function deserializeLines(s: SerializedBox): Line[] {
  if (s.lines && s.lines.length > 0) return s.lines.map(l => ({ id: l.id, text: l.text }));
  if (s.text) return s.text.split("\n").map(t => ({ id: freshId(), text: t }));
  return [];
}

// Sets both text and lines from a plain string, generating fresh line IDs.
// Used by structural ops (CollapseBox, GroupBoxes) that deal in flat strings.
function setBoxContent(box: Box, text: string): void {
  box.text = text;
  box.lines = text ? text.split("\n").map(t => ({ id: freshId(), text: t })) : [];
}

// Sets both text and lines from a Line array.
function setBoxLines(box: Box, lines: Line[]): void {
  box.lines = lines;
  box.text = lines.map(l => l.text).join("\n");
}

// LCS-based: match new line texts to old lines, preserving IDs where text is unchanged.
function matchLinesForEdit(oldLines: Line[], newTexts: string[]): SerializedLine[] {
  if (newTexts.length === 0) return [];
  const m = oldLines.length, n = newTexts.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i-1].text === newTexts[j-1]
        ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const newToOld = new Map<number, Line>();
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i-1].text === newTexts[j-1]) {
      newToOld.set(j-1, oldLines[i-1]); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      j--;
    } else {
      i--;
    }
  }
  return newTexts.map((text, idx) => {
    const matched = newToOld.get(idx);
    return matched ? { id: matched.id, text } : { id: freshId(), text };
  });
}

// Compute a LineOp sequence describing the diff from oldLines to newLines (matched by ID).
function diffLinesForOp(oldLines: Line[], newLines: SerializedLine[]): LineOp[] {
  const ops: LineOp[] = [];
  const oldIds = oldLines.map(l => l.id);
  const newIds = newLines.map(l => l.id);
  const m = oldIds.length, n = newIds.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldIds[i-1] === newIds[j-1]
        ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  type Edit = { type: "keep" | "delete" | "insert"; oi?: number; ni?: number };
  const edits: Edit[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldIds[i-1] === newIds[j-1]) {
      edits.unshift({ type: "keep", oi: i-1, ni: j-1 }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      edits.unshift({ type: "insert", ni: j-1 }); j--;
    } else {
      edits.unshift({ type: "delete", oi: i-1 }); i--;
    }
  }
  let lastSurvivorId: string | null = null;
  for (const edit of edits) {
    if (edit.type === "keep") {
      lastSurvivorId = oldIds[edit.oi!];
    } else if (edit.type === "delete") {
      const ol = oldLines[edit.oi!];
      const prevAfterId = edit.oi! > 0 ? oldIds[edit.oi! - 1] : null;
      ops.push({ kind: "DeleteLine", id: ol.id, prevText: ol.text, prevAfterId });
    } else {
      const nl = newLines[edit.ni!];
      ops.push({ kind: "InsertLine", afterId: lastSurvivorId, newId: nl.id, text: nl.text });
      lastSurvivorId = nl.id;
    }
  }
  return ops;
}

function invertLineOp(op: LineOp): LineOp {
  switch (op.kind) {
    case "InsertLine": return { kind: "DeleteLine", id: op.newId, prevText: op.text, prevAfterId: op.afterId };
    case "DeleteLine": return { kind: "InsertLine", afterId: op.prevAfterId, newId: op.id, text: op.prevText };
    case "EditLine":   return { kind: "EditLine",   id: op.id, newText: op.prevText, prevText: op.newText };
  }
}

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
    lines: box.lines.length > 0 ? box.lines.map(l => ({ id: l.id, text: l.text })) : undefined,
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
    const lines = deserializeLines(s);
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
      lines,
      text: lines.map(l => l.text).join("\n"),
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
    lines: box.lines.length > 0 ? box.lines.map(l => ({ id: l.id, text: l.text })) : undefined,
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

function migrateStackEntries(raw: any[]): StackEntry[] {
  return raw.map(e => ('op' in e ? e as StackEntry : { op: e as Op }));
}

export function deserializeFullTree(data: PersistedState["tree"]): Box {
  const live: Record<string, Box> = {};
  for (const id of Object.keys(data.boxes)) {
    const s = data.boxes[id];
    const lines = deserializeLines(s);
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
      lines,
      text: lines.map(l => l.text).join("\n"),
      undoStack: migrateStackEntries(s.undoStack ?? []),
      redoStack: migrateStackEntries(s.redoStack ?? []),
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
    case "EditText":
      return { kind: "EditText", boxId: op.boxId, prevLines: op.newLines, newLines: op.prevLines,
               lineOps: [...op.lineOps].reverse().map(invertLineOp) };
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
      if (box) { box.label = op.label; }
      return { root, worldId };
    }
    case "SetBoxText": {
      const box = findBox(root, op.id);
      if (box) setBoxContent(box, op.text);
      return { root, worldId };
    }
    case "EditText": {
      const box = findBox(root, op.boxId);
      if (box) setBoxLines(box, op.newLines.map(l => ({ id: l.id, text: l.text })));
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
        lines: [] as Line[],
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
        lines: [],
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
      if (op.groupText !== undefined) {
        setBoxContent(world, op.worldNewText ?? world.text);
        setBoxContent(group, op.groupText);
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
      if (op.worldPrevText !== undefined) {
        setBoxContent(world, op.worldPrevText);
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
        const child = box.children.find(c => c.id === op.childIds[i]);
        if (!child) continue;
        const newPos = op.newPositions.find(p => p.id === child.id)!;
        child.x = newPos.x;
        child.y = newPos.y;
        child.parent = parent;
        parent.children.splice(op.boxIndex + i, 0, child);
      }
      setBoxContent(parent, op.parentNewText);
      let newWorldId = worldId;
      if (worldId === op.boxId) newWorldId = op.parentId;
      return { root, worldId: newWorldId };
    }
    case "UncollapseBox": {
      const parent = findBox(root, op.parentId);
      if (!parent) return { root, worldId };
      const childrenToMove = op.childIds
        .map(id => parent.children.find(c => c.id === id))
        .filter((c): c is Box => c !== undefined);
      parent.children = parent.children.filter(c => !op.childIds.includes(c.id));
      const sBox = op.subtree.boxes[op.boxId];
      const sBoxLines = deserializeLines(sBox);
      const box: Box = {
        id: sBox.id,
        label: sBox.label,
        display: sBox.display,
        children: [],
        parent: parent,
        x: sBox.x,
        y: sBox.y,
        w: sBox.w,
        h: sBox.h,
        lines: sBoxLines,
        text: sBoxLines.map(l => l.text).join("\n"),
        undoStack: [],
        redoStack: [],
      };
      for (const child of childrenToMove) {
        const prevPos = op.prevPositions.find(p => p.id === child.id)!;
        child.x = prevPos.x;
        child.y = prevPos.y;
        child.parent = box;
        box.children.push(child);
      }
      parent.children.splice(op.boxIndex, 0, box);
      setBoxContent(parent, op.parentPrevText);
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
    case "EditText":
      return op.boxId;
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
        wrapper.children[0].id === guard.childId &&
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
  return { kind: "RenameBox", id: box.id, label: newLabel, prevLabel: box.label };
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
  const kids = parent.children;

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
    label: "box",
    display: "window",
    childIds: [],
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

export function mkCollapseBox(box: Box): Op {
  if (!box.parent) throw new Error("Cannot collapse root box");
  const parent = box.parent;
  const boxIndex = parent.children.indexOf(box);
  const childIds = box.children.map(c => c.id);
  const prevPositions: PositionRecord[] = box.children.map(c => ({ id: c.id, x: c.x, y: c.y }));
  const newPositions: PositionRecord[] = box.children.map(c => ({
    id: c.id,
    x: box.x + c.x,
    y: box.y + BAR_H + c.y,
  }));
  const parentNewText = box.text
    ? (parent.text ? parent.text + " " + box.text : box.text)
    : parent.text;
  return {
    kind: "CollapseBox",
    boxId: box.id,
    parentId: parent.id,
    boxIndex,
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
    prevX: box.x,
    prevY: box.y,
  };
}

export function mkSetBoxText(box: Box, newText: string): Op {
  return { kind: "SetBoxText", id: box.id, text: newText, prevText: box.text };
}

export function mkEditText(box: Box, newText: string): Op {
  const normalized = newText.replace(/\r\n|\r/g, "\n");
  const newLineTexts = normalized === "" ? [] : normalized.split("\n");
  const prevLines: SerializedLine[] = box.lines.map(l => ({ id: l.id, text: l.text }));
  const newLines = matchLinesForEdit(box.lines, newLineTexts);
  const lineOps = diffLinesForOp(box.lines, newLines);
  return { kind: "EditText", boxId: box.id, prevLines, newLines, lineOps };
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
    worldPrevText: world.text,
    worldNewText,
    groupText,
  };
}
