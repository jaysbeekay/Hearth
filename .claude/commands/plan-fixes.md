---
description: Review open kanban items and draft a prioritized fix plan
---
Run:

```
gh issue list --state open --label type:bug,type:enhancement -R jaysbeekay/jaysbeekay --json number,title,body,labels,url
```

Group related items, flag duplicates, and propose a priority order and rough
approach per item. Present the plan and wait for my go-ahead before writing
any code.

Note: this queries open issues directly rather than the board's Status field
— auto-add mirrors every open issue onto the board, so "open" ≈ "on the
board." If asked to respect specific columns (e.g. only plan `Ready`, skip
`Someday`), read the Status field via `gh project item-list <num> --owner
jaysbeekay --format json` instead — inspect one item's output first to learn
the JSON shape before filtering on it.
