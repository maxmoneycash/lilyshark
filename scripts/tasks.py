#!/usr/bin/env python3
"""Task board tooling for tasks/.

Each task is a markdown file with YAML frontmatter under tasks/<area>/.
This tool validates the board, renders it, picks ready work, and — the
part that matters — evaluates whether a task's work actually landed, by
running the task's own `eval.auto` commands from the repository root.

Commands:
  validate            schema-check every task file (CI gate)
  board               render the whole board grouped by area
  show <id>           print one task in full
  next [--area X]     ready tasks (all dependencies done), highest value first
  eval <id>           run one task's auto checks
  eval --all          run every task's auto checks; a done task that fails
                      is a regression, a todo task that passes is flagged
                      as "flip to done?"

Exit codes: 0 clean, 1 validation error or eval failure/regression.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
TASKS_DIR = REPO / "tasks"

AREAS = ("ui", "firmware", "protocol", "contracts", "growth", "paper")
SIZES = ("S", "M", "L")
PRIORITIES = ("P0", "P1", "P2")
STATUSES = ("todo", "doing", "done", "blocked")


@dataclass
class Task:
    id: str
    title: str
    area: str
    size: str
    priority: str
    status: str
    path: Path
    depends_on: list[str] = field(default_factory=list)
    auto: list[str] = field(default_factory=list)
    rubric: list[str] = field(default_factory=list)
    body: str = ""


def parse_task(path: Path) -> tuple[Task | None, list[str]]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None, [f"{path}: missing YAML frontmatter"]
    try:
        _, front, body = text.split("---\n", 2)
        meta = yaml.safe_load(front)
    except (ValueError, yaml.YAMLError) as exc:
        return None, [f"{path}: unparseable frontmatter: {exc}"]
    if not isinstance(meta, dict):
        return None, [f"{path}: frontmatter is not a mapping"]

    for key in ("id", "title", "area", "size", "priority", "status"):
        if key not in meta:
            errors.append(f"{path}: missing `{key}`")
    if errors:
        return None, errors

    ev = meta.get("eval") or {}
    task = Task(
        id=str(meta["id"]),
        title=str(meta["title"]),
        area=str(meta["area"]),
        size=str(meta["size"]),
        priority=str(meta["priority"]),
        status=str(meta["status"]),
        path=path,
        depends_on=[str(d) for d in (meta.get("depends_on") or [])],
        auto=[str(c) for c in (ev.get("auto") or [])],
        rubric=[str(r) for r in (ev.get("rubric") or [])],
        body=body.strip(),
    )
    if task.area not in AREAS:
        errors.append(f"{task.id}: area `{task.area}` not in {AREAS}")
    if task.size not in SIZES:
        errors.append(f"{task.id}: size `{task.size}` not in {SIZES}")
    if task.priority not in PRIORITIES:
        errors.append(f"{task.id}: priority `{task.priority}` not in {PRIORITIES}")
    if task.status not in STATUSES:
        errors.append(f"{task.id}: status `{task.status}` not in {STATUSES}")
    if not task.rubric:
        errors.append(f"{task.id}: eval.rubric is empty — every task needs review criteria")
    expected_dir = TASKS_DIR / task.area
    if path.parent != expected_dir:
        errors.append(f"{task.id}: lives in {path.parent.name}/ but area is `{task.area}`")
    return task, errors


def load_board() -> tuple[list[Task], list[str]]:
    tasks: list[Task] = []
    errors: list[str] = []
    for path in sorted(TASKS_DIR.glob("*/*.md")):
        task, errs = parse_task(path)
        errors.extend(errs)
        if task:
            tasks.append(task)
    seen: dict[str, Path] = {}
    for t in tasks:
        if t.id in seen:
            errors.append(f"duplicate id {t.id}: {seen[t.id]} and {t.path}")
        seen[t.id] = t.path
    ids = {t.id for t in tasks}
    for t in tasks:
        for dep in t.depends_on:
            if dep not in ids:
                errors.append(f"{t.id}: depends_on unknown task `{dep}`")
    # Cycle check: repeatedly peel tasks whose deps are all peeled.
    remaining = {t.id: set(t.depends_on) & ids for t in tasks}
    while remaining:
        free = [tid for tid, deps in remaining.items() if not deps]
        if not free:
            errors.append(f"dependency cycle among: {', '.join(sorted(remaining))}")
            break
        for tid in free:
            del remaining[tid]
        for deps in remaining.values():
            deps.difference_update(free)
    return tasks, errors


def run_auto(task: Task) -> tuple[bool, list[tuple[str, bool, str]]]:
    """Run a task's auto checks from the repo root. Returns (all_ok, results)."""
    results = []
    ok = True
    for cmd in task.auto:
        proc = subprocess.run(
            cmd, shell=True, cwd=REPO, capture_output=True, text=True, timeout=600
        )
        passed = proc.returncode == 0
        ok &= passed
        tail = (proc.stdout + proc.stderr).strip().splitlines()
        results.append((cmd, passed, tail[-1] if tail else ""))
    return ok, results


def fmt_row(t: Task) -> str:
    deps = f"  ← {','.join(t.depends_on)}" if t.depends_on else ""
    return f"  {t.id:<8} {t.priority} {t.size} [{t.status:^7}] {t.title}{deps}"


def cmd_board(tasks: list[Task]) -> None:
    for area in AREAS:
        area_tasks = [t for t in tasks if t.area == area]
        if not area_tasks:
            continue
        done = sum(1 for t in area_tasks if t.status == "done")
        print(f"\n{area.upper()}  ({done}/{len(area_tasks)} done)")
        for t in sorted(area_tasks, key=lambda t: (t.priority, t.id)):
            print(fmt_row(t))
    total_done = sum(1 for t in tasks if t.status == "done")
    print(f"\n{len(tasks)} tasks, {total_done} done")


def cmd_next(tasks: list[Task], area: str | None) -> None:
    done = {t.id for t in tasks if t.status == "done"}
    ready = [
        t for t in tasks
        if t.status == "todo"
        and all(d in done for d in t.depends_on)
        and (area is None or t.area == area)
    ]
    for t in sorted(ready, key=lambda t: (t.priority, SIZES.index(t.size), t.id)):
        print(fmt_row(t))
    if not ready:
        print("nothing ready — check `blocked` and `doing` tasks")


def cmd_show(tasks: list[Task], task_id: str) -> int:
    for t in tasks:
        if t.id == task_id:
            print(f"{t.id} — {t.title}")
            print(f"{t.area} · {t.size} · {t.priority} · {t.status} · {t.path.relative_to(REPO)}")
            if t.depends_on:
                print(f"depends on: {', '.join(t.depends_on)}")
            print(f"\n{t.body}\n")
            if t.auto:
                print("auto checks:")
                for c in t.auto:
                    print(f"  $ {c}")
            print("review rubric:")
            for r in t.rubric:
                print(f"  - {r}")
            return 0
    print(f"no task {task_id}", file=sys.stderr)
    return 1


def cmd_eval(tasks: list[Task], task_id: str | None, run_all: bool) -> int:
    targets = tasks if run_all else [t for t in tasks if t.id == task_id]
    if not targets:
        print(f"no task {task_id}", file=sys.stderr)
        return 1
    failures = 0
    for t in targets:
        if not t.auto:
            if not run_all:
                print(f"{t.id}: no auto checks — review manually against the rubric")
            continue
        ok, results = run_auto(t)
        if run_all:
            if t.status == "done" and not ok:
                print(f"REGRESSION {t.id} ({t.title}) — done but checks fail:")
            elif t.status == "todo" and ok:
                print(f"flip to done? {t.id} ({t.title}) — all auto checks pass")
                continue
            elif ok:
                continue
            else:  # todo/doing and failing: expected, stay quiet in --all
                continue
        for cmd, passed, tail in results:
            mark = "ok " if passed else "FAIL"
            print(f"  {mark} $ {cmd}")
            if not passed and tail:
                print(f"       {tail}")
        if t.status == "done" and not ok:
            failures += 1
        if not run_all:
            print(f"{t.id}: {'all auto checks pass' if ok else 'auto checks FAILING'}")
            if not ok:
                failures += 1
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    sub.add_parser("board")
    p_show = sub.add_parser("show")
    p_show.add_argument("id")
    p_next = sub.add_parser("next")
    p_next.add_argument("--area", choices=AREAS)
    p_eval = sub.add_parser("eval")
    p_eval.add_argument("id", nargs="?")
    p_eval.add_argument("--all", action="store_true")
    args = ap.parse_args()

    tasks, errors = load_board()
    if args.cmd == "validate":
        for e in errors:
            print(e, file=sys.stderr)
        print(f"{len(tasks)} tasks, {len(errors)} errors")
        return 1 if errors else 0
    if errors:
        print(f"warning: {len(errors)} validation errors — run `tasks.py validate`", file=sys.stderr)

    if args.cmd == "board":
        cmd_board(tasks)
        return 0
    if args.cmd == "next":
        cmd_next(tasks, args.area)
        return 0
    if args.cmd == "show":
        return cmd_show(tasks, args.id)
    if args.cmd == "eval":
        if not args.id and not getattr(args, "all", False):
            print("eval needs a task id or --all", file=sys.stderr)
            return 1
        return cmd_eval(tasks, args.id, args.all)
    return 0


if __name__ == "__main__":
    sys.exit(main())
