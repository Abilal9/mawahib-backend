/**
 * Comprehensive development seed (Phase 1–3).
 *
 * Run: ALLOW_DEV_SEED=true npm run seed:dev
 *
 * Safety:
 * - Requires ALLOW_DEV_SEED=true
 * - Only mutates known @mawahib.dev accounts and their owned seed data
 * - Idempotent via deterministic IDs + replace of seed-owned content
 */
import { createClient } from '@supabase/supabase-js';
import { AccountType, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { seedMarketplace } from './seed/marketplace';
import {
  clearSeedOwnedContent,
  seedUserSpecs,
  upsertDomainUser,
  type SeedUserSpec,
} from './seed/profiles';
import {
  seedBusinessProfessional,
  seedTalentProfessional,
} from './seed/professional';

const prisma = new PrismaClient();

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
  if (process.env.ALLOW_DEV_SEED !== 'true') {
    throw new Error(
      'Refusing seed:dev. Set ALLOW_DEV_SEED=true in your local .env to run the development seed.',
    );
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: Running seed:dev with NODE_ENV=production. ALLOW_DEV_SEED=true was set deliberately.',
    );
  }
}

function password(): string {
  return process.env.DEV_SEED_PASSWORD || 'MawahibDev1!';
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
  let page = 1;
  while (page <= 10) {
    const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (listErr) throw listErr;
    const found = listed.users.find(
      (u: { email?: string }) =>
        u.email?.toLowerCase() === spec.email.toLowerCase(),
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

  const specs = seedUserSpecs(password());
  const byKey: Record<string, { id: string; spec: SeedUserSpec }> = {};

  for (const spec of specs) {
    console.log(`\n→ Seeding ${spec.key}: ${spec.email}`);
    const authUser = await ensureAuthUser(supabase, spec);
    await clearSeedOwnedContent(prisma, authUser.id);
    await upsertDomainUser(prisma, supabase, authUser.id, spec);
    if (spec.accountType === AccountType.talent) {
      await seedTalentProfessional(prisma, supabase, authUser.id);
    } else {
      await seedBusinessProfessional(prisma, supabase, authUser.id);
    }
    byKey[spec.key] = { id: authUser.id, spec };
    console.log(`  ✓ ${spec.displayName} (${authUser.id})`);
  }

  const talentId = byKey.talent!.id;
  const businessId = byKey.business!.id;

  console.log(
    '\n→ Seeding marketplace (listings / applications / work requests / engagements)',
  );
  const market = await seedMarketplace(prisma, talentId, businessId);
  console.log(
    `  ✓ listings=${market.listings} applications=${market.applications} workRequests=${market.workRequests} engagements=${market.engagements}`,
  );

  const [portfolioCount, serviceCount, mediaCount, openListings] =
    await Promise.all([
      prisma.portfolioProject.count({
        where: { userId: { in: [talentId, businessId] } },
      }),
      prisma.serviceOffering.count({
        where: { userId: { in: [talentId, businessId] } },
      }),
      prisma.mediaAsset.count({
        where: {
          ownerId: { in: [talentId, businessId] },
          objectKey: { startsWith: 'dev-seed/' },
        },
      }),
      prisma.jobListing.count({
        where: { posterId: businessId, status: 'open' },
      }),
    ]);

  console.log('\n=== Dev seed complete (idempotent) ===');
  console.log(
    JSON.stringify(
      {
        password: password(),
        users: Object.values(byKey).map(({ id, spec }) => ({
          key: spec.key,
          email: spec.email,
          username: spec.username,
          id,
          accountType: spec.accountType,
        })),
        counts: {
          portfolioProjects: portfolioCount,
          services: serviceCount,
          mediaAssets: mediaCount,
          jobListings: market.listings,
          openJobListings: openListings,
          applications: market.applications,
          workRequests: market.workRequests,
          engagements: market.engagements,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
