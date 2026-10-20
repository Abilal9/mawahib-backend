import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeProfileTitle } from '../../../common/profile/profile-title';
import { normalizeSkillTerm } from '../../taxonomy/normalize-skill-term';
import {
  ProfileSkillError,
  resolveProfileSkills,
  type CatalogSkillState,
  type SkillSelectionInput,
} from '../profile-skills';
import { activeConnectionWhere } from '../../connections/connection-lifecycle';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  CreateUserInput,
  UpdateUserInput,
  UserRepository,
  UserWithProfile,
} from './user.repository';

const userInclude = {
  profile: true,
  skills: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
  },
};

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: userInclude,
    });
  }

  findByEmail(email: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: userInclude,
    });
  }

  findByUsername(username: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      include: userInclude,
    });
  }

  findByPhoneE164(phoneE164: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        profile: { phoneE164 },
      },
      include: userInclude,
    });
  }

  findVerifiedPhoneHolder(phoneE164: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        profile: { phoneE164, phoneVerified: true },
      },
      include: userInclude,
    });
  }

  createWithProfile(input: CreateUserInput): Promise<UserWithProfile> {
    return this.prisma.user.create({
      data: {
        id: input.id,
        email: input.email,
        accountType: input.accountType,
        displayName: input.displayName,
        username: input.username,
        profile: {
          create: {
            bio: input.bio ?? '',
            title: normalizeProfileTitle(input.title),
            countryCode: input.countryCode ?? null,
            locationCode: input.locationCode ?? null,
            locationCity: input.locationCity ?? null,
            locationCountry: input.locationCountry ?? null,
            phoneE164: input.phoneE164 ?? null,
            phoneVerified: input.phoneVerified ?? false,
            emailVerified: input.emailVerified ?? false,
          },
        },
      },
      include: userInclude,
    });
  }

  async updateOwn(
    id: string,
    input: UpdateUserInput,
  ): Promise<UserWithProfile> {
    const skills = input.skills;
    const skillSelections = input.skillSelections;

    return this.prisma.$transaction(async (tx) => {
      if (skills !== undefined || skillSelections !== undefined) {
        await tx.$queryRaw`
          SELECT id FROM users WHERE id = CAST(${id} AS uuid) FOR UPDATE
        `;
        const existing = await tx.userSkill.findMany({
          where: { userId: id },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        });
        const selections: SkillSelectionInput[] = (skillSelections ?? [])
          .map((item) =>
            item.skillId
              ? { skillId: item.skillId }
              : { text: item.text ?? '' },
          );
        const requestedIds = [
          ...existing.flatMap((row) => (row.skillId ? [row.skillId] : [])),
          ...selections.flatMap((item) =>
            'skillId' in item && item.skillId ? [item.skillId] : [],
          ),
        ];
        const catalog = requestedIds.length
          ? await tx.skill.findMany({
              where: { id: { in: requestedIds } },
              select: {
                id: true,
                nameEn: true,
                isActive: true,
                category: { select: { isActive: true } },
              },
            })
          : [];
        const skillsById = new Map<string, CatalogSkillState>(
          catalog.map((skill) => [
            skill.id,
            {
              id: skill.id,
              nameEn: skill.nameEn,
              active: skill.isActive && skill.category.isActive,
            },
          ]),
        );
        const customNorms = (skillSelections ?? [])
          .filter((item) => !item.skillId)
          .map((item) => normalizeSkillTerm(item.text ?? ''))
          .filter(Boolean);
        const termRows = customNorms.length
          ? await tx.skillTerm.findMany({
              where: {
                normalizedTerm: { in: customNorms },
                skill: { isActive: true, category: { isActive: true } },
              },
              select: {
                normalizedTerm: true,
                skillId: true,
                skill: { select: { nameEn: true } },
              },
            })
          : [];
        let resolved;
        try {
          resolved = resolveProfileSkills({
            existing: existing.map((row) => ({
              skill: row.skill,
              skillId: row.skillId,
            })),
            mode: skillSelections !== undefined ? 'selections' : 'legacy',
            legacyTexts: skills,
            selections,
            skillsById,
            activeTerms: new Map(
              termRows.map((term) => [
                term.normalizedTerm,
                { skillId: term.skillId, nameEn: term.skill.nameEn },
              ]),
            ),
          });
        } catch (error) {
          if (error instanceof ProfileSkillError) {
            throw new BadRequestException({
              message: error.message,
              code: error.code,
              ...error.details,
            });
          }
          throw error;
        }

        await tx.userSkill.deleteMany({ where: { userId: id } });
        if (resolved.length > 0) {
          try {
            await tx.userSkill.createMany({
              data: resolved.map((row, position) => ({
                userId: id,
                skill: row.skill,
                skillId: row.skillId,
                position,
              })),
            });
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              throw new ConflictException('Those skills conflict');
            }
            throw error;
          }
        }
      }

      return tx.user.update({
        where: { id },
        data: {
          displayName: input.displayName,
          username: input.username,
          profile: {
            upsert: {
              create: {
                bio: input.bio ?? '',
                title: normalizeProfileTitle(input.title),
                countryCode: input.countryCode ?? null,
                locationCode: input.locationCode ?? null,
                locationCity: input.locationCity ?? null,
                locationCountry: input.locationCountry ?? null,
                avatarUrl: input.avatarUrl ?? null,
                coverUrl: input.coverUrl ?? null,
                ...(input.aboutJson !== undefined
                  ? {
                      aboutJson:
                        input.aboutJson === null
                          ? Prisma.DbNull
                          : input.aboutJson,
                    }
                  : {}),
                phoneE164: input.phoneE164 ?? null,
                phoneVerified: input.phoneVerified ?? false,
                emailVerified: input.emailVerified ?? false,
              },
              update: {
                ...(input.bio !== undefined ? { bio: input.bio } : {}),
                ...(input.title !== undefined ? { title: input.title } : {}),
                ...(input.countryCode !== undefined
                  ? { countryCode: input.countryCode }
                  : {}),
                ...(input.locationCode !== undefined
                  ? { locationCode: input.locationCode }
                  : {}),
                ...(input.locationCity !== undefined
                  ? { locationCity: input.locationCity }
                  : {}),
                ...(input.locationCountry !== undefined
                  ? { locationCountry: input.locationCountry }
                  : {}),
                ...(input.avatarUrl !== undefined
                  ? { avatarUrl: input.avatarUrl }
                  : {}),
                ...(input.coverUrl !== undefined
                  ? { coverUrl: input.coverUrl }
                  : {}),
                ...(input.aboutJson !== undefined
                  ? { aboutJson: input.aboutJson ?? Prisma.DbNull }
                  : {}),
                ...(input.phoneE164 !== undefined
                  ? { phoneE164: input.phoneE164 }
                  : {}),
                ...(input.phoneVerified !== undefined
                  ? { phoneVerified: input.phoneVerified }
                  : {}),
                ...(input.emailVerified !== undefined
                  ? { emailVerified: input.emailVerified }
                  : {}),
              },
            },
          },
        },
        include: userInclude,
      });
    });
  }

  countActiveConnections(userId: string): Promise<number> {
    return this.prisma.connection.count({
      where: activeConnectionWhere(userId),
    });
  }
}
