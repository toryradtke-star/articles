# articles

Terminal tool that writes articles for Workout 24/7 and Omnia, grounded in each
site's live Sanity content, graded by a second Claude pass, saved as editable
markdown, and published to Sanity when you say so. Run `art help`.

```
art ideas w247                    # topic suggestions the site doesn't cover yet
art write w247 "keycard gym etiquette"
# read/edit drafts/w247/<slug>.md
art check w247 keycard            # re-grade after edits (slug prefix is fine)
art publish w247 keycard          # Studio draft, to add a photo
art publish w247 keycard --live   # on the site in seconds (webhook revalidates)
```

Omnia: `art claims omnia <slug>` prints the clinical sentences to send to Blake;
publishing live needs `--signed-off-by "Name, DPT"`.

Keys live in `.env`: ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID,
SANITY_WRITE_TOKEN_W247, SANITY_WRITE_TOKEN_OMNIA. Add a site in `src/sites.ts`.
`art` is symlinked into ~/bin.
