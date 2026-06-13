# Programmability model: boxes as receivers and producers

Status: **design notes / not yet implemented.** Captured from a design
conversation on 2026-06-13. This is a sketch of an operational model, plus the
open decisions it implies. Nothing here is built yet.

## Goal

Add programmability to consender. Programs are textual, word-based scripts
(think Forth / concatenative), where:

- **subroutines are "just" scripts held in other boxes**, and
- **lexical scope comes from box nesting** (a box's parent chain is its
  environment).

The author comes from an expression-oriented (Scheme) mindset, which created
two friction points that this model resolves:

1. A sequence of statements is not obviously a tree of expressions.
2. How do you transfer values — input parameters and outputs — between scripts?

## Core idea: every box is a receiver and a producer

Each box has a local policy for two things:

- **receive** — what to do when a value is sent *to* it, and
- **produce** — what to do when a value is *asked of* it.

Receipt is dispatched on the *kind* of value, and the kinds are kept distinct:

- **string** — an inert noun (raw text / data),
- **box** — structure, possibly code (the receiver decides whether to run it),
- **symbol / name** — a verb (a selector / word to invoke).

Most boxes throw away what they receive. Some push a received value onto a
stack. Some replace their own held text with a received string. And so on,
symmetrically, for production requests.

### The unifying move: the data stack is just a box

The Forth data stack is **not** privileged machinery — it is a box whose
receive-policy is *push* and whose produce-policy is *pop*. This dissolves the
"global stack vs. boxes" dilemma: there is no choice to make, because the stack
is an instance of the box protocol. The whole model is built down from this.

### This solves the parameter/output problem directly

- **Input parameters** = what a box receives.
- **Outputs** = what a box produces on request.

A subroutine-box's "calling convention" is literally its receive policy plus its
produce policy. The default box kind can implement ordinary stack-passing (args
arrive on the local stack; the result is left for the next produce), which
recovers plain function calls. Exotic conventions remain possible per box.

### Statements vs. expressions is a false loss

A concatenative sequence already *is* an expression tree in a different basis:
`x g f` is `f(g(x))`, and the stack is the partial tree / the continuation. The
expression orientation is not abandoned — it is re-expressed point-free. What
*is* given up relative to Scheme is referential transparency: "replace my own
text" is imperative. The center of gravity is Smalltalk / Forth / Tcl, not
Scheme.

### What it is, precisely

Each box is an object with a two-method protocol (`receive`, `produce`)
dispatched on argument kind. Boxes-as-**ports/places**, with the stack demoted to
one box kind among several. Neighboring prior art worth studying:

- **Rebol** — blocks that are code or data, per-context interpretation
  ("dialecting"). Eerily close.
- **Io** — minimal prototype + message passing; how far you get with almost no
  protocol.
- **Kernel / vau-calculus (Shutt)** — operatives: the callee receives
  unevaluated operands and decides what to do. "Each box has its own receive
  policy" is the generalization of this.

### The one standing danger: legibility

Arbitrary, ad-hoc per-box receive policies reproduce the fexpr problem — reading
a script requires knowing the secret policy of every box it touches, and local
reasoning evaporates. Forth stays legible because the stack discipline is
*uniform*.

**Mitigation:** draw policies from a small fixed vocabulary of box kinds
(stack-box, cell-box, sink/blackhole-box, text-box, eval-box, …), with the
arbitrary-handler escape hatch as the rare exception, not the default.

## The per-window evaluation machine

A window doing evaluation has a small, regular set of slots, each a *place*
holding a *box reference* (mind the distinction: the slot is not the box; it
holds a reference to one):

- **source** — where `produce` pulls from.
- **sink** — where `send` pushes to.
- **working** — the register holding "what I'm currently working on"; the value
  `send` reads and `produce`/literals write. (Arguably a depth-1 stack, but kept
  a distinguished slot for clarity.)

So the machine is tiny: `produce → working`; `send → working into sink`.

### Sinks and sources: force non-null, but expect asymmetry

Seed every slot with an explicit identity box so they are always non-null. This
buys **uniform representation, not uniform semantics** — and that is correct:

- the natural **sink** identity is **discard** — total, silent, always defined
  (a monoid zero);
- the natural **source** identity is **underflow** — a *partial* operation that
  must signal emptiness, exactly like popping an empty Forth stack.

Forcing non-null just turns the underflow case into a real, inspectable box
instead of an implicit error path.

### Keep multiplicity out of the evaluator

Plurality of sinks/sources means different things — a set of sinks is fan-out
(tee/broadcast); a set of sources is choice (select/merge/priority) — and those
need different combinators. That is the signal they should **not** be a property
of the window. Keep `window.sink` and `window.source` as single slots; point
them at a **tee-box** or **select-box** when plurality is needed. Multiplicity
becomes data, not evaluator structure (same move as "the stack is a box").

## Scope, identity, and first-class boxes

Boxes are intended to be first-class values. Two questions that look like one:

- **identity / mobility** (pi-calculus globality): can you pass a name anywhere
  and have it still denote the same channel?
- **resolution of free identifiers** (lexical scope): where does a bareword
  inside a script point?

These are **orthogonal**. You can have globally-unique box identities (free
mobility, pi-style) *and* resolve a box's free variables lexically through its
tree position — **provided a first-class box value is a reference into the tree,
not a detached copy.** Under reference semantics you get closures for free: a
box's lexical parent chain *is* its environment, so it carries its scope by
carrying its identity. No funarg problem, because nothing was detached.

**Recommendation: first-class boxes are references-with-identity.** This keeps
Scheme-style lexical scope *and* pi-style mobility without choosing between them.
Only **copy** semantics reopens the scope question (a copy's free vars need
rebinding — lexical-at-copy vs. dynamic-at-paste), so avoid it for the default.

## Three resolution regimes — kept distinct

Free-variable resolution must carry exactly **one** meaning, or legibility dies
again. Barewords are **always lexical**. The other two regimes are not scopes;
they are **ambient registers**, reached through reserved, visible words
(`actor`, `focus`/`here`, `caller`), so the regime is readable off the page:

- **Lexical** — resolve via the box's tree position. The default for barewords.
- **Actor** — *where the action originated* (a dynamic register, rebound per
  invocation). Dynamic scope, opt-in.
- **Focus** — *where the cursor / selection is* (a separate ambient register).

**Actor and focus are genuinely distinct — keep them as two registers.** Proof:
a toolbar button's command lives lexically in the toolbar box (that is the
actor), but it operates on whatever document is focused (focus elsewhere).
Collapse them and you cannot express "this command, defined here, acts on
whatever is focused" — which is most commands.

When an action *originates* (click, keystroke, trigger), the gesture establishes
both registers for the dynamic extent of that action — the event pattern.

### Steal the structure from Emacs

Emacs already solved this three-axis problem:

| consender | Emacs |
|-----------|-------|
| lexical scope | `let`/`defun` lexical vars |
| **actor** | `current-buffer` (dynamic, rebindable via `with-current-buffer`) |
| **focus** | `point` (per-buffer cursor) + `save-excursion` |

So focus should be **ambient-but-capturable**: a current-focus register every
command implicitly sees, a `save-excursion`-style form to act "as if focused
elsewhere", and explicit snapshot (`let h = here`) as the escape hatch when a
command must carry a focus past its own extent.

## Referencing boxes (human UX)

Build the GUID capability, but make it the **fallback**, not the front door. Raw
GUIDs are miserable to read, store, and paste. Two better naming schemes already
fall out of the model:

1. **Lexical path** — typeable, readable; stable under content edits, breaks on
   move.
2. **Pick the focus** — the user points at the target and a command captures
   `here`. The direct-manipulation analog of "paste a reference": *pick*, don't
   *type an address*.

"Copy the GUID / paste it as a parameter" is just focus-capture at lower
fidelity — a **reference clipboard** register: `copy-ref` = `clipboard := here`,
`paste-ref` = `produce clipboard`. No new mechanism; another named slot holding a
box reference. The GUID is merely the **wire format** for when a reference must
leave the live tree (serialize, cross sessions, show a human); inside a session
the human should rarely see it (show a draggable chip/handle instead).

Failure modes differ, so pick per use case:

- **GUID** — survives moves, *dangles* on delete.
- **path** — survives delete-and-recreate-in-place, *breaks* on move.
- **focus-capture** — resolves at action time, sidesteps both (another reason to
  make pointing the primary gesture).

## Looking ahead: multibox focus (human-driven SIMD)

We want to *plan ahead* for multiple foci (data-parallel, human-driven editing),
but cheaply — one structural commitment, not a SIMD engine.

**The commitment: reify the per-lane activation context as a first-class value.**
Bundle `(source, sink, working, focus)` into an addressable *activation*, even
while there is only ever one. Then "multibox focus" is just "run N activations,
one per focus, over the same command list," and single-focus is the degenerate
N=1. The test: *can the singular case run as one lane of the plural machinery,
with no ambient globals smeared across the evaluator?* If the per-window state
is a reified context, vectorizing is "spawn a vector of them"; if it is mutable
singletons baked into the window, retrofitting SIMD is a teardown.

Design *for* these, but do not build them yet:

- **Edit ordering belongs in the receiving box, not the lanes.** When N foci edit
  one substrate, positions shift and order matters (reverse-positional is the
  standard fix). Make the box that receives a *batch* responsible for
  ordering/merging — the tee/merge-is-a-box-policy idea again. Single-cursor is a
  batch of one.
- **Slots are either shared or private.** Per-lane state (each cursor's focused
  box, its working register) vs. shared state (all lanes append to one log sink).
  Mark each slot shared/private; do not foreclose the distinction.
- **Divergence: degrade, do not mask.** When lanes need data-dependent different
  behavior, do not chase predication/masking. Because activations are
  first-class, a diverged lane is just a lane that took a different path: SIMD is
  an *affordance over N independent activations*, and when lockstep breaks you
  fall back to running them independently (MIMD). No separate engine.
- **Cross-lane gather/scatter/reduce** — the only genuinely *new* primitives
  multi-focus needs. Reserve the vocabulary; build nothing yet.

A UX observation that should *steer* the design: human-driven SIMD is legible
precisely because the lanes are visible (the human watches all the cursors at
once). Divergence would make that visually incomprehensible. So the UX itself
pushes toward "uniform ops, degrade to independent on divergence" — which is also
the cheap path. The two pressures agree.

### Focus is a first-class *selection value*, not a vector-with-anchor

Multi-cursor comes in two regimes, and an early "vector-with-anchor" framing
over-fit the first:

- **Extensional** — enumerated, human-curated (Sublime/VSCode cmd-D, alt-click);
  order is meaningful, *may* have an anchor (a primary cursor).
- **Intensional** — produced by a rule/regexp (Kakoune's selection model,
  `:g/re/`, structural select-all-siblings); no inherent primary, canonical
  order from the rule's traversal.

So focus is a **first-class selection value with provenance**, and **anchor is an
optional capability, not a guaranteed field.** Commands that need a primary
(relative motion, "scroll to the cursor") are valid only on anchored selections
and should declare that requirement; anchor-agnostic commands map over the set.

A rule-derived selection is **produced by a query-box** — a box whose
produce-policy scans a target and yields matching regions into the focus
register. "Select all `/foo/`" is just an actor producing a set of references.
The difference between the two regimes collapses to *who filled the focus
register* — a human enumerating, or a producer evaluating — and both leave the
same kind of value in the same slot. No new machinery.

Unification worth naming: **a rule-based focus set is a derived view over
content** — the same family as "tabular box rendered as a chart" (consender's
founding design goal). Selection-by-rule and chart-rendering are both derived
presentations of structure.

That forces one decision the rule-based case adds: **live vs. materialized.** A
live query-selection feeds back on itself the moment you edit — the lanes mutate
the very content that defines which lanes exist (the iterate-while-mutating
hazard). Default to **materialize-at-evaluation-time**: snapshot the focus set
before a batch edit; do not recompute per-edit. A *live/reactive* selection is
the advanced mode — and since it is literally the derived-view concept, it is not
foreign, just opt-in and fenced off from SIMD editing.

## Open decisions (not yet settled)

- The exact fixed vocabulary of box kinds (and where the escape hatch sits).
- The default calling convention for the ordinary subroutine-box.
- Concrete syntax for `actor` / `focus` / `here` / `caller` and the
  `save-excursion`-style rebinding form.
- The serialized form of a box reference (GUID wire format) and how dangling
  references are surfaced.
- Whether `working` is truly distinct from a depth-1 stack-box.
- The shared-vs-private slot marking mechanism for activations.
