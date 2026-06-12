# Claude Code guidance for consender

## Design goals

- A box should be able to have a rich **view** that is distinct from its **structure**. The canonical example: a box whose structure is tabular data but which renders as a chart. Switching between the chart view and the underlying table is navigation (a focus/cursor change), not mutation of the box's state. This keeps presentation out of the model.

## Pull requests

- Keep the PR description current. Any time you push one or more new commits to a branch that has an open PR, update the PR body to accurately reflect what the branch now does.
- PR descriptions should list concrete behavior changes, not just summarize commit messages.
