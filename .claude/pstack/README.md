# Vendored pstack

Project-local copy of the pstack Claude Code plugin, so cloud sessions (which cannot run `/plugin install`) can use it.

- Source: https://github.com/michael-denyer/pstack-claude
- Commit: `49b68501b075ec1eb2755dd0d22fbf2492d67e97` (pstack 0.9.94)
- License: MIT; see `LICENSE`, `LICENSE-cursor-team-kit`, `LICENSE-thermos`, `NOTICE.md`, `NOTICE-skills.md` in this directory.

## What was copied

| Upstream (`plugins/pstack/`) | Here |
|---|---|
| `skills/*` | `.claude/skills/*` |
| `agents/*.md`, `effort-agents/*.md` | `.claude/agents/*.md` |
| `hooks/session-start-context.md` | `.claude/hooks/pstack-session-start-context.md` |
| `hooks/session-start.sh` + `hooks/hooks.json` | `.claude/hooks/pstack-session-start.sh`, registered in `.claude/settings.json` |

Not copied: Codex, Copilot and Pi files, `assets/`, `models.json` (its values are already stamped into the skills).

## Local modifications

- Removed the `pstack:` namespace prefix from skill and agent references, since project skills and agents are not namespaced.
- `poteto-agent*.md`: read `.claude/skills/poteto-mode/SKILL.md` under the project root instead of searching `~/.claude/plugins/`.
- `pstack-session-start.sh`: Claude runtime only, paths resolved relative to the script instead of `CLAUDE_PLUGIN_ROOT`. The `session hook: off` opt-out in `~/.claude/pstack-models.md` still works.

## Updating

Re-copy from a newer upstream commit, reapply the modifications above, and update the commit hash here.
