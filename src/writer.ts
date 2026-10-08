import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { FAQ_HEADING, wordCount } from './markdown.ts'
import type { SiteContext } from './sanity.ts'
import type { Site } from './sites.ts'

export const MODEL = 'claude-opus-5-5'

// Length limits are checked after parsing; output schemas support only a subset of JSON Schema.
const DraftSchema = z.object({
  title: z.string(),
  slug: z.string(),
  excerpt: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  intro: z.array(z.string()),
  sections: z.array(
    z.object({
      heading: z.string(),
      blocks: z.array(
        z.object({
          type: z.enum(['paragraph', 'subheading', 'bullet_list', 'numbered_list']),
          text: z.string(),
          items: z.array(z.string()),
        }),
      ),
    }),
  ),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  claims: z.array(z.string()),
})

const ScoreSchema = z.object({
  criteria: z.array(z.object({ name: z.string(), score: z.number(), note: z.string() })),
  issues: z.array(z.string()),
})

const IdeasSchema = z.object({
  ideas: z.array(z.object({ title: z.string(), search: z.string(), why: z.string() })),
})

const RUBRIC = [
  'Answers the main question in the first paragraph',
  'Specific to this business and its towns, not generic',
  'Every price, hour, service, person and policy matches the site facts',
  'No invented statistics, studies, quotes or amenities',
  'Links only to the allowed pages, and at least one call to action',
  'Easy for an AI assistant to quote: self-contained answers that name the business and place',
  'Plain, readable, follows the writing rules',
  'Covers something the existing articles do not',
]

export type Written = {
  title: string
  slug: string
  excerpt: string
  metaTitle: string
  metaDescription: string
  /** The article in markdown, FAQ included. */
  body: string
  claims: string[]
}

export type Usage = { inputTokens: number; outputTokens: number }

function systemPrompt(site: Site, ctx: SiteContext) {
  const clinical = site.requiresClinicalSignoff
    ? `\nThis is a healthcare business. Put every sentence that makes a clinical claim (what a treatment does, who it helps, how long recovery takes, risks) into "claims", copied word for word from the article. A licensed clinician reviews them before publishing. Keep such claims modest and hedged.`
    : `\nThis site needs no clinical review; return an empty "claims" list.`

  return `You write articles for ${site.name} (${site.domain}), a small local business. The articles are read by two audiences: people searching for an answer, and AI assistants (ChatGPT, Google AI Overviews, Perplexity, Claude) that quote and cite pages when answering those same questions. Both should come away trusting the business and knowing how to get in touch.

Writing rules for this site:
${site.brandRules.join('\n')}

Facts about the business (from its website). These are the only facts you may state about the business itself. If something isn't here, don't claim it:
${JSON.stringify(ctx.facts, null, 2)}

Pages you may link to, as markdown links like [text](/path). Do not link anywhere else on this site. Avoid external links, with one exception: when the article states a law, regulation or government rule, cite it with a link to the official government source (a state legislature, revisor or .gov page) right where the rule is described:
${ctx.routes.map((r) => `${r.path} - ${r.what}`).join('\n')}

Format:
- 900 to 1,500 words. "intro" is one or two short paragraphs that answer the question directly in the first sentence or two.
- 4 to 7 sections with plain, descriptive H2 headings, ideally phrased the way people ask. Open each section with a sentence that answers it on its own, so it still makes sense when quoted out of context. Name the business and town rather than saying "we" or "here" when stating facts about it.
- Use lists where they genuinely help. For a heading inside a section, add a block of type "subheading"; never type "#" characters into text.
- Link to 2 to 4 of the allowed pages inside the text, as [descriptive words](/path), including at least one clear call to action. Plain-text mentions of a page don't count as links.
- Inside text you may use [links](/path) and **bold**, nothing else.
- "slug" is lowercase-hyphenated, 3 to 8 words. "metaTitle" is under 60 characters, "metaDescription" under 155, "excerpt" one or two sentences under 230 characters.
- "faq" has 3 to 5 short questions people actually ask, with direct, complete answers.
- Write for a person deciding what to do, not for a search engine. No filler intros, no "in conclusion".${clinical}`
}

/**
 * Runs a structured request through the Claude Code CLI (`claude -p`), so it bills
 * to Tory's claude.ai subscription instead of an API key. Returns the parsed object plus usage.
 */
async function structured<T extends z.ZodType>(
  schema: T,
  params: { system: string; user: string; effort: 'medium' | 'high' },
): Promise<{ data: z.infer<T> } & Usage> {
  const args = [
    '-p',
    '--model', MODEL,
    '--effort', params.effort,
    '--system-prompt', params.system,
    '--json-schema', JSON.stringify(z.toJSONSchema(schema, { target: 'draft-07' })),
    '--output-format', 'json',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ]
  // An API key in the environment would take priority over the subscription login.
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_WORKSPACE_ID: _ws, ...env } = process.env
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: tmpdir(),
      env: { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => reject(new Error(`Could not run the claude CLI: ${e.message}`)))
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited with ${code}: ${(stderr || stdout).trim().slice(0, 500)}`))))
    child.stdin.end(params.user)
  })

  let result: any
  try {
    result = JSON.parse(out)
  } catch {
    throw new Error(`claude returned something that was not JSON: ${out.slice(0, 300)}`)
  }
  if (result.is_error) throw new Error(`Claude failed: ${result.result ?? result.subtype}`)
  const parsed = schema.safeParse(result.structured_output)
  if (!parsed.success) throw new Error('Claude returned something that did not match the expected shape.')

  const u = result.usage ?? {}
  return {
    data: parsed.data as z.infer<T>,
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  }
}

function toMarkdown(d: z.infer<typeof DraftSchema>) {
  const parts: string[] = d.intro.filter((p) => p.trim())
  for (const s of d.sections) {
    parts.push(`## ${s.heading.trim()}`)
    for (const b of s.blocks) {
      // A paragraph that starts with #'s is really a subheading.
      const h = b.type === 'paragraph' && b.text.match(/^\s*#{1,6}\s+(.*)$/)
      if (h || b.type === 'subheading') parts.push(`### ${(h ? h[1] : b.text).trim()}`)
      else if (b.type === 'paragraph' && b.text.trim()) parts.push(b.text.trim())
      else if (b.type === 'bullet_list') parts.push(b.items.filter((i) => i.trim()).map((i) => `- ${i.trim()}`).join('\n'))
      else if (b.type === 'numbered_list') parts.push(b.items.filter((i) => i.trim()).map((i, n) => `${n + 1}. ${i.trim()}`).join('\n'))
    }
  }
  if (d.faq.length) {
    parts.push(`## ${FAQ_HEADING}`)
    for (const qa of d.faq) parts.push(`### ${qa.question.trim()}\n${qa.answer.trim()}`)
  }
  return parts.join('\n\n')
}

/**
 * Writes an article for a request like "is it safe to work out alone at night".
 * Pass `revise` to rework an existing article instead of starting fresh.
 */
export async function write(
  site: Site,
  ctx: SiteContext,
  request: { topic: string; notes?: string },
  revise?: { previous: string; feedback: string[] },
): Promise<Written & Usage> {
  let user = `Write an article about: ${request.topic}
${request.notes ? `\nNotes from the owner: ${request.notes}\n` : ''}
Work out the main question people search for on this topic and answer it.

Existing articles (don't repeat them; link to one if it's genuinely relevant):
${ctx.existing.map((e) => `- ${e.title} (${e.path})`).join('\n') || '- none yet'}`

  if (revise) {
    user += `

Revise this earlier version rather than starting over. Keep what works; fix these points:
${revise.feedback.map((f) => `- ${f}`).join('\n')}

Earlier version:
${revise.previous}`
  }

  const r = await structured(DraftSchema, { system: systemPrompt(site, ctx), user, effort: 'high' })
  const d = r.data
  return {
    title: d.title.trim(),
    slug: d.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80),
    excerpt: d.excerpt.trim().slice(0, 240),
    metaTitle: d.metaTitle.trim(),
    metaDescription: d.metaDescription.trim(),
    body: toMarkdown(d),
    claims: site.requiresClinicalSignoff ? d.claims : [],
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }
}

/** Grades an article 0-10 against the rubric and lists concrete fixes. */
export async function score(site: Site, ctx: SiteContext, a: Omit<Written, 'excerpt'> & { excerpt: string }) {
  const user = `You are now reviewing an article written with the instructions above. Grade it strictly, 0 to 10, on each criterion:
${RUBRIC.map((r, i) => `${i + 1}. ${r}`).join('\n')}

For each criterion give the name, a score and a one-sentence note. Then list "issues": concrete fixes the writer should make, quoting the problem text where possible. Flag any link not in the allowed list and any fact not supported by the site facts. A link to an official government source (state statute, administrative code, .gov) that cites a law the article states is allowed and is a plus; flag any other external link. Empty list if nothing needs fixing.

The article is in markdown: "## " and "### " lines are real headings, and links are [text](href). The final "## ${FAQ_HEADING}" section is the "faq" field rendered for reading, not a duplicate of it.

Article (${wordCount(a.body)} words):
Title: ${a.title}
URL slug: ${a.slug}
Meta title: ${a.metaTitle}
Meta description: ${a.metaDescription}
Excerpt: ${a.excerpt}

${a.body}

Existing articles: ${ctx.existing.map((e) => e.title).join('; ') || 'none'}${
    site.requiresClinicalSignoff
      ? `\n\nClinical claims the writer flagged for clinician review (${a.claims.length}):\n${a.claims.map((c) => `- ${c}`).join('\n')}\nFlag any clinical sentence in the article that's missing from this list.`
      : ''
  }`

  const r = await structured(ScoreSchema, { system: systemPrompt(site, ctx), user, effort: 'medium' })
  const criteria = r.data.criteria.map((c) => ({ ...c, score: Math.max(0, Math.min(10, c.score)) }))
  const total = criteria.length
    ? Math.round((criteria.reduce((s, c) => s + c.score, 0) / criteria.length) * 10) / 10
    : 0
  return { score: total, criteria, issues: r.data.issues, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
}

/** Suggests article topics this site doesn't cover yet. */
export async function suggestIdeas(site: Site, ctx: SiteContext, drafts: string[], count: number, focus?: string) {
  const user = `Suggest ${count} article ideas for this site${focus ? `, focused on: ${focus}` : ''}.

Pick questions real local customers type into Google or ask an AI assistant before choosing a ${site.requiresClinicalSignoff ? 'clinic' : 'gym'}, where this business has a genuinely useful, specific answer based on the facts above. Mix quick practical questions with a few bigger decision-stage topics. Skip anything already covered:
${[...ctx.existing.map((e) => e.title), ...drafts].map((t) => `- ${t}`).join('\n') || '- nothing yet'}

For each: "title" (working title), "search" (the phrase people would type or ask), "why" (one sentence on why it would bring in customers).`
  const r = await structured(IdeasSchema, { system: systemPrompt(site, ctx), user, effort: 'medium' })
  return { ideas: r.data.ideas, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
}
