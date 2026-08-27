# ECC for Codex CLI

This repo has no root `AGENTS.md` — `CLAUDE.md` at the repo root is the
authoritative instructions file. This document is a repo-local ECC baseline
for the Codex CLI specifically.

## Repo Skill

- Repo-generated Codex skill: `.agents/skills/Hearth/SKILL.md`
- Claude-facing companion skill: `.claude/skills/Hearth/SKILL.md`
- Keep user-specific credentials and private MCPs in `~/.codex/config.toml`, not in this repo.

## MCP Baseline

Treat `.codex/config.toml` as the default ECC-safe baseline for work in this repository.
The generated baseline enables GitHub, Context7, Exa, Memory, Playwright, and Sequential Thinking.

## Multi-Agent Support

- Explorer: read-only evidence gathering
- Reviewer: correctness, security, and regression review
- Docs researcher: API and release-note verification

## Workflow Files

- No dedicated workflow command files were generated for this repo.

Use these workflow files as reusable task scaffolds when the detected repository workflows recur.