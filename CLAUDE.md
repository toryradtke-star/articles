# articles

Terminal article writer for Workout 24/7 (`w247`) and Omnia (`omnia`). The full
guide is the `articles` skill at `~/.claude/skills/articles/SKILL.md`. Load it
before doing article work.

- Run with `art <command>` (symlinked from `~/bin/art`); `art help` lists commands.
- Article files: `drafts/<site>/<slug>.md`. The file is the source of truth.
- `art publish ... --live` puts the article on a real business site. Only run
  it when Tory asks for that article. Omnia also needs Blake's sign-off
  (`--signed-off-by`).
- After code edits: `npm run typecheck`. Keys are in `.env` (never commit it).
