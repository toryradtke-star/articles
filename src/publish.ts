import { splitFaq, toPortableText, type Article } from './markdown.ts'
import { writer } from './sanity.ts'
import type { Site } from './sites.ts'

/**
 * Sends an article to the site's Sanity. `live: false` leaves it as a Studio
 * draft (to add a photo first); `live: true` publishes it, which fires the
 * site's webhook and puts it on the site within seconds.
 */
export async function publishArticle(site: Site, article: Article, live: boolean) {
  const { meta } = article
  const client = writer(site)
  const baseId = meta.sanityId ?? `art-${site.id}-${meta.slug}`
  const resolve = site.absoluteLinks
    ? (href: string) => (href.startsWith('/') ? `https://${site.domain}${href}` : href)
    : (href: string) => href

  // Slugs must be unique on the site; refuse rather than shadow another page.
  const clash = await client.fetch<string | null>(
    `*[_type == $type && slug.current == $slug && !(_id in [$id, "drafts." + $id])][0]._id`,
    { type: site.postType, slug: meta.slug, id: baseId },
  )
  if (clash) throw new Error(`Another article on ${site.domain} already uses the URL "${meta.slug}". Change slug: in the file and try again.`)

  const { main, faq } = splitFaq(article.body)
  const doc: { _id: string; _type: string; [field: string]: unknown } = {
    _id: live ? baseId : `drafts.${baseId}`,
    _type: site.postType,
    title: meta.title,
    slug: { _type: 'slug', current: meta.slug },
    publishedAt: meta.publishedAt ?? new Date().toISOString(),
    excerpt: meta.excerpt,
    metaTitle: meta.metaTitle,
    metaDescription: meta.metaDescription,
  }
  if (site.id === 'omnia') {
    // blogPost has no FAQ field, so the Q&A stays at the end of the body.
    doc.body = toPortableText(article.body, resolve)
    doc.author = meta.signedOffBy ?? site.name
    // Shown on the page as "Clinically reviewed by" and in its MedicalWebPage reviewedBy data.
    if (meta.signedOffBy) {
      doc.reviewedBy = meta.signedOffBy
      doc.reviewedAt = new Date().toISOString()
    }
  } else {
    doc.body = toPortableText(main, resolve)
    doc.faq = faq.map((qa, i) => ({ _type: 'qa', _key: `qa${i}`, ...qa }))
  }

  // Keep any image or edits already added in Studio.
  const existing = await client.fetch<Record<string, unknown> | null>(
    `coalesce(*[_id == "drafts." + $id][0], *[_id == $id][0]){ mainImage, location }`,
    { id: baseId },
  )
  for (const [k, v] of Object.entries(existing ?? {})) if (v != null) doc[k] = v

  const tx = client.transaction().createOrReplace(doc)
  if (live) tx.delete(`drafts.${baseId}`)
  await tx.commit()

  return { sanityId: baseId, url: `https://${site.domain}${site.postPath}/${meta.slug}` }
}
