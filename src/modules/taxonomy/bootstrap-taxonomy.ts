import { normalizeSkillTerm } from './normalize-skill-term';

/**
 * Launch catalog for Explore V2. Flat Category → Skill. One skill belongs to
 * one category. `key` is the immutable identity. Slug and English wording may
 * change later; the key must not, because seed ids are derived from it.
 *
 * No rows have been inserted yet, so keys omitted from this catalog are never
 * created. To retire a row after insertion, keep the key and set isActive
 * false. Do not delete a key.
 *
 * Arabic names stay unset until there is an authoritative translation.
 * Aliases are equivalent search terms, not related skills. A specialty does
 * not satisfy a different specialty, and a generic skill does not satisfy an
 * exact specialty filter.
 */
export interface TaxonomyAliasSeed {
  /** Immutable. Do not rename. */
  key: string;
  term: string;
}

export interface TaxonomySkillSeed {
  /** Immutable identity. Do not rename. */
  key: string;
  slug: string;
  nameEn: string;
  sortOrder: number;
  /** Omit to leave the stored active flag alone after creation. */
  isActive?: boolean;
  aliases?: readonly TaxonomyAliasSeed[];
}

export interface TaxonomyCategorySeed {
  /** Immutable identity. Do not rename. */
  key: string;
  slug: string;
  nameEn: string;
  sortOrder: number;
  /** Omit to leave the stored active flag alone after creation. */
  isActive?: boolean;
  skills: readonly TaxonomySkillSeed[];
}

export class TaxonomyCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxonomyCatalogError';
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function alias(key: string, term: string): TaxonomyAliasSeed {
  return { key, term };
}

function skill(
  key: string,
  nameEn: string,
  sortOrder: number,
  aliases?: readonly TaxonomyAliasSeed[],
  slug?: string,
): TaxonomySkillSeed {
  return {
    key,
    slug: slug ?? key,
    nameEn,
    sortOrder,
    ...(aliases === undefined ? {} : { aliases }),
  };
}

/**
 * Legacy strings that must not become canonical skills or aliases.
 * Exact normalized lookup must miss every one of them.
 */
export const UNMAPPED_LEGACY_STRINGS = [
  'Social',
  'Content',
  'Web',
  'Product',
  'Marketplace',
  'Food',
  'Tech',
  'Motion',
  'Motion Design',
  'Motion Designer',
  'Campaigns',
  'Leadership',
  'Events',
  'Editorial',
  'Editing',
  'Product Design',
  'Portrait',
  'Procreate',
  'Lightroom',
  'Node.js',
  'React',
  'Strategy',
  'Dashboards',
  'Packaging',
  'Illustrator',
  'Reels',
  'Brand Identity',
  'Brand Guidelines',
  'User Research',
  'Event Management',
  'Social Media Marketing',
  'Arabic copywriting',
  'Development',
  'MC',
] as const;

export const BOOTSTRAP_TAXONOMY: readonly TaxonomyCategorySeed[] = [
  {
    key: 'photography',
    slug: 'photography',
    nameEn: 'Photography',
    sortOrder: 10,
    skills: [
      skill('photography', 'Photography', 10, [
        alias('photographer', 'Photographer'),
      ]),
      skill('wedding-photography', 'Wedding Photography', 20, [
        alias('wedding-photographer', 'Wedding Photographer'),
      ]),
      skill('event-photography', 'Event Photography', 30, [
        alias('event-photographer', 'Event Photographer'),
      ]),
      skill('portrait-photography', 'Portrait Photography', 40, [
        alias('portrait-photographer', 'Portrait Photographer'),
      ]),
      skill('product-photography', 'Product Photography', 50),
      skill('food-photography', 'Food Photography', 60),
      skill('fashion-photography', 'Fashion Photography', 70),
      skill('commercial-photography', 'Commercial Photography', 80),
      skill('real-estate-photography', 'Real Estate Photography', 90),
      skill('photo-editing', 'Photo Editing', 100, [
        alias('photo-editor', 'Photo Editor'),
      ]),
      skill('retouching', 'Retouching', 110),
    ],
  },
  {
    key: 'video',
    slug: 'video-film',
    nameEn: 'Video & Film',
    sortOrder: 20,
    skills: [
      skill('videography', 'Videography', 10, [
        alias('videographer', 'Videographer'),
      ]),
      skill('video-editing', 'Video Editing', 20, [
        alias('video-editor', 'Video Editor'),
      ]),
      skill('wedding-videography', 'Wedding Videography', 30, [
        alias('wedding-videographer', 'Wedding Videographer'),
      ]),
      skill('event-videography', 'Event Videography', 40, [
        alias('event-videographer', 'Event Videographer'),
      ]),
      skill('commercial-video', 'Commercial Video', 50),
      skill('short-form-video', 'Short-form Video', 60, [
        alias('short-form', 'Short Form Video'),
      ]),
      skill('cinematography', 'Cinematography', 70),
      skill('film-production', 'Film Production', 80),
      skill('motion-graphics', 'Motion Graphics', 90),
      skill('color-grading', 'Color Grading', 100, [
        alias('colour-grading', 'Colour Grading'),
      ]),
      skill('after-effects', 'After Effects', 900),
    ],
  },
  {
    key: 'design',
    slug: 'design',
    nameEn: 'Design',
    sortOrder: 30,
    skills: [
      skill('graphic-design', 'Graphic Design', 10, [
        alias('graphic-designer', 'Graphic Designer'),
      ]),
      skill('branding', 'Branding', 20, [
        alias('brand-designer', 'Brand Designer'),
      ]),
      skill('logo-design', 'Logo Design', 30, [
        alias('logo-designer', 'Logo Designer'),
      ]),
      skill('ui-design', 'UI Design', 40, [
        alias('ui-designer', 'UI Designer'),
      ]),
      skill('ux-design', 'UX Design', 50, [
        alias('ux-designer', 'UX Designer'),
      ]),
      skill('ui-ux-design', 'UI/UX Design', 60, [
        alias('ui-ux', 'UI/UX'),
        alias('ui-ux-designer', 'UI/UX Designer'),
        alias('ux-ui-design', 'UX/UI Design'),
      ]),
      skill('illustration', 'Illustration', 70),
      skill('social-media-design', 'Social Media Design', 80),
      skill('packaging-design', 'Packaging Design', 90),
      skill('art-direction', 'Art Direction', 100),
      skill('campaign-design', 'Campaign Design', 110),
      skill('print-design', 'Print Design', 120),
      skill('presentation-design', 'Presentation Design', 130),
      skill('ux-research', 'UX Research', 140),
      skill('icon-design', 'Icon Design', 150),
      skill('editorial-design', 'Editorial Design', 160),
      skill('brand-systems', 'Brand Systems', 170),
      skill('design-systems', 'Design Systems', 180),
      skill('prototyping', 'Prototyping', 190),
      skill('3d-modeling', '3D Modeling', 200, [
        alias('3d-modeler', '3D Modeler'),
        alias('3d-modelling', '3D Modelling'),
      ]),
      skill('figma', 'Figma', 900),
    ],
  },
  {
    key: 'beauty',
    slug: 'beauty',
    nameEn: 'Beauty',
    sortOrder: 40,
    skills: [
      skill(
        'makeup',
        'Makeup Artist',
        10,
        [
          alias('makeup', 'Makeup'),
          alias('make-up-artist', 'Make-up Artist'),
          alias('make-up-artist-plain', 'Make up Artist'),
        ],
        'makeup-artist',
      ),
      skill('bridal-makeup', 'Bridal Makeup', 20, [
        alias('bridal-makeup-artist', 'Bridal Makeup Artist'),
      ]),
      skill('hair-styling', 'Hair Styling', 30, [
        alias('hair-stylist', 'Hair Stylist'),
        alias('hairstylist', 'Hairstylist'),
      ]),
      skill('bridal-hair', 'Bridal Hair', 40, [
        alias('bridal-hairstylist', 'Bridal Hairstylist'),
      ]),
      skill('henna', 'Henna', 50, [alias('henna-artist', 'Henna Artist')]),
      skill('barber', 'Barber', 60),
      skill('nail-art', 'Nail Art', 70, [alias('nail-artist', 'Nail Artist')]),
    ],
  },
  {
    key: 'music-audio',
    slug: 'music-audio',
    nameEn: 'Music & Audio',
    sortOrder: 50,
    skills: [
      skill('singer', 'Singer', 10, [alias('vocalist', 'Vocalist')]),
      skill('musician', 'Musician', 20),
      skill('dj', 'DJ', 30, [alias('disc-jockey', 'Disc Jockey')]),
      skill('music-production', 'Music Production', 40, [
        alias('music-producer', 'Music Producer'),
      ]),
      skill('oud', 'Oud', 50, [alias('oud-player', 'Oud Player')]),
      skill('piano', 'Piano', 60, [alias('pianist', 'Pianist')]),
      skill('guitar', 'Guitar', 70, [alias('guitarist', 'Guitarist')]),
      skill('violin', 'Violin', 80, [alias('violinist', 'Violinist')]),
      skill('songwriting', 'Songwriting', 90, [
        alias('songwriter', 'Songwriter'),
      ]),
      skill('composer', 'Composer', 100),
      skill('audio-engineering', 'Audio Engineering', 110, [
        alias('audio-engineer', 'Audio Engineer'),
      ]),
      skill('mixing-and-mastering', 'Mixing & Mastering', 120),
      skill('voice-over', 'Voice Over', 130, [
        alias('voiceover', 'Voiceover'),
        alias('voice-over-hyphen', 'Voice-over'),
      ]),
      skill('sound-design', 'Sound Design', 140),
    ],
  },
  {
    key: 'events',
    slug: 'events',
    nameEn: 'Events',
    sortOrder: 60,
    skills: [
      skill('event-planning', 'Event Planning', 10, [
        alias('event-planner', 'Event Planner'),
        alias('event-organiser', 'Event Organiser'),
        alias('event-organizer', 'Event Organizer'),
      ]),
      skill('event-host', 'Event Host', 20, [alias('emcee', 'Emcee')]),
      skill('event-production', 'Event Production', 30, [
        alias('event-producer', 'Event Producer'),
      ]),
      skill('dance', 'Dance', 40, [alias('dancer', 'Dancer')]),
      skill('magic', 'Magic', 50, [alias('magician', 'Magician')]),
      skill('floral-design', 'Floral Design', 60, [
        alias('florist', 'Florist'),
      ]),
      skill('event-decor', 'Event Decor', 70, [
        alias('event-decoration', 'Event Decoration'),
      ]),
    ],
  },
  {
    key: 'food',
    slug: 'food',
    nameEn: 'Food',
    sortOrder: 70,
    skills: [
      skill('chef', 'Chef', 10),
      skill('private-chef', 'Private Chef', 20),
      skill('catering', 'Catering', 30, [alias('caterer', 'Caterer')]),
      skill('baking', 'Baking', 40, [alias('baker', 'Baker')]),
      skill('pastry', 'Pastry', 50, [alias('pastry-chef', 'Pastry Chef')]),
      skill('cake-design', 'Cake Design', 60, [
        alias('cake-designer', 'Cake Designer'),
      ]),
      skill('food-styling', 'Food Styling', 70),
      skill('barista', 'Barista', 80),
    ],
  },
  {
    key: 'content',
    slug: 'content-social-media',
    nameEn: 'Content & Social Media',
    sortOrder: 80,
    skills: [
      skill('content-creation', 'Content Creation', 10, [
        alias('content-creator', 'Content Creator'),
      ]),
      skill('social-media-management', 'Social Media Management', 20, [
        alias('social-media-manager', 'Social Media Manager'),
      ]),
      skill('content-strategy', 'Content Strategy', 30),
      skill('copywriting', 'Copywriting', 40, [
        alias('copywriter', 'Copywriter'),
      ]),
      skill('scriptwriting', 'Scriptwriting', 50, [
        alias('scriptwriter', 'Scriptwriter'),
      ]),
      skill('ugc-creation', 'UGC Creation', 60, [
        alias('ugc', 'UGC'),
        alias('ugc-creator', 'UGC Creator'),
      ]),
      skill('translation', 'Translation', 70, [
        alias('translator', 'Translator'),
      ]),
    ],
  },
  {
    key: 'technology',
    slug: 'technology',
    nameEn: 'Technology',
    sortOrder: 90,
    skills: [
      skill('web-development', 'Web Development', 10),
      skill('mobile-app-development', 'Mobile App Development', 20),
      skill('react-native', 'React Native', 900),
      skill('typescript', 'TypeScript', 910),
    ],
  },
  {
    key: 'marketing',
    slug: 'marketing',
    nameEn: 'Marketing',
    sortOrder: 100,
    skills: [
      skill('digital-marketing', 'Digital Marketing', 10),
      skill('seo', 'SEO', 20, [
        alias('search-engine-optimization', 'Search Engine Optimization'),
        alias('search-engine-optimisation', 'Search Engine Optimisation'),
      ]),
      skill('paid-advertising', 'Paid Advertising', 30),
      skill('influencer-marketing', 'Influencer Marketing', 40),
      skill('email-marketing', 'Email Marketing', 50, [
        alias('e-mail-marketing', 'E-mail Marketing'),
      ]),
    ],
  },
];

function claimTerm(
  terms: Map<string, string>,
  skillKey: string,
  raw: string,
): void {
  const normalized = normalizeSkillTerm(raw);
  if (!normalized) {
    throw new TaxonomyCatalogError(`Skill "${skillKey}" has an empty term`);
  }
  const owner = terms.get(normalized);
  if (owner) {
    throw new TaxonomyCatalogError(
      `Term "${raw.trim()}" belongs to both "${owner}" and "${skillKey}"`,
    );
  }
  terms.set(normalized, skillKey);
}

export function assertBootstrapTaxonomy(
  catalog: readonly TaxonomyCategorySeed[],
): void {
  const categoryKeys = new Set<string>();
  const categorySlugs = new Set<string>();
  const skillKeys = new Set<string>();
  const skillSlugs = new Set<string>();
  const terms = new Map<string, string>();

  for (const category of catalog) {
    if (!SLUG.test(category.key)) {
      throw new TaxonomyCatalogError(`Invalid category key "${category.key}"`);
    }
    if (!SLUG.test(category.slug)) {
      throw new TaxonomyCatalogError(
        `Invalid category slug "${category.slug}"`,
      );
    }
    if (categoryKeys.has(category.key)) {
      throw new TaxonomyCatalogError(
        `Duplicate category key "${category.key}"`,
      );
    }
    if (categorySlugs.has(category.slug)) {
      throw new TaxonomyCatalogError(
        `Duplicate category slug "${category.slug}"`,
      );
    }
    categoryKeys.add(category.key);
    categorySlugs.add(category.slug);
    if (!normalizeSkillTerm(category.nameEn)) {
      throw new TaxonomyCatalogError(`Category "${category.key}" has no name`);
    }
    if (category.skills.length === 0) {
      throw new TaxonomyCatalogError(
        `Category "${category.key}" has no skills`,
      );
    }

    for (const skill of category.skills) {
      if (!SLUG.test(skill.key)) {
        throw new TaxonomyCatalogError(`Invalid skill key "${skill.key}"`);
      }
      if (!SLUG.test(skill.slug)) {
        throw new TaxonomyCatalogError(`Invalid skill slug "${skill.slug}"`);
      }
      if (skillKeys.has(skill.key)) {
        throw new TaxonomyCatalogError(`Duplicate skill key "${skill.key}"`);
      }
      if (skillSlugs.has(skill.slug)) {
        throw new TaxonomyCatalogError(`Duplicate skill slug "${skill.slug}"`);
      }
      skillKeys.add(skill.key);
      skillSlugs.add(skill.slug);
      claimTerm(terms, skill.key, skill.nameEn);

      const aliasKeys = new Set<string>();
      for (const alias of skill.aliases ?? []) {
        if (!SLUG.test(alias.key) || alias.key === 'canonical') {
          throw new TaxonomyCatalogError(
            `Invalid alias key "${alias.key}" on "${skill.key}"`,
          );
        }
        if (aliasKeys.has(alias.key)) {
          throw new TaxonomyCatalogError(
            `Duplicate alias key "${alias.key}" on "${skill.key}"`,
          );
        }
        aliasKeys.add(alias.key);
        claimTerm(terms, skill.key, alias.term);
      }
    }
  }
}

assertBootstrapTaxonomy(BOOTSTRAP_TAXONOMY);
