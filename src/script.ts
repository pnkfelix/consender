import { applyOp, findBox, mkAddBox, mkAddPointer, mkSetDisplay, persist } from "./history.js";
import type { Box, DisplayMode, Op, RegularBox } from "./model.js";
import { getBoxTitle, isPointer } from "./model.js";
import { isTrsBox, makeTrsOps, runTrsOps, stepTrsOps } from "./trs.js";

interface ScriptContext {
  root: Box;
  worldId: string;
  focusedBoxId: string | null;
  selectedBoxIds: Set<string>;
  pendingOps: Op[];
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
  "clear-selection": (ctx) => {
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
  // Mark the focused box as a TRS (toy term-rewriting system) and seed a
  // runnable demo if it has no world/agents yet.  See src/trs.ts.
  "make-trs": (ctx) => {
    const dest = trsFocusDest(ctx);
    if (!dest) return;
    for (const op of makeTrsOps(dest, ctx.root, ctx.worldId)) ctx.pendingOps.push(op);
  },
  // Advance the focused TRS box by one global evaluation step.
  "trs-step": (ctx) => {
    const dest = trsFocusDest(ctx);
    if (!dest || !isTrsBox(dest)) return;
    for (const op of stepTrsOps(dest, ctx.root, ctx.worldId)) ctx.pendingOps.push(op);
  },
  // Run the focused TRS box until every agent halts (or a step cap is hit).
  "trs-run": (ctx) => {
    const dest = trsFocusDest(ctx);
    if (!dest || !isTrsBox(dest)) return;
    for (const op of runTrsOps(dest, ctx.root, ctx.worldId)) ctx.pendingOps.push(op);
  },
};

// Resolve the box a TRS command acts on: the focused box, following a pointer to
// its target so the command operates on the structure the UI actually renders.
function trsFocusDest(ctx: ScriptContext): RegularBox | null {
  if (!ctx.focusedBoxId) return null;
  const focusBox = findBox(ctx.root, ctx.focusedBoxId);
  if (!focusBox) return null;
  const dest = isPointer(focusBox) ? findBox(ctx.root, focusBox.pointerToId) : focusBox;
  return dest && !isPointer(dest) ? dest : null;
}

export function isBuiltinCommand(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, word);
}

export function runScript(
  scriptText: string,
  root: Box,
  worldId: string,
  selectedBoxIds: Set<string>,
  focusedBoxId: string | null = null
): { root: Box; worldId: string } {
  const tokens = scriptText.trim().split(/\s+/).filter(Boolean);
  const ctx: ScriptContext = { root, worldId, focusedBoxId, selectedBoxIds, pendingOps: [] };

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
