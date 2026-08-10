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
    // email column is CITEXT — equality is case-insensitive in Postgres.
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
              },
            },
          },
        },
        include: userInclude,
      });
    });
  }
}
