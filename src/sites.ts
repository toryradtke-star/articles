/**
 * The sites this tool writes for. To add a client: add an entry here with
 * its Sanity project, article type, writing rules, the GROQ query that pulls
 * its facts, and the pages articles may link to. Then add its write token to
 * .env as SANITY_WRITE_TOKEN_<ID>.
 */
export type Site = {
  id: string
  name: string
  domain: string
  sanityProjectId: string
  sanityDataset: string
  /** Sanity document type for articles. */
  postType: string
  /** Where articles live on the site, e.g. /blog. */
  postPath: string
  /** Healthcare sites: clinical sentences need a clinician's sign-off. */
  requiresClinicalSignoff: boolean
  /** Link fields that only accept full URLs (Omnia's `url` type). */
  absoluteLinks: boolean
  brandRules: string[]
  /** Everything an article may state as fact. `pt::text` flattens rich text. */
  factsQuery: string
  routes: { path: string; what: string }[]
}

export const SITES: Record<string, Site> = {
  w247: {
    id: 'w247',
    name: 'Workout 24/7',
    domain: 'workout247fitness.com',
    sanityProjectId: 'd23k8dpn',
    sanityDataset: 'production',
    postType: 'post',
    postPath: '/blog',
    requiresClinicalSignoff: false,
    absoluteLinks: false,
    brandRules: [
      'Plain, direct, small-town Minnesota voice. No hype, no fitness-influencer slang.',
      'Two 24-hour keycard gyms: Wells and Osakis, MN. No staffed hours, no classes, no personal training.',
      'Only state prices, fees and policies that come from the site facts. Never invent amenities.',
      'Calls to action point to the town page (/wells or /osakis) or /join.',
    ],
    factsQuery: `{
      "towns": *[_type == "location"] | order(displayOrder asc){
        name, "path": "/" + slug.current, streetAddress, cityStateZip, phoneDisplay,
        intro, equipment, maintenanceNote, specialOffer,
        "plans": *[_type == "membershipPlan" && location._ref == ^._id]{
          tier, label, joiningFee, "terms": terms[]{ months, monthlyPrice }
        }
      },
      "faq": *[_type == "faqEntry"] | order(order asc){ question, answer },
      "settings": *[_id == "siteSettings"][0]{
        militaryDiscountPercent, militaryDiscountTerms, replacementKeyFee
      }
    }`,
    routes: [
      { path: '/', what: 'Home: both gyms, prices by town' },
      { path: '/wells', what: 'Wells gym: address, hours, rates' },
      { path: '/osakis', what: 'Osakis gym: address, hours, rates' },
      { path: '/join', what: 'How to become a member' },
      { path: '/about', what: 'About the gyms' },
      { path: '/contact', what: 'Phones, addresses, contact form' },
    ],
  },
  omnia: {
    id: 'omnia',
    name: 'Omnia Wellness & Recovery',
    domain: 'omniatherapies.com',
    sanityProjectId: 'ksx13wmz',
    sanityDataset: 'production',
    postType: 'blogPost',
    postPath: '/news',
    requiresClinicalSignoff: true,
    absoluteLinks: true,
    brandRules: [
      'The brand is "Omnia Wellness & Recovery". Never "Omnia Physical Therapy".',
      'Warm, expert, plain-language voice of a Doctor of Physical Therapy. One-on-one care.',
      'Clinic in Superior, WI; serves Superior, Duluth, and virtual visits across MN and WI.',
      'Educational only: no diagnosis, no guaranteed outcomes, no drug or injection advice.',
      'Every article ends with a "talk to a DPT" call to action pointing to /appointment.',
    ],
    factsQuery: `{
      "clinic": *[_type == "siteSettings"][0]{ addressLines, phone, serviceArea },
      "services": *[_type == "servicesPage"][0].services[]{
        name,
        "summary": coalesce(pt::text(summary), summary),
        "description": coalesce(pt::text(description), description)
      },
      "team": *[_type == "homePage"][0]{
        "lead": { "name": teamName, "title": teamBadgeTitle, "bio": coalesce(pt::text(teamBio), teamBio) },
        "others": teamMembers[]{ name, "title": badgeTitle, "bio": coalesce(pt::text(bio), bio) }
      },
      "faq": *[_type == "homePage"][0].faqs[]{ question, "answer": coalesce(pt::text(answer), answer) }
    }`,
    routes: [
      { path: '/', what: 'Home: the clinic, team, FAQ' },
      { path: '/services', what: 'All services' },
      { path: '/appointment', what: 'Book an appointment' },
      { path: '/contact', what: 'Contact the clinic' },
    ],
  },
}

export function getSite(id: string | undefined): Site {
  const site = id && SITES[id]
  if (!site) throw new Error(`Unknown site "${id ?? ''}". Choose one of: ${Object.keys(SITES).join(', ')}`)
  return site
}

export const writeTokenVar = (site: Site) => `SANITY_WRITE_TOKEN_${site.id.toUpperCase()}`
