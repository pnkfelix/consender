// A toy term-rewriting system (TRS) expressed entirely in consender boxes.
//
// The whole point of this module is to capture the *essence* of consender in a
// small, playable operational model:
//
//   - Terms are boxes.  A term's children form a *bag* (a multiset): order is
//     not significant.  Subterms are addressed by their label, never by their
//     position.  This is the "non-significance of order" property.
//
//   - The state is itself a box entity.  A box becomes a TRS by carrying a
//     child labelled `type` whose text is `trs` — exactly the structural-tag
//     convention already used for `render` and `script`.  No new model field.
//
//   - Multiple agents drive the rewriting.  Each agent is a child box of the
//     `agents` container holding four labelled text children:
//        command   — a concatenative word string (the program)
//        focus     — a path into the world term (the cursor box)
//        selection — a set of paths (the selection set)
//        control   — the control context: `pc=<n> status=<running|halted|fault>`
//
// A step reads that state out of the boxes, advances every running agent by one
// instruction, and writes the new state back — all as ordinary consender `Op`s,
// so the whole thing is undoable and persists for free.
//
// The engine never mutates the caller's live tree.  It works on a clone, emits
// the `Op`s it would apply, and hands them back; `runScript` batches and applies
// them to the real tree.

import {
  applyOp,
  deserializeFullTree,
  findBox,
  mkAddBox,
  mkRemoveBox,
  mkRenameBox,
  mkSetBoxText,
  serializeFullTree,
} from "./history.js";
import type { Box, Op, RegularBox } from "./model.js";
import { isPointer } from "./model.js";

// The structural marker that makes a box a TRS: a `type` child whose text is
// this string (matched case-insensitively, trimmed).
export const TRS_TYPE = "trs";

const DEMO_COMMAND =
  "root down tally mark loop if-no-child tick done down tick remove goto loop mark done halt";

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function idNum(id: string): number {
  const n = parseInt(id.replace(/^\D+/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

// Find a child of `parent` whose title matches `title`.  Because children are a
// bag, several may match; we pick deterministically by lowest id so navigation
// is order-independent but reproducible.
function findChild(parent: RegularBox, title: string): { box: RegularBox; title: string } | null {
  const t = norm(title);
  const matches = parent.children.filter(nc => !isPointer(nc.box) && norm(nc.title) === t);
  if (matches.length === 0) return null;
  matches.sort((a, b) => idNum(a.box.id) - idNum(b.box.id));
  const nc = matches[0];
  return { box: nc.box as RegularBox, title: nc.title };
}

// ---------------------------------------------------------------------------
// public predicate
// ---------------------------------------------------------------------------

export function isTrsBox(box: Box): boolean {
  if (isPointer(box)) return false;
  const typeChild = box.children.find(nc => norm(nc.title) === "type");
  if (!typeChild || isPointer(typeChild.box)) return false;
  return norm(typeChild.box.text) === TRS_TYPE;
}

// ---------------------------------------------------------------------------
// the engine: a working tree + the ops accumulated against it
// ---------------------------------------------------------------------------

interface Engine {
  root: Box;
  worldId: string;
  ops: Op[];
}

function newEngine(root: Box, worldId: string): Engine {
  // Clone via serialize/deserialize so we never disturb the caller's live tree.
  const clone = deserializeFullTree(serializeFullTree(root));
  return { root: clone, worldId, ops: [] };
}

function emit(eng: Engine, op: Op): void {
  eng.ops.push(op);
  const res = applyOp(eng.root, eng.worldId, op);
  eng.root = res.root;
  eng.worldId = res.worldId;
}

function addChild(eng: Engine, parent: RegularBox, title: string): RegularBox {
  const op = mkAddBox(parent, undefined, undefined, title);
  emit(eng, op);
  if (op.kind !== "AddBox") throw new Error("mkAddBox did not yield AddBox");
  const created = findBox(eng.root, op.subtree.rootId);
  if (!created || isPointer(created)) throw new Error("created box missing after AddBox");
  return created;
}

function ensureChild(eng: Engine, parent: RegularBox, title: string): RegularBox {
  return findChild(parent, title)?.box ?? addChild(eng, parent, title);
}

function setText(eng: Engine, box: RegularBox, text: string): void {
  if (box.text === text) return;
  emit(eng, mkSetBoxText(box, text));
}

function removeBox(eng: Engine, box: RegularBox): void {
  emit(eng, mkRemoveBox(box));
}

function renameBox(eng: Engine, box: RegularBox, title: string): void {
  emit(eng, mkRenameBox(box, title));
}

// ---------------------------------------------------------------------------
// paths into the world term (lists of labels; the bag is addressed by name)
// ---------------------------------------------------------------------------

function parsePath(text: string): string[] {
  return text.split(">").map(s => s.trim()).filter(Boolean);
}

function printPath(path: string[]): string {
  return path.join(" > ");
}

function resolvePath(world: RegularBox, path: string[]): RegularBox | null {
  let cur: RegularBox = world;
  for (const seg of path) {
    const next = findChild(cur, seg);
    if (!next) return null;
    cur = next.box;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// the agent program: words with a fixed number of immediate token arguments
// ---------------------------------------------------------------------------

const ARITY: Record<string, number> = {
  // navigation (focus moves over the bag, addressing children by label)
  root: 0,
  up: 0,
  down: 1, // down LABEL
  // rewrites (mutate the world term at the focus)
  add: 1, // add LABEL
  remove: 0,
  rename: 1, // rename LABEL
  "set-text": 1, // set-text TOKEN   ('_' decodes to a space)
  // selection set
  select: 0,
  "clear-sel": 0,
  "select-kids": 1, // select-kids LABEL  (rule-derived selection)
  "remove-sel": 0,
  // control flow
  mark: 1, // mark LABEL
  goto: 1, // goto LABEL
  "if-child": 2, // if-child LABEL DEST
  "if-no-child": 2, // if-no-child LABEL DEST
  halt: 0,
};

interface Inst {
  word: string;
  args: string[];
}

function parseCommand(text: string): Inst[] {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  const insts: Inst[] = [];
  let i = 0;
  while (i < toks.length) {
    const w = toks[i++];
    const n = ARITY[w];
    if (n === undefined) {
      insts.push({ word: "__unknown", args: [w] });
      continue;
    }
    const args = toks.slice(i, i + n);
    i += n;
    insts.push({ word: w, args });
  }
  return insts;
}

// label -> index of its `mark` instruction
function markTable(insts: Inst[]): Map<string, number> {
  const marks = new Map<string, number>();
  insts.forEach((inst, idx) => {
    if (inst.word === "mark" && inst.args[0]) marks.set(norm(inst.args[0]), idx);
  });
  return marks;
}

// ---------------------------------------------------------------------------
// per-agent runtime state, read from / written back to the agent's boxes
// ---------------------------------------------------------------------------

interface AgentRT {
  name: string;
  focusBox: RegularBox;
  selectionBox: RegularBox;
  controlBox: RegularBox;
  insts: Inst[];
  marks: Map<string, number>;
  pc: number;
  status: string; // "running" | "halted" | "fault"
  note: string;
  focusPath: string[];
  selection: string[];
}

function parseControl(text: string): { pc: number; status: string; note: string } {
  const pcM = /pc=(-?\d+)/.exec(text);
  const stM = /status=(\S+)/.exec(text);
  const noteM = /note=(\S+)/.exec(text);
  return {
    pc: pcM ? parseInt(pcM[1], 10) : 0,
    status: stM ? stM[1] : "running",
    note: noteM ? noteM[1] : "",
  };
}

function buildAgent(eng: Engine, agentBox: RegularBox, name: string): AgentRT {
  const commandBox = ensureChild(eng, agentBox, "command");
  const focusBox = ensureChild(eng, agentBox, "focus");
  const selectionBox = ensureChild(eng, agentBox, "selection");
  const controlBox = ensureChild(eng, agentBox, "control");
  const insts = parseCommand(commandBox.text);
  const ctrl = parseControl(controlBox.text);
  return {
    name,
    focusBox,
    selectionBox,
    controlBox,
    insts,
    marks: markTable(insts),
    pc: ctrl.pc,
    status: ctrl.status,
    note: ctrl.note,
    focusPath: parsePath(focusBox.text),
    selection: selectionBox.text.split("\n").map(s => s.trim()).filter(Boolean),
  };
}

function buildAgents(eng: Engine, agentsHost: RegularBox): AgentRT[] {
  const entries = agentsHost.children
    .filter(nc => !isPointer(nc.box))
    .map(nc => ({ name: nc.title, box: nc.box as RegularBox }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : idNum(a.box.id) - idNum(b.box.id)));
  return entries.map(e => buildAgent(eng, e.box, e.name));
}

function fault(rt: AgentRT, note: string): void {
  rt.status = "fault";
  rt.note = note;
}

function writeback(eng: Engine, rt: AgentRT): void {
  setText(eng, rt.focusBox, printPath(rt.focusPath));
  setText(eng, rt.selectionBox, rt.selection.join("\n"));
  const note = rt.note ? ` note=${rt.note}` : "";
  setText(eng, rt.controlBox, `pc=${rt.pc} status=${rt.status}${note}`);
}

// Advance one agent by exactly one instruction.
function stepAgent(eng: Engine, world: RegularBox, rt: AgentRT): void {
  if (rt.status !== "running") return;
  if (rt.pc < 0 || rt.pc >= rt.insts.length) {
    rt.status = "halted";
    writeback(eng, rt);
    return;
  }

  const inst = rt.insts[rt.pc];
  let nextPc = rt.pc + 1;
  const focus = resolvePath(world, rt.focusPath);

  // Words that need a resolvable focus box.
  const needsFocus = new Set([
    "down", "add", "remove", "rename", "set-text", "select-kids", "if-child", "if-no-child",
  ]);
  if (needsFocus.has(inst.word) && !focus) {
    fault(rt, "lost-focus");
    writeback(eng, rt);
    return;
  }

  switch (inst.word) {
    case "root":
      rt.focusPath = [];
      break;
    case "up":
      if (rt.focusPath.length > 0) rt.focusPath = rt.focusPath.slice(0, -1);
      break;
    case "down": {
      const c = findChild(focus!, inst.args[0]);
      if (!c) { fault(rt, "no-child-" + slug(inst.args[0])); break; }
      rt.focusPath = [...rt.focusPath, c.title];
      break;
    }
    case "add":
      addChild(eng, focus!, inst.args[0]);
      break;
    case "remove":
      if (rt.focusPath.length === 0) { fault(rt, "cannot-remove-root"); break; }
      removeBox(eng, focus!);
      rt.focusPath = rt.focusPath.slice(0, -1);
      break;
    case "rename":
      if (rt.focusPath.length === 0) { fault(rt, "cannot-rename-root"); break; }
      renameBox(eng, focus!, inst.args[0]);
      rt.focusPath = [...rt.focusPath.slice(0, -1), inst.args[0]];
      break;
    case "set-text":
      setText(eng, focus!, (inst.args[0] ?? "").replace(/_/g, " "));
      break;
    case "select": {
      const p = printPath(rt.focusPath);
      if (!rt.selection.includes(p)) rt.selection.push(p);
      break;
    }
    case "clear-sel":
      rt.selection = [];
      break;
    case "select-kids": {
      const lbl = norm(inst.args[0]);
      rt.selection = focus!.children
        .filter(nc => !isPointer(nc.box) && norm(nc.title) === lbl)
        .map(nc => printPath([...rt.focusPath, nc.title]));
      break;
    }
    case "remove-sel": {
      // Resolve every selected path to a live box, then remove.  Removing by
      // identity (not position) means the order of removal does not matter.
      const targets = rt.selection
        .map(p => resolvePath(world, parsePath(p)))
        .filter((b): b is RegularBox => b !== null && b !== world);
      // Deduplicate and remove deepest-first / highest-id-first for stability.
      const seen = new Set<string>();
      const unique = targets.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
      unique.sort((a, b) => idNum(b.id) - idNum(a.id));
      for (const b of unique) removeBox(eng, b);
      rt.selection = [];
      break;
    }
    case "mark":
      break; // a label marker is a runtime no-op
    case "goto": {
      const d = rt.marks.get(norm(inst.args[0]));
      if (d === undefined) { fault(rt, "no-mark-" + slug(inst.args[0])); break; }
      nextPc = d;
      break;
    }
    case "if-child": {
      const hit = findChild(focus!, inst.args[0]);
      if (hit) {
        const d = rt.marks.get(norm(inst.args[1]));
        if (d === undefined) { fault(rt, "no-mark-" + slug(inst.args[1])); break; }
        nextPc = d;
      }
      break;
    }
    case "if-no-child": {
      const hit = findChild(focus!, inst.args[0]);
      if (!hit) {
        const d = rt.marks.get(norm(inst.args[1]));
        if (d === undefined) { fault(rt, "no-mark-" + slug(inst.args[1])); break; }
        nextPc = d;
      }
      break;
    }
    case "halt":
      rt.status = "halted";
      break;
    case "__unknown":
      fault(rt, "unknown-word-" + slug(inst.args[0]));
      break;
    default:
      fault(rt, "unhandled-" + slug(inst.word));
      break;
  }

  if (rt.status === "running") rt.pc = nextPc;
  writeback(eng, rt);
}

// Advance every running agent by one instruction (a single global step).
// Agents are sequenced by name for determinism; later agents observe earlier
// agents' edits within the same step.
function oneStep(eng: Engine, trsBox: RegularBox): boolean {
  const world = findChild(trsBox, "world")?.box;
  const agentsHost = findChild(trsBox, "agents")?.box;
  if (!world || !agentsHost) return false;
  const agents = buildAgents(eng, agentsHost);
  const anyRunning = agents.some(rt => rt.status === "running");
  if (!anyRunning) return false;
  for (const rt of agents) stepAgent(eng, world, rt);
  return true;
}

// ---------------------------------------------------------------------------
// public entry points — each returns the ops to apply to the real tree
// ---------------------------------------------------------------------------

// Make `box` a TRS, seeding a runnable demo if its world/agents are absent.
// Idempotent: re-running on an existing TRS leaves its contents untouched.
export function makeTrsOps(box: RegularBox, root: Box, worldId: string): Op[] {
  const eng = newEngine(root, worldId);
  const target = findBox(eng.root, box.id);
  if (!target || isPointer(target)) return [];

  const typeBox = ensureChild(eng, target, "type");
  setText(eng, typeBox, TRS_TYPE);

  const worldExisted = findChild(target, "world") !== null;
  const world = ensureChild(eng, target, "world");
  if (!worldExisted) {
    const tally = addChild(eng, world, "tally");
    for (let i = 0; i < 4; i++) addChild(eng, tally, "tick");
  }

  const agentsExisted = findChild(target, "agents") !== null;
  const agentsHost = ensureChild(eng, target, "agents");
  if (!agentsExisted) {
    for (const name of ["eater-1", "eater-2"]) {
      const a = addChild(eng, agentsHost, name);
      setText(eng, ensureChild(eng, a, "command"), DEMO_COMMAND);
      setText(eng, ensureChild(eng, a, "focus"), "");
      setText(eng, ensureChild(eng, a, "selection"), "");
      setText(eng, ensureChild(eng, a, "control"), "pc=0 status=running");
    }
  }

  return eng.ops;
}

// One global evaluation step.
export function stepTrsOps(box: RegularBox, root: Box, worldId: string): Op[] {
  const eng = newEngine(root, worldId);
  const target = findBox(eng.root, box.id);
  if (!target || isPointer(target)) return [];
  oneStep(eng, target);
  return eng.ops;
}

// Run global steps until every agent is halted/faulted (or a step cap is hit).
export function runTrsOps(box: RegularBox, root: Box, worldId: string, maxSteps = 500): Op[] {
  const eng = newEngine(root, worldId);
  const target = findBox(eng.root, box.id);
  if (!target || isPointer(target)) return [];
  let steps = 0;
  while (steps < maxSteps) {
    if (!oneStep(eng, target)) break;
    steps++;
  }
  return eng.ops;
}
