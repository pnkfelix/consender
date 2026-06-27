# Coupled pairs, dialogues, and the conversation as a second evaluator

Status: **design notes / not yet implemented.** Captured from a design
conversation on 2026-06-27. Companion to `programmability-model.md` and
`activation-records.md`.

## Two pressures that look like they need new structure

Two extensions felt like they didn't have a natural home in the box model:

1. **Key/value entries in a table** — and the specific cases that motivated it:
   variable binding (currently handled via lexical scope = box nesting),
   declaring the parameters of a script, and indicating a parameter's default
   value.

2. **Dialogue with an LLM** — the existing "a box holds a stream of text"
   primitive doesn't obviously model a back-and-forth conversation.

The worry both raised: are boxes doomed to grow a **second area** (two payloads
per box), reinventing a generalized `car`/`cdr`?

The conclusion of this conversation: **no.** Both reduce to a structure the
model already has, and the `car`/`cdr` you'd be "reinventing" already exists —
it is `NamedChild`, and that is exactly the right amount of generalization, not
a warning sign.

## The cons cell already exists: `NamedChild`

```ts
export interface NamedChild {
  title: string;   // car  — a name/symbol: the "key", the "role"
  box: Box;        // cdr  — structure: the "value", the "content"
}
```

A `RegularBox` is `children: NamedChild[]` plus a scalar `text`. So **an ordered
list of named children is already an association list**, and an assoc list is
simultaneously all of these, differing only in how it is read or rendered:

- a **table** (key → value),
- a **record** (named fields),
- a **scope / environment** (name → bound box) — what the lexical model already
  relies on,
- a **parameter list** (name → default),
- a **dialogue** (role → content), because the array is *ordered*.

These are **views over one structure**, not five structures — the founding
design goal ("tabular box rendered as a chart") applied again. "Ordered
named-children rendered as a chat transcript" is the same move.

## Why this does not require a second area

The pull toward two payloads comes from entries that need to carry more than a
single value: a dialogue turn wants role *and* content *and* a timestamp *and*
tool calls; a binding wants key *and* value *and* type *and* doc.

It is absorbed by recursion, because **the value slot is itself a full box.**
When an entry needs to be a record, nest:

```
turn  (title = "assistant")          ← named child
  ├── text            "Here's the…"  ← the box's own scalar text
  ├── tool_calls/     [...]          ← structured child
  └── usage           {tokens: …}    ← structured child
```

No second area. The day you reach for a second payload is the day you are
flattening a record *into* the box instead of nesting it as a child. Treat the
urge as a smell with two cures:

1. **make the value a structured box**, or
2. **use a `PointerBox` edge** — the "directed, non-hierarchical, same-level"
   edge, which already exists (`pointerToId` / `pointerPath`).

## Key/value, parameters, and defaults

These fall out of the existing two docs without new machinery:

- **Parameters** = named children of the script. Add a `params/` container as
  the **lexical twin of `activations/`** from `activation-records.md`. Each
  parameter is a box.
- **Default value** = the parameter box's **resting `produce` value** — what it
  yields before it has received anything. This is just the receive/produce
  model: default = produce-at-rest; a supplied argument = a `receive` that
  overrides.
- **Default vs. supplied** maps onto the static/dynamic split already designed:
  the **default lives lexically in the script box S** (`params/`), the
  **supplied argument lives in the activation A** (`activations/…`). Same
  static-link / dynamic-link table as the activation-records doc, now also
  answering "where does a default live vs. an argument."
- **A binding to a box elsewhere** (`x = that box over there`) =
  `NamedChild{ title: "x", box: PointerBox→target }`. Variable-binding-as-edge
  is a named child whose value is a pointer.

| Traditional | Box model |
|-------------|-----------|
| Parameter declaration | a box in `params/` |
| Default value | that box's produce-at-rest content |
| Supplied argument | a received value held in the activation |
| Binding to existing value | named child whose value is a `PointerBox` |

## Dialogue is the ordered assoc list (plus a DAG when it branches)

Structurally: a **conversation box whose children are message boxes, in
order.** Three points keep this honest:

1. **The message box *is* the existing stream-of-text box.** The "stream of
   text" primitive wasn't wrong for dialogue, it was being applied one level too
   high. A single *message* is a stream of text (a streaming assistant response
   is literally that text growing). The conversation is the **ordered container
   over** existing text boxes — it wraps the primitive, it does not replace it.

2. **Role is intrinsic, so it should not be the edge label.** A scope and a
   dialogue are both ordered named-children, but they run opposite disciplines
   on the title:

   - In a **scope/table**, the title is a *lookup key*: unique,
     position-insignificant, resolved *by name*.
   - In a **dialogue**, "user"/"assistant" repeat constantly, nothing is looked
     up by role, and **position carries the meaning**. The title there is a
     non-unique tag, not a key.

   "This is a user message" is true wherever the message sits — the intrinsic
   case (see *extrinsic vs. intrinsic keying* below). So role belongs **inside
   the message box** (its kind, or a `role` field), leaving `title` free to be
   ordinal / empty / a stable id.

3. **Branching is a DAG over turns via `PointerBox`.** Regeneration,
   "this turn answers turn 3", tree-of-thought: a turn points at the turn it
   replies to. Linear chat is the degenerate tree, the same way single-focus is
   N=1 in the SIMD section of `programmability-model.md`.

## The conversation as a receive/produce box

Model the conversation with the box protocol so the model call is not bespoke:

- `receive(user message)` → append a user turn and trigger a completion.
- `produce()` → yield the latest assistant turn.

Now "talking to the LLM" is one box's receive policy — same protocol as a
stack-box or cell-box. The assistant's reply arrives as a new child whose text
streams in.

The conversation box's own `text` is then spare capacity. Its intended tenant
here is the **human compose vessel** — the live edge where the human types the
next turn before sending. (The system prompt is the other candidate; see open
questions.)

## The LLM as a situated actor (the second evaluator)

Once the LLM is given context about where it is and actions it can take, the
conversation stops being a data structure and becomes a **second evaluator
plugged into the same socket as the word-based VM.** The LLM is an *actor* in
the precise sense of `programmability-model.md`.

**"Context about where it is" = the lexical neighborhood, serialized.** The
conversation box has a tree position; its parent chain is its scope, its
siblings and children its surroundings — the same environment a concatenative
script box sees. Telling the LLM "where it is" is **producing a text rendering
of its lexical neighborhood.** Two consequences:

- Don't hardcode what it sees. Per "multiplicity is data / keep it out of the
  evaluator," the context fed to the model should be a **producer/source box**
  the conversation points at — a context-builder. Repoint the source to show
  more or less of the tree.
- This unifies the LLM's situational awareness with lexical scope: the context
  window is a *view* over the box neighborhood.

**"Actions it can take" = the `Op` vocabulary.** `model.ts` already enumerates
the actions (`AddBox`, `SetBoxText`, `RenameBox`, `WrapInParent`, …). The LLM's
tool calls *are* consender Ops — "create a command script" = `AddBox` +
`SetBoxText` yielding a script box. Routing the model through the Op/box layer
(rather than a bespoke tool API) buys two things for free:

- **Legibility.** An LLM is the most opaque, non-deterministic receive policy
  imaginable — the sharpest form of the fexpr danger the programmability doc
  keeps flagging. The mitigation is that its effects land as **inspectable
  boxes**, not hidden mutations.
- **Undo.** Per-box undo stacks already exist; an Op-emitting LLM is undoable by
  construction.

**Autonomy ("maybe run scripts on its own") = where the conversation's `sink`
points.** This need not be decided up front; the model already makes it a slot:

- sink → a **discard/inert box**: produced scripts pile up as *data*
  (proposals), inert until a human invokes them;
- sink → an **eval-box**: produced scripts auto-run.

"Inert by default, eval-box when you opt in" is a dial you repoint per
conversation — the "sink is a box" reasoning. Autonomy is a value in a slot, not
a fork in the design.

**Actor vs. focus earns its keep.** The LLM lives *in* the conversation box
(its `actor` — where its actions originate) but acts on whatever box is pointed
at: "add a default to *that* parameter," "summarize *this* box" (`focus`,
elsewhere). This is exactly the toolbar-button case the programmability doc uses
to argue actor and focus must stay two registers — and the LLM agent is the
sharpest instance of "a command defined *here* that acts on whatever is
focused."

**Unifying claim:** an LLM turn is just another evaluator, and the conversation
is its activation context. It slots into the same actor / focus / sink /
`activations/` substrate as the concatenative VM. The word-VM and the LLM are
two interpreters in one socket; they differ only in that one is driven by
concatenative words and the other by a language model.

## The genuinely new part: persistent activations

A long-running, possibly-autonomous LLM is a **live activation with its own
rate of change.** `activation-records.md` assumed activations are short-lived
call frames created on invocation and removed on return. An agent that sits in
the tree proposing and running things is closer to a **persistent activation / a
daemon** than a stack frame.

This reopens the activation-lifecycle open question from that doc ("discard
immediately vs. retain briefly vs. keep permanently"). The persistent-actor case
is the one to think hardest about before building.

## Box-kind vocabulary this implies

Nothing structural is added; the missing piece is **vocabulary in the box-kind
taxonomy** that `programmability-model.md` already names as the right home (a
small fixed set of kinds with receive/produce policies + views):

- `entry` / `cell-box` — a (key, value) named child; cell-like receive (replace)
  / produce (yield).
- `assoc` / `table-box` — ordered entries; views: two-column grid, form,
  scope-bindings.
- `dialogue-box` — ordered turns; receive policy = "append a turn (and maybe
  complete)"; views: chat transcript, turn tree, raw.

These are **policies + views**, not new fields on the box. The structure stays
`NamedChild[]`.

## The one real new decision: extrinsic vs. intrinsic keying

The genuinely new choice is not "one area or two" — it is **where the key
lives:**

- **Extrinsic** — the key is the *edge label* (`NamedChild.title`); the
  **container** owns the association. Best for scopes, records, schema-defined
  tables. (What the model does today.)
- **Intrinsic** — the key is a *field inside the child*; the **entry** carries
  its own key. Best when entries are first-class movable things: a dialogue turn
  that stays a "user" turn wherever it is dragged; a K/V row dragged between
  tables without losing its key.

Recommendation: keep **extrinsic as the default** (it is what makes "named
children = scope" work for free). Add **intrinsic only** for entries that must
carry their key across containers, and model it as a `key`/`role` child, not a
new box field.

## Open questions

- The conversation box's own `text`: human compose vessel (this doc's lean) vs.
  system prompt. If both are wanted, which is the box's text and which is a
  child?
- Persistent-activation lifecycle for a long-running/autonomous LLM actor —
  the reopened activation-records question.
- The context-builder source: how much of the lexical neighborhood the model
  sees by default, and how the neighborhood is serialized to text.
- The default sink for a conversation (inert proposals vs. eval-box) and the
  concrete form of opting into autonomy.
- Where role lives precisely: a box kind, a reserved `role` child, or an
  intrinsic field.
- Granularity of LLM tool-calls vs. Op batching and undo: does one model turn
  map to one `BatchOp` (one undo step), or to many?
