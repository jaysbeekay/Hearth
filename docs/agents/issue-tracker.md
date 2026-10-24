# Issue tracker: GitHub

Issues and specs for Hearth live in this repository's GitHub Issues, `jaysbeekay/Hearth`. Use the `gh` CLI with `-R jaysbeekay/Hearth` for all operations, so commands work the same from any working directory.

Follow the issue classifications and body structures in `CLAUDE.md`. Raw feedback must be classified as `type:bug` or `type:enhancement`. Do not add issues to the project board manually; repository workflows handle that.

## Conventions

- **Create an issue**: `gh issue create -R jaysbeekay/Hearth --title "..." --label "type:bug" --body "..."`, substituting `type:enhancement` where appropriate.
- **Read an issue**: `gh issue view -R jaysbeekay/Hearth <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list -R jaysbeekay/Hearth --state open --json number,title,body,labels,comments`.
- **Comment**: `gh issue comment -R jaysbeekay/Hearth <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit -R jaysbeekay/Hearth <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close -R jaysbeekay/Hearth <number> --comment "..."`.
- **Sub-issues**: use `gh issue create --parent <parent>` or `gh issue edit <parent> --add-sub-issue <child>` when supported. Otherwise, put `Part of #<parent>` at the top of the child body.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve an ambiguous `#42` with `gh pr view -R jaysbeekay/Hearth 42`, then fall back to `gh issue view`.

## When a skill says "publish to the issue tracker"

Create an issue in `jaysbeekay/Hearth`, following `CLAUDE.md`.

## When a skill says "fetch the relevant ticket"

Read the issue from `jaysbeekay/Hearth`, including its labels and comments.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets. All commands target `jaysbeekay/Hearth`.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create -R jaysbeekay/Hearth --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue: `gh issue create -R jaysbeekay/Hearth --parent <map> ...`, or `gh issue edit -R jaysbeekay/Hearth <map> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/jaysbeekay/Hearth/issues/<map>/sub_issues -F sub_issue_id=<child-db-id>`. Where sub-issues aren't available, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/jaysbeekay/Hearth/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/jaysbeekay/Hearth/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list -R jaysbeekay/Hearth --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit -R jaysbeekay/Hearth <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment -R jaysbeekay/Hearth <n> --body "<answer>"`, then `gh issue close -R jaysbeekay/Hearth <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
