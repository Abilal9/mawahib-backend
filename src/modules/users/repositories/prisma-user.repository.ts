import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  CreateUserInput,
  UpdateUserInput,
  UserRepository,
  UserWithProfile,
} from './user.repository';

const userInclude = {
  profile: true,
  skills: true,
} as const;

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
            title: input.title ?? null,
            locationCity: input.locationCity ?? null,
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

    return this.prisma.$transaction(async (tx) => {
      if (skills !== undefined) {
        await tx.userSkill.deleteMany({ where: { userId: id } });
        if (skills.length > 0) {
          await tx.userSkill.createMany({
            data: skills.map((skill) => ({
              userId: id,
              skill: skill.trim(),
            })),
          });
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
                title: input.title ?? null,
                locationCity: input.locationCity ?? null,
                locationCountry: input.locationCountry ?? null,
                avatarUrl: input.avatarUrl ?? null,
                coverUrl: input.coverUrl ?? null,
                phoneE164: input.phoneE164 ?? null,
                phoneVerified: input.phoneVerified ?? false,
                emailVerified: input.emailVerified ?? false,
              },
              update: {
                ...(input.bio !== undefined ? { bio: input.bio } : {}),
                ...(input.title !== undefined ? { title: input.title } : {}),
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
}
