import { applyOp, findBox, mkSetDisplay, persist } from "./history.js";
import type { Box, Op } from "./model.js";

interface ScriptContext {
  root: Box;
  worldId: string;
  selectedBoxIds: Set<string>;
  pendingOps: Op[];
}

type Word = (ctx: ScriptContext) => void;

const BUILTINS: Record<string, Word> = {
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
};

export function runScript(
  scriptText: string,
  root: Box,
  worldId: string,
  selectedBoxIds: Set<string>
): { root: Box; worldId: string } {
  const tokens = scriptText.trim().split(/\s+/).filter(Boolean);
  const ctx: ScriptContext = { root, worldId, selectedBoxIds, pendingOps: [] };

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
