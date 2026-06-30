# A toy term-rewriting system, as a box entity

Status: **implemented (toy / exploratory).** A first operational kernel for the
ideas sketched in `programmability-model.md`, `activation-records.md`, and
`coupled-pairs-and-dialogue.md`. Lives in `src/trs.ts`, wired into the script
runner in `src/script.ts`.

## What it is

A small term-rewriting system that captures the essence of consender:

- **nesting of boxes** — a term is a box; its children are its subterms;
- **non-significance of order** — a box's children are a *bag*. Subterms are
  addressed by **label**, never by position. Any matching child is fair game;
- **multiple agents**, each with a **control context**, a **command string**, a
  **selection set**, and a **(box) focus** — the four things the design notes
  keep returning to.

Crucially, the TRS *is itself a box entity*. You make a box a TRS the same way
you make a box a script box or set its render mode: by a **structural tag**, not
a new model field. A box is a TRS iff it has a child labelled `type` whose text
is `trs`. Consequently `model.ts` and `history.ts` are untouched — every step is
emitted as ordinary `Op`s, so the TRS is **undoable and persisted for free**.

## The state schema (all boxes)

```
<box>                         ← type child = "trs" makes this a TRS
├── type        "trs"
├── world                     ← the term being rewritten (root symbol = "world")
│   └── …nested labelled boxes…   (title = symbol, text = payload, children = subterms; a bag)
└── agents
    ├── eater-1
    │   ├── command   "root down tally mark loop if-no-child tick done …"
    │   ├── focus     "tally"            ← a path of labels (a > b > c); empty = world root
    │   ├── selection "tally > tick\n…"  ← newline-separated paths
    │   └── control   "pc=0 status=running"
    └── eater-2
        └── …
```

These are **views over one structure** (the founding design goal): `agents` is
an assoc list of activations; each agent box is an activation record; `command`,
`focus`, `selection`, `control` are just labelled text children you can read and
edit directly on the canvas.

## Driving it

Three script words, run from **another** box while the TRS box is focused
(`focus` register = the TRS; `actor` = the script you ran — the toolbar-button
split from `programmability-model.md`, in miniature):

- `make-trs` — tag the focused box as a TRS and, if it has no `world`/`agents`
  yet, seed a runnable demo (a `tally` of four `tick`s eaten by two agents).
- `trs-step` — advance every running agent by **one instruction** (one global
  step). Agents are sequenced by name for determinism; a later agent sees an
  earlier agent's edits within the same step.
- `trs-run` — repeat global steps until every agent is halted or faulted (capped
  at 500 steps).

## The agent vocabulary

A command is a concatenative word string. Each word takes a fixed number of
immediate token arguments. The control context is `pc` (program counter) +
`status` (`running` / `halted` / `fault`, with a `note=` slug on faults).

| Word | Args | Effect |
|------|------|--------|
| `root` | — | focus := world root |
| `up` | — | focus := parent |
| `down LABEL` | 1 | focus := a child labelled LABEL (lowest id; the bag is addressed by name) |
| `add LABEL` | 1 | add an empty child labelled LABEL to focus |
| `remove` | — | remove focus from its parent; focus := parent |
| `rename LABEL` | 1 | relabel focus |
| `set-text TOKEN` | 1 | set focus's text (`_` decodes to a space) |
| `select` | — | add focus's path to the selection set |
| `clear-sel` | — | empty the selection |
| `select-kids LABEL` | 1 | selection := all children of focus labelled LABEL (rule-derived) |
| `remove-sel` | — | remove every selected box (by identity, so order is irrelevant) |
| `mark LABEL` | 1 | a jump target (runtime no-op) |
| `goto LABEL` | 1 | jump to `mark LABEL` |
| `if-child LABEL DEST` | 2 | if focus has a child LABEL, jump to `mark DEST` |
| `if-no-child LABEL DEST` | 2 | if it does not, jump to `mark DEST` |
| `halt` | — | stop this agent |

The seeded demo program, per agent:

```
root  down tally  mark loop
  if-no-child tick done
  down tick  remove
  goto loop
mark done  halt
```

Two agents run this over the **same** `tally`. Because focus is a *re-resolved
path* (not a pinned id) and removal is by identity, they never collide on the
same tick — they just drain the bag between them and both halt. That is the
order-insignificance property doing real work.

## How it maps to the design notes

- **control context** = the activation record of `activation-records.md`. Here it
  is `pc`/`status` held in the `control` box; `agents/` is the `activations/`
  container, made first-class and user-navigable.
- **focus vs. actor** = `programmability-model.md`'s two registers. `trs-step`
  run from a toolbar-ish script box (actor) acts on the focused TRS box (focus).
- **selection as a first-class value with provenance** = the `selection` box.
  `select` is extensional (enumerated); `select-kids` is intensional
  (rule-derived) — the two regimes that doc distinguishes, both landing the same
  kind of value in the same slot.
- **evaluator emits Ops** = the prediction in `coupled-pairs-and-dialogue.md`
  that an evaluator's effects should land as inspectable, undoable boxes. The
  TRS stepper is exactly that, one step ahead of the LLM-as-evaluator case.

## Known limitations (deliberately, for now)

- **Scheduling is sequential within a step.** Agents are ordered by name; the
  term is order-insignificant but the *schedule* is not yet confluent. True
  parallel/independent-lane semantics (the "human-driven SIMD" section) is left
  for later — this is the N-activations substrate, not the vector engine.
- **No data stack / no real pattern matching.** Rewrites are imperative agent
  moves, not `l -> r` rules with AC-matching. Rules-as-boxes is the natural next
  step (a rule is a box; matching modulo the bag is the order-insignificant
  unification).
- **Paths break on relabel/move**, exactly as `programmability-model.md` notes
  for the lexical-path naming scheme. A focus-as-reference (id) register is the
  fix when it matters.
