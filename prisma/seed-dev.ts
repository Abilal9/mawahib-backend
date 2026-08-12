/**
 * Development-only seed: two complete Mawahib users (Auth + Prisma + Phase 2 data).
 *
 * Run: npm run seed:dev
 *
 * Safety:
 * - Refuses NODE_ENV=production unless ALLOW_DEV_SEED=true
 * - Only upserts known @mawahib.dev emails
 * - Idempotent: reuses Auth users, replaces [DEV]-tagged portfolio/services
 *
 * Credentials: set DEV_SEED_PASSWORD in .env (never commit). Defaults printed at end.
 */
import { createClient } from '@supabase/supabase-js';
import {
  AccountType,
  MediaPurpose,
  MediaStatus,
  PackageTier,
  PrismaClient,
  ServiceOfferingStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const SEED_MARKER = '[DEV]';
const OBJECT_PREFIX = 'dev-seed';

type SeedUserSpec = {
  key: 'A' | 'B';
  email: string;
  password: string;
  accountType: AccountType;
  firstName: string;
  lastName: string;
  displayName: string;
  username: string;
  phoneE164: string;
  city: string;
  country: string;
  title: string;
  bio: string;
  skills: string[];
  avatarUrl: string;
  coverUrl: string;
};

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function assertDevSafe() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const allow = process.env.ALLOW_DEV_SEED === 'true';
  if (nodeEnv === 'production' && !allow) {
    throw new Error(
      'Refusing seed:dev in production. Set ALLOW_DEV_SEED=true only if intentional.',
    );
  }
}

function password(): string {
  return process.env.DEV_SEED_PASSWORD || 'MawahibDev1!';
}

function specs(): SeedUserSpec[] {
  const pw = password();
  return [
    {
      key: 'A',
      email: 'layla.talent@mawahib.dev',
      password: pw,
      accountType: AccountType.talent,
      firstName: 'Layla',
      lastName: 'AlHarbi',
      displayName: 'Layla AlHarbi',
      username: 'layla_talent_dev',
      phoneE164: '+966560900601',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      title: 'Brand & Visual Designer',
      bio: `${SEED_MARKER} Riyadh-based designer helping startups ship polished brand systems, social kits, and pitch decks. Development test account — not a real person.`,
      skills: ['Branding', 'UI Design', 'Illustration', 'Figma', 'Motion'],
      avatarUrl:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
      coverUrl:
        'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1200&h=600&fit=crop',
    },
    {
      key: 'B',
      email: 'najd.studio@mawahib.dev',
      password: pw,
      accountType: AccountType.business,
      firstName: 'Najd',
      lastName: 'Studio',
      displayName: 'Najd Creative Studio',
      username: 'najd_studio_dev',
      phoneE164: '+966560900602',
      city: 'Jeddah',
      country: 'Saudi Arabia',
      title: 'Creative Production Studio',
      bio: `${SEED_MARKER} Jeddah studio for campaign design, content packages, and brand launches. Development test account — not a real company.`,
      skills: ['Campaign Design', 'Content', 'Art Direction', 'Social'],
      avatarUrl:
        'https://images.unsplash.com/photo-1560179707-f14ee9aa457c?w=400&h=400&fit=crop',
      coverUrl:
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=600&fit=crop',
    },
  ];
}

/** Minimal valid JPEG (1x1) for Storage when remote fetch fails. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUNAQEBAQAAAAAAAAAAAAAAAAABAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGmP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64',
);

async function fetchImageBuffer(url: string): Promise<{ buf: Buffer; mime: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    return { buf, mime: mime.startsWith('image/') ? mime : 'image/jpeg' };
  } catch {
    return { buf: TINY_JPEG, mime: 'image/jpeg' };
  }
}

async function ensureAuthUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  spec: SeedUserSpec,
) {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
    user_metadata: {
      display_name: spec.displayName,
      first_name: spec.firstName,
      last_name: spec.lastName,
      city: spec.city,
      account_type: spec.accountType,
      phone_e164: spec.phoneE164,
      seed: 'mawahib-dev',
    },
  });

  if (!error && created.user) {
    return created.user;
  }

  const msg = error?.message ?? '';
  if (!/already|registered|exists/i.test(msg)) {
    // Try list fallback anyway
  }

  let page = 1;
  while (page <= 10) {
    const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (listErr) throw listErr;
    const found = listed.users.find(
      (u) => u.email?.toLowerCase() === spec.email.toLowerCase(),
    );
    if (found) {
      await supabase.auth.admin.updateUserById(found.id, {
        password: spec.password,
        email_confirm: true,
        user_metadata: {
          ...found.user_metadata,
          display_name: spec.displayName,
          phone_e164: spec.phoneE164,
          seed: 'mawahib-dev',
        },
      });
      return found;
    }
    if (listed.users.length < 200) break;
    page += 1;
  }

  throw new Error(
    `Failed to create or find auth user ${spec.email}: ${msg || 'unknown'}`,
  );
}

async function upsertDomainUser(userId: string, spec: SeedUserSpec) {
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: spec.email,
      accountType: spec.accountType,
      displayName: spec.displayName,
      username: spec.username,
      isVerified: true,
      profile: {
        create: {
          bio: spec.bio,
          title: spec.title,
          locationCity: spec.city,
          locationCountry: spec.country,
          avatarUrl: spec.avatarUrl,
          coverUrl: spec.coverUrl,
          phoneE164: spec.phoneE164,
          phoneVerified: false,
          emailVerified: true,
        },
      },
      skills: {
        create: spec.skills.map((skill) => ({ skill })),
      },
    },
    update: {
      email: spec.email,
      accountType: spec.accountType,
      displayName: spec.displayName,
      username: spec.username,
      isVerified: true,
      profile: {
        upsert: {
          create: {
            bio: spec.bio,
            title: spec.title,
            locationCity: spec.city,
            locationCountry: spec.country,
            avatarUrl: spec.avatarUrl,
            coverUrl: spec.coverUrl,
            phoneE164: spec.phoneE164,
            phoneVerified: false,
            emailVerified: true,
          },
          update: {
            bio: spec.bio,
            title: spec.title,
            locationCity: spec.city,
            locationCountry: spec.country,
            avatarUrl: spec.avatarUrl,
            coverUrl: spec.coverUrl,
            phoneE164: spec.phoneE164,
            emailVerified: true,
          },
        },
      },
    },
  });

  await prisma.userSkill.deleteMany({ where: { userId } });
  await prisma.userSkill.createMany({
    data: spec.skills.map((skill) => ({ userId, skill })),
  });
}

async function clearDevTaggedContent(userId: string) {
  const projects = await prisma.portfolioProject.findMany({
    where: { userId, title: { startsWith: SEED_MARKER } },
    include: { media: true },
  });
  for (const p of projects) {
    await prisma.portfolioMedia.deleteMany({ where: { projectId: p.id } });
    await prisma.portfolioProject.delete({ where: { id: p.id } });
  }

  const offerings = await prisma.serviceOffering.findMany({
    where: { userId, title: { startsWith: SEED_MARKER } },
    include: { media: true },
  });
  for (const o of offerings) {
    await prisma.serviceMedia.deleteMany({ where: { offeringId: o.id } });
    await prisma.servicePackage.deleteMany({ where: { offeringId: o.id } });
    await prisma.serviceAddon.deleteMany({ where: { offeringId: o.id } });
    await prisma.serviceOffering.delete({ where: { id: o.id } });
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { ownerId: userId, objectKey: { startsWith: `${OBJECT_PREFIX}/` } },
  });
  for (const a of assets) {
    await prisma.mediaAsset.delete({ where: { id: a.id } });
  }
}

async function uploadReadyAsset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ownerId: string,
  bucket: 'portfolio' | 'services' | 'avatars',
  purpose: MediaPurpose,
  objectKey: string,
  sourceUrl: string,
) {
  const { buf, mime } = await fetchImageBuffer(sourceUrl);
  const { error } = await supabase.storage.from(bucket).upload(objectKey, buf, {
    contentType: mime,
    upsert: true,
  });
  if (error) {
    throw new Error(`Storage upload failed (${bucket}/${objectKey}): ${error.message}`);
  }

  return prisma.mediaAsset.create({
    data: {
      id: randomUUID(),
      ownerId,
      bucket,
      objectKey,
      mimeType: mime,
      byteSize: BigInt(buf.length),
      width: 800,
      height: 600,
      purpose,
      status: MediaStatus.ready,
    },
  });
}

async function seedTalentContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const img = async (name: string, url: string) =>
    uploadReadyAsset(
      supabase,
      userId,
      'portfolio',
      MediaPurpose.portfolio,
      `${OBJECT_PREFIX}/${userId}/portfolio/${name}.jpg`,
      url,
    );

  const p1a = await img(
    'brand-1',
    'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800&h=600&fit=crop',
  );
  const p1b = await img(
    'brand-2',
    'https://images.unsplash.com/photo-1572044162444-ad60f128bdea?w=800&h=600&fit=crop',
  );
  const p2a = await img(
    'ui-1',
    'https://images.unsplash.com/photo-1559028012-481c04fa702d?w=800&h=600&fit=crop',
  );
  const p2b = await img(
    'ui-2',
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
  );
  const p3a = await img(
    'social-1',
    'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=800&h=600&fit=crop',
  );

  await prisma.portfolioProject.create({
    data: {
      userId,
      title: `${SEED_MARKER} Desert Bloom Brand System`,
      description: 'Full identity kit for a specialty coffee brand.',
      position: 0,
      media: {
        create: [
          { mediaAssetId: p1a.id, position: 0 },
          { mediaAssetId: p1b.id, position: 1 },
        ],
      },
    },
  });
  await prisma.portfolioProject.create({
    data: {
      userId,
      title: `${SEED_MARKER} Fintech App UI Kit`,
      description: 'Mobile UI exploration for a savings product.',
      position: 1,
      media: {
        create: [
          { mediaAssetId: p2a.id, position: 0 },
          { mediaAssetId: p2b.id, position: 1 },
        ],
      },
    },
  });
  await prisma.portfolioProject.create({
    data: {
      userId,
      title: `${SEED_MARKER} Social Campaign Pack`,
      description: 'Launch creatives for Ramadan campaign.',
      position: 2,
      media: {
        create: [{ mediaAssetId: p3a.id, position: 0 }],
      },
    },
  });

  const s1 = await uploadReadyAsset(
    supabase,
    userId,
    'services',
    MediaPurpose.service,
    `${OBJECT_PREFIX}/${userId}/services/logo.jpg`,
    'https://images.unsplash.com/photo-1626785774573-4b7993143460?w=800&h=600&fit=crop',
  );
  const s2 = await uploadReadyAsset(
    supabase,
    userId,
    'services',
    MediaPurpose.service,
    `${OBJECT_PREFIX}/${userId}/services/ui.jpg`,
    'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=800&h=600&fit=crop',
  );
  const s3 = await uploadReadyAsset(
    supabase,
    userId,
    'services',
    MediaPurpose.service,
    `${OBJECT_PREFIX}/${userId}/services/social.jpg`,
    'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=800&h=600&fit=crop',
  );

  await prisma.serviceOffering.create({
    data: {
      userId,
      title: `${SEED_MARKER} Logo & Brand Identity`,
      description: 'Logo, color system, and brand guidelines.',
      category: 'Branding',
      status: ServiceOfferingStatus.published,
      currency: 'SAR',
      position: 0,
      packages: {
        create: [
          {
            tier: PackageTier.basic,
            price: 800,
            currency: 'SAR',
            deliveryLabel: '5 days',
            includes: ['1 logo concept', '2 revisions', 'PNG + SVG'],
          },
          {
            tier: PackageTier.standard,
            price: 1800,
            currency: 'SAR',
            deliveryLabel: '10 days',
            includes: ['3 concepts', 'Brand colors', 'Mini guidelines'],
          },
          {
            tier: PackageTier.premium,
            price: 3500,
            currency: 'SAR',
            deliveryLabel: '15 days',
            includes: ['Full brand kit', 'Social templates', 'Source files'],
          },
        ],
      },
      addons: {
        create: [
          { title: 'Business card design', price: 250, currency: 'SAR', position: 0 },
          { title: 'Animated logo mark', price: 600, currency: 'SAR', position: 1 },
        ],
      },
      media: { create: [{ mediaAssetId: s1.id, position: 0 }] },
    },
  });

  await prisma.serviceOffering.create({
    data: {
      userId,
      title: `${SEED_MARKER} Mobile UI Design`,
      description: 'App screens and interactive prototype.',
      category: 'UI Design',
      status: ServiceOfferingStatus.published,
      currency: 'SAR',
      position: 1,
      packages: {
        create: [
          {
            tier: PackageTier.basic,
            price: 1200,
            currency: 'SAR',
            deliveryLabel: '7 days',
            includes: ['3 key screens', 'Figma file'],
          },
          {
            tier: PackageTier.standard,
            price: 2800,
            currency: 'SAR',
            deliveryLabel: '14 days',
            includes: ['8 screens', 'Prototype', 'Design system tokens'],
          },
          {
            tier: PackageTier.premium,
            price: 5200,
            currency: 'SAR',
            deliveryLabel: '21 days',
            includes: ['Full flow', 'Handoff notes', '2 revision rounds'],
          },
        ],
      },
      addons: {
        create: [
          { title: 'Dark mode variants', price: 700, currency: 'SAR', position: 0 },
        ],
      },
      media: { create: [{ mediaAssetId: s2.id, position: 0 }] },
    },
  });

  await prisma.serviceOffering.create({
    data: {
      userId,
      title: `${SEED_MARKER} Social Content Pack`,
      description: 'Monthly social creatives for Instagram & LinkedIn.',
      category: 'Social',
      status: ServiceOfferingStatus.published,
      currency: 'SAR',
      position: 2,
      packages: {
        create: [
          {
            tier: PackageTier.basic,
            price: 900,
            currency: 'SAR',
            deliveryLabel: '5 days',
            includes: ['8 posts', 'Captions draft'],
          },
          {
            tier: PackageTier.standard,
            price: 1600,
            currency: 'SAR',
            deliveryLabel: '7 days',
            includes: ['16 posts', 'Stories set', 'Hashtag research'],
          },
          {
            tier: PackageTier.premium,
            price: 2600,
            currency: 'SAR',
            deliveryLabel: '10 days',
            includes: ['24 posts', 'Reels covers', 'Content calendar'],
          },
        ],
      },
      addons: {
        create: [
          { title: 'Extra 4 posts', price: 300, currency: 'SAR', position: 0 },
          { title: 'Arabic copywriting', price: 400, currency: 'SAR', position: 1 },
        ],
      },
      media: { create: [{ mediaAssetId: s3.id, position: 0 }] },
    },
  });
}

async function seedBusinessContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const cover = await uploadReadyAsset(
    supabase,
    userId,
    'portfolio',
    MediaPurpose.portfolio,
    `${OBJECT_PREFIX}/${userId}/portfolio/studio-1.jpg`,
    'https://images.unsplash.com/photo-1542744173-8e2bd1ad4490?w=800&h=600&fit=crop',
  );
  const cover2 = await uploadReadyAsset(
    supabase,
    userId,
    'portfolio',
    MediaPurpose.portfolio,
    `${OBJECT_PREFIX}/${userId}/portfolio/studio-2.jpg`,
    'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&h=600&fit=crop',
  );

  await prisma.portfolioProject.create({
    data: {
      userId,
      title: `${SEED_MARKER} Red Sea Resort Campaign`,
      description: 'Multi-channel brand campaign for hospitality launch.',
      position: 0,
      media: {
        create: [
          { mediaAssetId: cover.id, position: 0 },
          { mediaAssetId: cover2.id, position: 1 },
        ],
      },
    },
  });

  const svcMedia = await uploadReadyAsset(
    supabase,
    userId,
    'services',
    MediaPurpose.service,
    `${OBJECT_PREFIX}/${userId}/services/campaign.jpg`,
    'https://images.unsplash.com/photo-1557804506-669a709abc7d?w=800&h=600&fit=crop',
  );

  await prisma.serviceOffering.create({
    data: {
      userId,
      title: `${SEED_MARKER} Campaign Production Retainer`,
      description: 'Monthly creative production for growing brands.',
      category: 'Campaigns',
      status: ServiceOfferingStatus.published,
      currency: 'SAR',
      position: 0,
      packages: {
        create: [
          {
            tier: PackageTier.basic,
            price: 5000,
            currency: 'SAR',
            deliveryLabel: 'Monthly',
            includes: ['12 assets', '1 revision round'],
          },
          {
            tier: PackageTier.standard,
            price: 9000,
            currency: 'SAR',
            deliveryLabel: 'Monthly',
            includes: ['24 assets', 'Art direction calls'],
          },
          {
            tier: PackageTier.premium,
            price: 15000,
            currency: 'SAR',
            deliveryLabel: 'Monthly',
            includes: ['Full campaign', 'Motion extras', 'Priority turnaround'],
          },
        ],
      },
      addons: {
        create: [
          { title: 'On-site shoot day', price: 3500, currency: 'SAR', position: 0 },
        ],
      },
      media: { create: [{ mediaAssetId: svcMedia.id, position: 0 }] },
    },
  });
}

async function main() {
  loadEnvFile();
  assertDevSafe();

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  }

  const supabase = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: Array<{
    key: string;
    email: string;
    username: string;
    id: string;
    accountType: string;
  }> = [];

  for (const spec of specs()) {
    console.log(`\n→ Seeding ${spec.key}: ${spec.email}`);
    const authUser = await ensureAuthUser(supabase, spec);
    await upsertDomainUser(authUser.id, spec);
    await clearDevTaggedContent(authUser.id);
    if (spec.accountType === AccountType.talent) {
      await seedTalentContent(supabase, authUser.id);
    } else {
      await seedBusinessContent(supabase, authUser.id);
    }
    results.push({
      key: spec.key,
      email: spec.email,
      username: spec.username,
      id: authUser.id,
      accountType: spec.accountType,
    });
    console.log(`  ✓ ${spec.displayName} (${authUser.id})`);
  }

  console.log('\n=== Dev seed complete (idempotent) ===');
  console.log(JSON.stringify({ password: password(), users: results }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
