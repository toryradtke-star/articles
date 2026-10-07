import { ROOT } from './env.ts'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { articlePath, findArticle, listArticles, saveArticle, wordCount, type Meta } from './markdown.ts'
import { publishArticle } from './publish.ts'
import { siteContext } from './sanity.ts'
import { getSite, SITES } from './sites.ts'
import { score, suggestIdeas, write } from './writer.ts'

const HELP = `art: write articles for ${Object.values(SITES).map((s) => s.domain).join(' and ')}

  art ideas <site> [-n 10] [--focus "..."]    suggest topics the site doesn't cover yet
  art write <site> "<topic>" [--notes "..."]  write, grade and save an article (1-3 min)
  art list [site]                              every article, its score and status
  art check <site> <slug>                      re-grade after you edit the file
  art revise <site> <slug> ["what to change"]  rewrite using your notes (or the grader's)
  art claims <site> <slug>                     clinical sentences, ready to send for sign-off
  art publish <site> <slug> [--live] [--signed-off-by "Name"]
                                               to Sanity: a Studio draft, or live with --live

Sites: ${Object.values(SITES).map((s) => `${s.id} (${s.name})`).join(', ')}
Articles are markdown files in ${relative(process.cwd(), join(ROOT, 'drafts')) || 'drafts'}/<site>/. Edit them freely.
Slugs can be shortened to any unique start, e.g. "art check w247 is-it-safe".`

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    notes: { type: 'string' },
    focus: { type: 'string' },
    n: { type: 'string', short: 'n' },
    live: { type: 'boolean' },
    'signed-off-by': { type: 'string' },
    'no-fix': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})
const [command, siteId, arg] = positionals

const tokens = { input: 0, output: 0 }
const track = <T extends { inputTokens: number; outputTokens: number }>(r: T) => {
  tokens.input += r.inputTokens
  tokens.output += r.outputTokens
  return r
}
const log = (msg: string) => process.stderr.write(`${msg}\n`)
const show = (path: string) => relative(process.cwd(), path)
const today = () => new Date().toISOString().slice(0, 10)

function printScore(g: { score: number; criteria: { name: string; score: number; note: string }[]; issues: string[] }) {
  console.log(`\nScore ${g.score}/10`)
  for (const c of g.criteria) console.log(`  ${String(c.score).padStart(4)}  ${c.name}: ${c.note}`)
  if (g.issues.length) console.log(`\nSuggested fixes:\n${g.issues.map((i) => `  - ${i}`).join('\n')}`)
}

async function main() {
  if (!command || opt.help || command === 'help') return console.log(HELP)

  if (command === 'list') {
    const all = listArticles(siteId).sort((a, b) => a.meta.written.localeCompare(b.meta.written))
    if (!all.length) return console.log('No articles yet. Try: art ideas w247')
    for (const { meta } of all) {
      const status = meta.status === 'published' ? `live ${meta.url}` : meta.status
      console.log(`${meta.site.padEnd(6)} ${String(meta.score ?? '-').padStart(4)}  ${meta.slug}\n${' '.repeat(13)}${meta.title}  [${status}]`)
    }
    return
  }

  const site = getSite(siteId)

  if (command === 'ideas') {
    log(`Reading ${site.domain} and thinking up ideas...`)
    const ctx = await siteContext(site)
    const drafts = listArticles(site.id).map((a) => a.meta.title)
    const r = track(await suggestIdeas(site, ctx, drafts, Number(opt.n ?? 10), opt.focus))
    r.ideas.forEach((idea, i) => {
      console.log(`\n${i + 1}. ${idea.title}\n   search: ${idea.search}\n   ${idea.why}`)
    })
    console.log(`\nWrite one with: art write ${site.id} "<title>"`)
    return
  }

  if (command === 'write') {
    if (!arg) throw new Error('What should the article be about? art write w247 "your topic"')
    const t0 = Date.now()
    log(`Reading ${site.domain}...`)
    const ctx = await siteContext(site)
    log('Writing (about a minute)...')
    let a = track(await write(site, ctx, { topic: arg, notes: opt.notes }))
    log('Grading...')
    let g = track(await score(site, ctx, a))
    if (g.score < 8 && g.issues.length && !opt['no-fix']) {
      log(`Scored ${g.score}; revising once with the grader's fixes...`)
      a = track(await write(site, ctx, { topic: arg, notes: opt.notes }, { previous: a.body, feedback: g.issues }))
      g = track(await score(site, ctx, a))
    }
    let slug = a.slug
    for (let i = 2; existsSync(articlePath(site.id, slug)); i++) slug = `${a.slug}-${i}`
    const meta: Meta = {
      site: site.id,
      title: a.title,
      slug,
      excerpt: a.excerpt,
      metaTitle: a.metaTitle,
      metaDescription: a.metaDescription,
      request: arg + (opt.notes ? ` (notes: ${opt.notes})` : ''),
      status: 'draft',
      score: g.score,
      issues: g.issues,
      claims: a.claims,
      written: today(),
    }
    const path = saveArticle(meta, a.body)
    console.log(`\n${a.title}\n${wordCount(a.body)} words, ${Math.round((Date.now() - t0) / 1000)}s`)
    printScore(g)
    console.log(`\nSaved: ${show(path)}`)
    if (a.claims.length) console.log(`${a.claims.length} clinical sentences need sign-off: art claims ${site.id} ${slug}`)
    console.log(`Next: read/edit the file, then  art publish ${site.id} ${slug}  (Studio draft)  or add --live`)
    return
  }

  if (!arg) throw new Error(`Which article? art ${command} ${site.id} <slug>   (see: art list ${site.id})`)
  const article = findArticle(site.id, arg)
  const { meta } = article

  if (command === 'check') {
    log('Grading...')
    const ctx = await siteContext(site)
    const g = track(await score(site, ctx, { ...meta, body: article.body, claims: meta.claims ?? [] }))
    saveArticle({ ...meta, score: g.score, issues: g.issues }, article.body, article.path)
    printScore(g)
    return
  }

  if (command === 'revise') {
    const feedback = positionals.slice(3).length ? positionals.slice(3) : (meta.issues ?? [])
    if (!feedback.length) throw new Error('Nothing to fix. Say what to change: art revise <site> <slug> "make it shorter"')
    log(`Revising with ${feedback.length} note(s)...`)
    const ctx = await siteContext(site)
    const a = track(await write(site, ctx, { topic: meta.request }, { previous: article.body, feedback }))
    log('Grading...')
    const g = track(await score(site, ctx, a))
    // Keep the URL once it exists; changing it would break links to a live article.
    saveArticle(
      { ...meta, title: a.title, excerpt: a.excerpt, metaTitle: a.metaTitle, metaDescription: a.metaDescription, score: g.score, issues: g.issues, claims: a.claims, signedOffBy: undefined },
      a.body,
      article.path,
    )
    printScore(g)
    console.log(`\nUpdated: ${show(article.path)}`)
    return
  }

  if (command === 'claims') {
    const claims = meta.claims ?? []
    if (!claims.length) return console.log('No clinical sentences flagged in this article.')
    console.log(`Please review before this goes on ${site.domain}: "${meta.title}"\n`)
    console.log('Are these statements accurate as written? Reply OK, or tell me which numbers to change and how.\n')
    claims.forEach((c, i) => console.log(`${i + 1}. ${c}\n`))
    console.log(`Once approved: art publish ${site.id} ${meta.slug} --live --signed-off-by "Name, DPT"`)
    return
  }

  if (command === 'publish') {
    const live = Boolean(opt.live)
    const signer = opt['signed-off-by'] ?? meta.signedOffBy
    if (live && site.requiresClinicalSignoff && meta.claims?.length && !signer) {
      throw new Error(`${site.name} articles need a clinician's OK first. Send them: art claims ${site.id} ${meta.slug}\nThen: art publish ${site.id} ${meta.slug} --live --signed-off-by "Name, DPT"`)
    }
    log(live ? `Publishing to ${site.domain}...` : `Sending to ${site.name}'s Studio as a draft...`)
    const updated = { ...meta, signedOffBy: signer }
    const r = await publishArticle(site, { ...article, meta: updated }, live)
    saveArticle(
      {
        ...updated,
        sanityId: r.sanityId,
        status: live ? 'published' : meta.status === 'published' ? 'published' : 'in-studio',
        url: r.url,
        publishedAt: live ? (meta.publishedAt ?? new Date().toISOString()) : meta.publishedAt,
      },
      article.body,
      article.path,
    )
    console.log(live ? `Live in a few seconds: ${r.url}` : `In Studio as a draft (add a photo, then Publish there, or run with --live).`)
    return
  }

  throw new Error(`Unknown command "${command}". Run: art help`)
}

main()
  .catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(() => {
    if (tokens.input || tokens.output) log(`(Claude: ${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out tokens)`)
  })
