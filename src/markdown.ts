import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

export const DRAFTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drafts')
export const FAQ_HEADING = 'Frequently asked questions'

/** Front matter of an article file. Everything below it is the article in markdown. */
export type Meta = {
  site: string
  title: string
  slug: string
  excerpt: string
  metaTitle: string
  metaDescription: string
  request: string
  status: 'draft' | 'in-studio' | 'published'
  score?: number
  issues?: string[]
  claims?: string[]
  signedOffBy?: string
  sanityId?: string
  url?: string
  publishedAt?: string
  written: string
}

export type Article = { meta: Meta; body: string; path: string }

export const articlePath = (site: string, slug: string) => join(DRAFTS_DIR, site, `${slug}.md`)

export function saveArticle(meta: Meta, body: string, path = articlePath(meta.site, meta.slug)) {
  mkdirSync(dirname(path), { recursive: true })
  // Drop empty fields so the file stays easy to read.
  const clean = Object.fromEntries(
    Object.entries(meta).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)),
  )
  writeFileSync(path, `---\n${YAML.stringify(clean, { lineWidth: 0 })}---\n\n${body.trim()}\n`)
  return path
}

export function loadArticle(path: string): Article {
  const text = readFileSync(path, 'utf8')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`${path} has no front matter`)
  return { meta: YAML.parse(m[1]) as Meta, body: m[2].trim(), path }
}

/** Finds an article by site and slug (or a unique start of the slug). */
export function findArticle(site: string, slug: string): Article {
  const exact = articlePath(site, slug)
  if (existsSync(exact)) return loadArticle(exact)
  const matches = listArticles(site).filter((a) => a.meta.slug.startsWith(slug))
  if (matches.length === 1) return matches[0]
  if (!matches.length) throw new Error(`No ${site} article matching "${slug}". Run: art list ${site}`)
  throw new Error(`"${slug}" matches several articles: ${matches.map((a) => a.meta.slug).join(', ')}`)
}

export function listArticles(site?: string): Article[] {
  if (!existsSync(DRAFTS_DIR)) return []
  const sites = site ? [site] : readdirSync(DRAFTS_DIR)
  return sites.flatMap((s) => {
    const dir = join(DRAFTS_DIR, s)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => loadArticle(join(dir, f)))
  })
}

/** Splits the article into the main body and its FAQ section. */
export function splitFaq(body: string) {
  const i = body.search(new RegExp(`^## ${FAQ_HEADING}\\s*$`, 'm'))
  if (i < 0) return { main: body, faq: [] as { question: string; answer: string }[] }
  const faq = body
    .slice(i)
    .split(/^### /m)
    .slice(1)
    .map((chunk) => {
      const [question, ...rest] = chunk.split('\n')
      return { question: question.trim(), answer: rest.join(' ').replace(/\s+/g, ' ').trim() }
    })
    .filter((qa) => qa.question && qa.answer)
  return { main: body.slice(0, i).trim(), faq }
}

export function wordCount(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split(/\s+/)
    .filter((w) => /\w/.test(w) && !/^#+$/.test(w)).length
}

// ---- Portable Text, for publishing to Sanity ----

export type PortableBlock = {
  _type: 'block'
  _key: string
  style: 'normal' | 'h2' | 'h3'
  listItem?: 'bullet' | 'number'
  level?: number
  markDefs: { _type: 'link'; _key: string; href: string }[]
  children: { _type: 'span'; _key: string; text: string; marks: string[] }[]
}

const key = () => randomBytes(6).toString('hex')

/** Splits a line into spans. Supports [text](href) links and **bold**. */
function inline(text: string, resolveHref: (href: string) => string) {
  const markDefs: PortableBlock['markDefs'] = []
  const children: PortableBlock['children'] = []
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) children.push({ _type: 'span', _key: key(), text: text.slice(last, m.index), marks: [] })
    if (m[1] !== undefined) {
      const linkKey = key()
      markDefs.push({ _type: 'link', _key: linkKey, href: resolveHref(m[2]) })
      children.push({ _type: 'span', _key: key(), text: m[1], marks: [linkKey] })
    } else {
      children.push({ _type: 'span', _key: key(), text: m[3], marks: ['strong'] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length || children.length === 0) {
    children.push({ _type: 'span', _key: key(), text: text.slice(last), marks: [] })
  }
  return { markDefs, children }
}

function block(
  text: string,
  style: PortableBlock['style'],
  resolveHref: (href: string) => string,
  listItem?: PortableBlock['listItem'],
): PortableBlock {
  return { _type: 'block', _key: key(), style, ...(listItem && { listItem, level: 1 }), ...inline(text.trim(), resolveHref) }
}

/** Converts the markdown subset the writer produces (and you may edit) into Portable Text. */
export function toPortableText(markdown: string, resolveHref: (href: string) => string = (h) => h): PortableBlock[] {
  const out: PortableBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(block(para.join(' '), 'normal', resolveHref))
    para = []
  }
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if (!line) flush()
    else if ((m = line.match(/^#{3,6}\s+(.*)$/))) (flush(), out.push(block(m[1], 'h3', resolveHref)))
    else if ((m = line.match(/^#{1,2}\s+(.*)$/))) (flush(), out.push(block(m[1], 'h2', resolveHref)))
    else if ((m = line.match(/^[-*]\s+(.*)$/))) (flush(), out.push(block(m[1], 'normal', resolveHref, 'bullet')))
    else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) (flush(), out.push(block(m[1], 'normal', resolveHref, 'number')))
    else para.push(line)
  }
  flush()
  return out
}
