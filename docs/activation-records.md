# Activation records: why we need alias boxes, and where activations live

Status: **design notes / not yet implemented.** Captured from a design
conversation on 2026-06-13. Companion to `programmability-model.md`.

## The problem: invoking a script without copying it

When a script box S is invoked from some other context C, there are three
naive options, all bad:

1. **Evaluate in C.** The script runs in the caller's lexical environment, not
   its own. Free variables resolve wrong.

2. **Move S to C.** S's tree position changes, breaking its lexical scope.

3. **Copy S (and its entire ancestor chain) to C.** Would correctly bring the
   lexical environment along, but copying an entire ancestor chain is
   unrealistic.

The fundamental constraint: a script box's lexical scope is its position in the
box tree. Moving or copying it breaks that scope. We need a way to invoke S that
*leaves S where it is*.

## The resolution: activation records live inside the script box

Create an **activation box** A as a child of S (or of a container inside S).
Because A is nested inside S, it inherits S's full lexical parent chain
automatically — no copy, no move. The script's environment is simply there by
virtue of where A lives.

The activation box holds the local state for one invocation:

- the local stack / working register
- arguments received
- a **dynamic link** — a reference (port/alias) back to the calling context C

The dynamic link is the only piece that reaches outside S. Everything else is
local and lexically grounded.

This maps cleanly onto the traditional distinction:

| Traditional | Box model |
|-------------|-----------|
| Static link (lexical parent chain) | A's position inside S (structural, implicit) |
| Dynamic link (caller frame) | Port/reference from A back to C (explicit, a box value) |

The port/alias that matters here is not "an alias of the script visible from the
call site" — it is "a reference to the caller, held inside the activation." That
distinction matters: the alias is directionally inward-to-outward (activation →
caller), not outward-to-inward.

## The `activations/` container

Each script box S contains a permanent child box named `activations/`. When S
is called, a new activation box is created inside `activations/`; when the call
returns, the activation is removed (or archived).

```
script-box S
├── activations/          ← always present; empty at rest
│   ├── [A1]  (icon)      ← live call frame
│   └── [A2]  (icon)      ← second live frame (recursion or concurrent call)
└── (body, local definitions, sub-boxes…)
```

Keeping `activations/` permanent even when empty makes the location
discoverable: you always know where to look for a script's live frames.

### Activations as inspectable icon boxes

Each activation A starts as an icon inside `activations/`. Expanding it (icon →
window) shows its internal state: local stack, working register, arguments,
dynamic link. This is navigation, not a mode change — consistent with the
view-vs-structure principle.

Recursion is visually legible: N recursive calls produce N icons in
`activations/`. Depth is literally countable.

### `activations/` does not introduce a scope boundary

The container box is organizational, not a scope delimiter. Lexical lookup
passes through it transparently up to S and beyond. An activation sees S's
environment exactly as a non-activated sub-box of S would.

## Relation to the `actor` and `focus` registers

The dynamic link in each activation is the concrete anchor for the `actor`
register described in `programmability-model.md`. When S is invoked by a
gesture in context C:

- `actor` is bound to A's dynamic link (pointing at C) for the dynamic extent
  of the invocation.
- `focus` remains wherever the user's cursor is (independent of C).

The activation box is thus the reification of one row in the call stack, and
`actor` is just the `caller` field of the topmost activation — made ambient so
scripts do not have to thread it explicitly.

## Open questions

- Should the dynamic link be a named slot inside the activation box (like a
  field), or a child port box with a reserved name (like `caller/`)?
- Should finished activations be discarded immediately, retained briefly for
  post-mortem inspection, or kept permanently (call history)?
- Should `activations/` be hidden from normal navigation (a "system" box) or
  fully first-class and user-navigable?
- How does this interact with tail-call optimization? A tail call could reuse
  A rather than nesting a new frame — but that means A's dynamic link changes
  mid-execution, which is observable if A is inspectable.
