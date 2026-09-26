# CLAUDE.md

This file gives Claude Code guidance for working in this repository.

## Git and GitHub

- Claude Code has **no permission** to commit, push, merge, open pull requests, or run any other git or GitHub command that writes, unless the user explicitly grants it.
- The user always commits, pushes, and opens the pull request that merges each branch into `main`.
- Claude Code may run commands that only read or sync, such as `git status`, `git diff`, `git log`, `git fetch`, and `git pull`.
- When the current work is ready to commit, offer a suggested commit title and description.
- **Never** add Claude Code signatures or attribution to any commit or PR message. That means no "Generated with Claude Code" line and no `Co-Authored-By: Claude` trailer.

## Task Workflow

Every task goes through three stages, in order.

### Stage 1: Research, Planning, and Design

- Review the relevant code and plan how the task will be implemented.
- Describe the possible design and architecture choices to the user and explain the trade-offs of each.
- **Do not pick design choices without the user.** The user makes those decisions.
- Move on to Stage 2 **only after the user gives explicit permission**.

### Stage 2: Implementation

- Implement the approved plan.

### Stage 3: Review

- Build the project and run the tests as normal.
- Read back over the code written in Stage 2 to find:
  - gaps in logic missed on the first pass
  - bugs that the changes may have introduced
