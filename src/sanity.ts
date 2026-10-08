import { createClient, type SanityClient } from '@sanity/client'
import { writeTokenVar, type Site } from './sites.ts'

export function reader(site: Site): SanityClient {
  return createClient({
    projectId: site.sanityProjectId,
    dataset: site.sanityDataset,
    apiVersion: '2025-02-19',
    useCdn: false,
    perspective: 'published',
  })
}

export function writer(site: Site): SanityClient {
  const token = process.env[writeTokenVar(site)]
  if (!token) throw new Error(`${writeTokenVar(site)} is missing from ~/articles/.env`)
  return createClient({
    projectId: site.sanityProjectId,
    dataset: site.sanityDataset,
    apiVersion: '2025-02-19',
    token,
    useCdn: false,
    // API 2025-02-19 defaults to the published perspective, which hides drafts.
    // publish.ts needs to see Studio drafts (to keep their photos and catch slug clashes).
    perspective: 'raw',
  })
}

export type SiteContext = {
  facts: unknown
  routes: { path: string; what: string }[]
  existing: { title: string; path: string }[]
}

/** Live facts and published articles, so drafts never invent prices or repeat a topic. */
export async function siteContext(site: Site): Promise<SiteContext> {
  const client = reader(site)
  const [facts, posts] = await Promise.all([
    client.fetch(site.factsQuery),
    client.fetch<{ title: string; slug: string }[]>(
      `*[_type == $type && defined(slug.current)] | order(publishedAt desc){ title, "slug": slug.current }`,
      { type: site.postType },
    ),
  ])
  const existing = posts.map((p) => ({ title: p.title, path: `${site.postPath}/${p.slug}` }))
  return {
    facts,
    routes: [...site.routes, ...existing.map((e) => ({ path: e.path, what: `Article: ${e.title}` }))],
    existing,
  }
}
