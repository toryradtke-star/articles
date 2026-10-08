# articles

A terminal tool that writes articles for two small-business sites I run: a
24-hour gym in two Minnesota towns, and a physical therapy clinic in Superior,
WI. Each article is written for two readers: a person searching for an answer,
and the AI assistants that answer the same question by quoting a page.

```
art ideas → art write → (edit the .md) → art check / revise → art publish --live
 ~10s        ~1 min      your editor       re-grade             live in ~10s
```

Live so far:
[What to Expect at a Keycard Gym With No Staff, Classes, or Trainers](https://workout247fitness.com/blog/what-to-expect-keycard-gym-no-staff)
and [Can Virtual Physical Therapy Actually Work?](https://omniatherapies.com/news/does-virtual-physical-therapy-work)

## The design decisions that matter

**Every fact comes from the site, at write time.** Before drafting, the tool
pulls the business's own content from its Sanity dataset: prices, joining
fees, addresses, phones, services, team bios and the FAQ. The prompt says these
are the only facts the article may state about the business. When a draft got
something wrong, the fix went into the source: the gym's FAQ said you could
sign up online, drafts repeated it, and the FAQ was what changed.

**A second pass grades every draft.** A separate request scores the article
0–10 on eight criteria: it answers the question up front, it's specific to the
business, every fact matches the site, nothing is invented, links go only to
real pages, it's quotable by an AI assistant, it's readable, and it's new. The
grader returns concrete fixes that quote the offending text. A draft under 8 is
revised once automatically. On the clinic article, the grader caught an
unsourced "research has found…" line and a service the clinic doesn't offer;
one revision took it from 8.8 to 9.5.

**Written to be quoted.** The answer comes in the first sentence, headings are
phrased the way people ask, each section opens with a sentence that stands on
its own, and facts name the business and town instead of saying "we". On the
gym site the FAQ also becomes FAQPage structured data.

**Clinical claims need a clinician.** On the clinic site, every sentence that
says what a treatment does, who it helps or what the risks are is copied into a
list. `art claims` prints it as a numbered message to send for review, and
`publish --live` refuses until a clinician's name is given.

**The markdown file is the source of truth.** It started as a hosted Next.js
admin with Postgres, a login and sign-off links. For two sites and one editor,
that was more to run than it was worth. Now each article is a markdown file
with YAML front matter. Edit it in any editor; `publish` converts it to Sanity
Portable Text, refuses a URL that another article already uses, and keeps any
photo that was added in Studio. A signed webhook then refreshes just the
affected pages.

## Commands

```bash
art ideas <site> [-n 10] [--focus "..."]     # topics the site doesn't cover yet
art write <site> "<topic>" [--notes "..."]   # write, grade, save (auto-revises once if < 8)
art list [site]                               # every article, its score and status
art check <site> <slug>                       # re-grade after hand edits
art revise <site> <slug> ["what to change"]  # rewrite with your notes (or the grader's)
art claims <site> <slug>                      # clinical sentences, ready to send for sign-off
art publish <site> <slug> [--live] [--signed-off-by "Name, DPT"]
```

A slug can be any unique prefix: `art check w247 what-to`.

## Code

| File | What it does |
|---|---|
| `src/sites.ts` | Per-site config: Sanity project, article type, writing rules, the GROQ query for facts, the pages articles may link to |
| `src/writer.ts` | Prompts, `write`, `score`, `suggestIdeas`. Structured output via Zod, adaptive thinking, `claude-opus-5-5` |
| `src/markdown.ts` | Front matter, FAQ split, markdown → Portable Text |
| `src/publish.ts` | Sanity write as a Studio draft or live, slug-clash check |
| `src/cli.ts` | The commands |

TypeScript on Node 22, run with tsx; no build step. Needs `ANTHROPIC_API_KEY`
and a Sanity write token per site (`SANITY_WRITE_TOKEN_<SITE>`) in `.env`.
Adding a site is one entry in `src/sites.ts`.
