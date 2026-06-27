import { applyOp, findBox, mkAddBox, mkAddPointer, mkSetDisplay, persist } from "./history.js";
import type { Box, DisplayMode, Op, RegularBox } from "./model.js";
import { getBoxTitle, isPointer } from "./model.js";

interface ScriptContext {
  root: Box;
  worldId: string;
  focusedBoxId: string | null;
  selectedBoxIds: Set<string>;
  pendingOps: Op[];
}

type Word = (ctx: ScriptContext) => void;

// A builtin is one of a single, flat namespace of reserved names. Each is
// either a "command" (runnable in a script, carrying a `run` function) or a
// "label" (a name that configures or describes a box structurally). Every
// command also works as a label: a box titled with a command name is
// reinterpreted as a one-command script (see getBoxScript in view.ts).
export type BuiltinKind = "command" | "label";

export interface Builtin {
  kind: BuiltinKind;
  // One-line help describing the builtin, shown in the help bar and spawned by
  // the `help` command.
  help: string;
  // Present iff kind === "command".
  run?: Word;
}

const THEME_KEY = "consender-theme";

// Spawns help boxes for a list of builtin names beside the focused box, laying
// them out so they don't overlap. Used by the `help` command.
function spawnHelpBoxes(ctx: ScriptContext, labels: readonly string[]): void {
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
  const extraSiblings: Array<{ x: number; y: number; w: number; h: number; display: DisplayMode }> = [];
  for (const label of labels) {
    const op = mkAddBox(destBox, undefined, undefined, label, extraSiblings);
    if (op.kind === "AddBox") {
      const b = op.subtree.boxes[op.subtree.rootId];
      if (b) extraSiblings.push({ x: b.x, y: b.y, w: b.w, h: b.h, display: "window" });
    }
    ctx.pendingOps.push(op);
  }
}

// The single namespace of builtins. Concrete commands and labels are defined
// here; the index labels (builtins, builtinLabels, builtinCommands) get their
// help generated from this registry below.
const BUILTINS: Record<string, Builtin> = {
  // --- Commands ---
  help: {
    kind: "command",
    help: "consender: an infinite canvas of nested boxes. " +
      "Zoom in/out to navigate, create and group boxes, edit text, undo/redo. " +
      "Label child boxes with built-in names to configure behavior — see the builtins entry. " +
      "As a command, spawns the builtin index boxes beside the focused box.",
    run: (ctx) => spawnHelpBoxes(ctx, ["help", "builtins", "builtinLabels", "builtinCommands"]),
  },
  iconify: {
    kind: "command",
    help: "Command: collapses each selected box to its icon (minimized) display.",
    run: (ctx) => {
      for (const id of ctx.selectedBoxIds) {
        const box = findBox(ctx.root, id);
        if (box && box.display !== "icon") ctx.pendingOps.push(mkSetDisplay(box, "icon"));
      }
    },
  },
  windowify: {
    kind: "command",
    help: "Command: expands each selected box to its full window display.",
    run: (ctx) => {
      for (const id of ctx.selectedBoxIds) {
        const box = findBox(ctx.root, id);
        if (box && box.display !== "window") ctx.pendingOps.push(mkSetDisplay(box, "window"));
      }
    },
  },
  "clear-selection": {
    kind: "command",
    help: "Command: clears the current selection.",
    run: (ctx) => {
      ctx.selectedBoxIds.clear();
    },
  },
  link: {
    kind: "command",
    help: "Command: inside the focused box, adds a link (pointer alias) to each " +
      "selected box, then selects the new links.",
    run: (ctx) => {
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
  },
  darkTheme: {
    kind: "command",
    help: "Command: switches the interface to the dark color theme (persisted).",
    run: (_ctx) => {
      document.documentElement.dataset.theme = "dark";
      localStorage.setItem(THEME_KEY, "dark");
    },
  },
  lightTheme: {
    kind: "command",
    help: "Command: switches the interface to the light color theme (persisted).",
    run: (_ctx) => {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(THEME_KEY);
    },
  },

  // --- Labels ---
  world: {
    kind: "label",
    help: "Label: the implicit title of the root box — the top-level world that " +
      "contains every other box.",
  },
  box: {
    kind: "label",
    help: "Label: the generic name for an untitled box, the basic unit of the canvas.",
  },
  group: {
    kind: "label",
    help: "Label: the default title given to a box created by grouping a selection.",
  },
  toolbarPolicy: {
    kind: "label",
    help: "Controls toolbar visibility for sibling boxes. " +
      "Text: \"focus\" hides buttons until a box is tapped; \"always\" keeps them visible. " +
      "Place inside a parent to configure all its children. Walks up the tree if not found.",
  },
  render: {
    kind: "label",
    help: "Child-box property: sets the rendering mode for its parent box. " +
      "Supported text values: \"svg\" — interprets the parent's text as inline SVG markup; " +
      "\"markdown\" — renders the parent's text as formatted Markdown (CommonMark). " +
      "A raw/mode toggle button appears in the parent's title bar to switch between source and rendered views.",
  },
  script: {
    kind: "label",
    help: "Tag: adding a child box named \"script\" marks the parent as a command script box. " +
      "The command list lives in the parent's own text. The child itself needs no content. " +
      "See the builtinCommands entry for available commands.",
  },
  backgroundColor: {
    kind: "label",
    help: "Child-box property: sets the parent box's background fill, inherited by all " +
      "descendants until one sets its own backgroundColor. Value: color words in the box's text " +
      "(e.g. \"deep blue\", \"pale pink\", \"bluish green\"), or an \"oklch\" child box carrying L, C, H number boxes.",
  },
  textColor: {
    kind: "label",
    help: "Child-box property: sets the parent box's text color, inherited by all descendants " +
      "until one sets its own textColor. Value: color words in the box's text (e.g. \"dark green\"), " +
      "or an \"oklch\" child box carrying L, C, H number boxes.",
  },
  oklch: {
    kind: "label",
    help: "Color value: as a child of a backgroundColor/textColor box, carries L (0–1), C (0+), and " +
      "H (0–360°) number boxes specifying a color directly in the OKLCH perceptual color space.",
  },

  // --- Index labels (help generated below) ---
  builtins: { kind: "label", help: "" },
  builtinLabels: { kind: "label", help: "" },
  builtinCommands: { kind: "label", help: "" },
};

function builtinNamesOfKind(kind: BuiltinKind): string[] {
  return Object.keys(BUILTINS).filter(n => BUILTINS[n].kind === kind).sort();
}

BUILTINS.builtins.help =
  `All built-ins, commands and labels alike: ${Object.keys(BUILTINS).sort().join(", ")}.`;
BUILTINS.builtinLabels.help =
  `Built-in labels: ${builtinNamesOfKind("label").join(", ")}.`;
BUILTINS.builtinCommands.help =
  `Built-in commands: ${builtinNamesOfKind("command").join(", ")}.`;

export function isBuiltinCommand(word: string): boolean {
  return BUILTINS[word]?.kind === "command";
}

// Help text for a builtin name, or undefined if the name is not a builtin.
export function getBuiltinHelp(name: string): string | undefined {
  return BUILTINS[name]?.help;
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
    BUILTINS[token]?.run?.(ctx);
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
