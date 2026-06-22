import { applyOp, findBox, mkAddBox, mkAddPointer, mkMoveBox, mkReorderChild, mkResizeBox, mkSetDisplay, persist } from "./history.js";
import type { Box, DisplayMode, Op, RegularBox } from "./model.js";
import { getBoxTitle, isPointer } from "./model.js";

interface ScriptContext {
  root: Box;
  worldId: string;
  focusedBoxId: string | null;
  selectedBoxIds: Set<string>;
  pendingOps: Op[];
  callerBox: Box | null;
}

function resolveParam(callerBox: Box, name: string, defaultVal = 0): number {
  let current: Box | null = callerBox;
  while (current !== null) {
    if (!isPointer(current)) {
      const found = current.children.find(c => c.title === name);
      if (found) {
        const b = found.box;
        const text = isPointer(b) ? "" : b.text;
        const n = parseFloat(text);
        if (!isNaN(n)) return n;
      }
    }
    current = current.parent;
  }
  return defaultVal;
}

type Word = (ctx: ScriptContext) => void;

const THEME_KEY = "consender-theme";

const BUILTINS: Record<string, Word> = {
  darkTheme: (_ctx) => {
    document.documentElement.dataset.theme = "dark";
    localStorage.setItem(THEME_KEY, "dark");
  },
  lightTheme: (_ctx) => {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_KEY);
  },
  iconify: (ctx) => {
    for (const id of ctx.selectedBoxIds) {
      const box = findBox(ctx.root, id);
      if (box && box.display !== "icon") ctx.pendingOps.push(mkSetDisplay(box, "icon"));
    }
  },
  windowify: (ctx) => {
    for (const id of ctx.selectedBoxIds) {
      const box = findBox(ctx.root, id);
      if (box && box.display !== "window") ctx.pendingOps.push(mkSetDisplay(box, "window"));
    }
  },
  "clear-focus": (ctx) => {
    ctx.selectedBoxIds.clear();
  },
  "help": (ctx) => {
    if (!ctx.focusedBoxId) return;
    const focusBox = findBox(ctx.root, ctx.focusedBoxId);
    if (!focusBox) return;
    const destBox: RegularBox | null = (() => {
      if (isPointer(focusBox)) {
        const target = findBox(ctx.root, focusBox.pointerToId);
        return target && !isPointer(target) ? target : null;
      }
      return focusBox;
    })();
    if (!destBox) return;
    const extraSiblings: Array<{ x: number; y: number; w: number; h: number; display: DisplayMode }> = [];
    for (const label of ["help", "builtinLabels", "builtinCommands"] as const) {
      const op = mkAddBox(destBox, undefined, undefined, label, extraSiblings);
      if (op.kind === "AddBox") {
        const b = op.subtree.boxes[op.subtree.rootId];
        if (b) extraSiblings.push({ x: b.x, y: b.y, w: b.w, h: b.h, display: "window" });
      }
      ctx.pendingOps.push(op);
    }
  },
  nudgeBox: (ctx) => {
    if (!ctx.callerBox) return;
    const dx = resolveParam(ctx.callerBox, "dx");
    const dy = resolveParam(ctx.callerBox, "dy");
    const dwidth = resolveParam(ctx.callerBox, "dwidth");
    const dheight = resolveParam(ctx.callerBox, "dheight");
    const dlayer = resolveParam(ctx.callerBox, "dlayer");
    for (const id of ctx.selectedBoxIds) {
      const box = findBox(ctx.root, id);
      if (!box) continue;
      if (dx !== 0 || dy !== 0) ctx.pendingOps.push(mkMoveBox(box, box.x + dx, box.y + dy));
      if (dwidth !== 0 || dheight !== 0) ctx.pendingOps.push(mkResizeBox(box, box.w + dwidth, box.h + dheight));
      if (dlayer !== 0) {
        const op = mkReorderChild(box, dlayer);
        if (op) ctx.pendingOps.push(op);
      }
    }
  },
  "link": (ctx) => {
    if (!ctx.focusedBoxId) return;
    const focusBox = findBox(ctx.root, ctx.focusedBoxId);
    if (!focusBox) return;
    // If the focused box is a pointer, insert into the target so the result is
    // visible (the UI renders the target's children, not the pointer's own).
    const destBox: RegularBox | null = (() => {
      if (isPointer(focusBox)) {
        const target = findBox(ctx.root, focusBox.pointerToId);
        return target && !isPointer(target) ? target : null;
      }
      return focusBox;
    })();
    if (!destBox) return;
    const destId = destBox.id;
    let insertIdx = destBox.children.length;
    const newIds: string[] = [];
    for (const id of ctx.selectedBoxIds) {
      // If selected box is a pointer, use its target — chains have length 1
      // by invariant (pointers always reference RegularBoxes).
      const found = findBox(ctx.root, id);
      const resolved = found && isPointer(found) ? findBox(ctx.root, found.pointerToId) : found;
      if (!resolved || resolved.id === destId) continue;
      const op = mkAddPointer(destBox, resolved.id, getBoxTitle(resolved), insertIdx++);
      if (op.kind === "AddBox") newIds.push(op.subtree.rootId);
      ctx.pendingOps.push(op);
    }
    ctx.selectedBoxIds.clear();
    for (const id of newIds) ctx.selectedBoxIds.add(id);
  },
};

export function isBuiltinCommand(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, word);
}

export function runScript(
  scriptText: string,
  root: Box,
  worldId: string,
  selectedBoxIds: Set<string>,
  focusedBoxId: string | null = null,
  callerBoxId: string | null = null
): { root: Box; worldId: string } {
  const tokens = scriptText.trim().split(/\s+/).filter(Boolean);
  const callerBox = callerBoxId ? findBox(root, callerBoxId) ?? null : null;
  const ctx: ScriptContext = { root, worldId, focusedBoxId, selectedBoxIds, pendingOps: [], callerBox };

  for (const token of tokens) {
    const word = BUILTINS[token];
    if (word) word(ctx);
  }

  if (ctx.pendingOps.length === 0) return { root, worldId };

  const batch: Op = { kind: "BatchOp", ops: ctx.pendingOps };
  const result = applyOp(root, worldId, batch);

  // Record the whole script run as a single undo entry on the world box.
  const worldBox = findBox(result.root, result.worldId);
  if (worldBox) {
    worldBox.undoStack.push({ op: batch });
    worldBox.redoStack = [];
  }
  persist(result.root, result.worldId);
  return result;
}
