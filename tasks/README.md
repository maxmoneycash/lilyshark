# Task board

The backlog lives here as files, one task per markdown file, grouped by
area. It is designed to be worked by humans and by agents: every task
carries its own acceptance criteria, and where completion is mechanically
checkable, its own eval commands. The board is data, so tooling — and CI —
can read it.

```
tasks/
  ui/         the web analyzer at lilyshark.com
  firmware/   the T-Deck device
  protocol/   Field Receipts: witness attestation and points
  contracts/  Move modules on shelbynet / Aptos
  growth/     gamification, distribution, revenue
  paper/      whitepaper alignment and research debt
```

## Working the board

```sh
python3 scripts/tasks.py board            # the whole board, grouped by area
python3 scripts/tasks.py next             # what is ready to pick up now
python3 scripts/tasks.py show UI-003      # one task in full
python3 scripts/tasks.py validate         # schema check (CI gate)
```

Pick a task from `next` (its dependencies are done), set `status: doing`
in its frontmatter, do the work, then evaluate it.

## Evaluating work

Every task has two layers of evaluation, and both matter:

- **`eval.auto`** — shell commands run from the repo root that must all
  exit 0. These prove the work *landed*: the file exists, the test passes,
  the format validates. `python3 scripts/tasks.py eval UI-003` runs them.
- **`eval.rubric`** — review criteria a human (or a reviewing agent) checks
  against the diff. These prove the work is *good*: honest states, spec
  followed, no regression in feel. Auto checks passing is necessary, never
  sufficient.

`python3 scripts/tasks.py eval --all` sweeps the whole board: a `done`
task whose auto checks now fail is reported as a **regression** (and fails
CI); a `todo` task whose auto checks already pass is flagged so the board
stays honest.

A task is `done` when its auto checks pass, a reviewer has walked the
rubric against the diff, and the change is merged to `main`.

## Writing a task

Frontmatter schema (enforced by `validate`):

```yaml
---
id: UI-042            # unique, AREA-NNN
title: One line, imperative
area: ui              # ui | firmware | protocol | contracts | growth | paper
size: M               # S (hours) | M (a day) | L (several days)
priority: P0          # P0 must-have · P1 should-have · P2 opportunistic
status: todo          # todo | doing | done | blocked
depends_on: [UI-001]  # ids that must be done first
eval:
  auto:
    - test -f webapp/src/lib/filter.ts
  rubric:
    - The filter grammar matches the spec in the task body.
---
```

Body sections: **Why** (the user problem, one paragraph), **What** (the
change, concrete), **Out of scope** (what this task deliberately skips).

Rules of the board:

- A task with no rubric fails validation. Auto checks are optional
  (hardware tasks can't have them); judgment criteria are not.
- Auto checks must be runnable on a clean checkout on the host — no
  hardware, no network, no secrets. Hardware validation is expressed as a
  rubric plus a written field-report requirement.
- Keep tasks small enough that one person or one agent session can land
  one. If a task needs a design first, the design is its own task.
