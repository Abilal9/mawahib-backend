import { Injectable, NotFoundException } from '@nestjs/common';
import { ServiceOfferingStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { resolveCanonicalTaxonomy } from '../../taxonomy/canonical-taxonomy';
import {
  resolveCustomCategory,
  taxonomyColumnPatch,
} from '../../taxonomy/custom-category';
import {
  CreateServiceOfferingInput,
  ServiceOfferingRepository,
  ServiceOfferingWithDetails,
  UpdateServiceOfferingInput,
} from './service-offering.repository';

const detailsInclude = {
  packages: { orderBy: { tier: 'asc' as const } },
  addons: { orderBy: { position: 'asc' as const } },
  media: {
    include: { mediaAsset: true },
    orderBy: { position: 'asc' as const },
  },
  taxonomyCategory: { select: { id: true, nameEn: true } },
  taxonomySkills: {
    orderBy: { position: 'asc' as const },
    select: {
      position: true,
      skill: { select: { id: true, nameEn: true } },
    },
  },
};

@Injectable()
export class PrismaServiceOfferingRepository implements ServiceOfferingRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByUser(
    userId: string,
    opts?: { publishedOnly?: boolean },
  ): Promise<ServiceOfferingWithDetails[]> {
    return this.prisma.serviceOffering.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(opts?.publishedOnly
          ? { status: ServiceOfferingStatus.published }
          : {}),
      },
      include: detailsInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });
  }

  findById(id: string): Promise<ServiceOfferingWithDetails | null> {
    return this.prisma.serviceOffering.findFirst({
      where: { id, deletedAt: null },
      include: detailsInclude,
    });
  }

  create(
    input: CreateServiceOfferingInput,
  ): Promise<ServiceOfferingWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      const taxonomy = await resolveCanonicalTaxonomy(tx, {
        categoryId: input.categoryId,
        skillIds: input.skillIds ?? [],
        requireCategory: true,
      });
      const custom = await resolveCustomCategory(tx, {
        resultingCategoryId: taxonomy.category!.id,
        customCategory: input.customCategory,
        existingCustomCategory: null,
      });
      const columns = taxonomyColumnPatch({
        category: taxonomy.category,
        custom,
        existingCustomCategory: null,
      });
      return tx.serviceOffering.create({
      data: {
        id: input.id,
        userId: input.userId,
        title: input.title,
        description: input.description,
        categoryId: columns.categoryId,
        customCategory: columns.customCategory ?? null,
        category: columns.legacyLabel,
        position: input.position,
        currency: input.currency,
        status: ServiceOfferingStatus.published,
        taxonomySkills: {
          create: (taxonomy.skills ?? []).map((skill) => ({
            skillId: skill.id,
            position: skill.position,
          })),
        },
        packages: {
          create: input.packages.map((p) => ({
            tier: p.tier,
            price: p.price,
            currency: p.currency,
            deliveryLabel: p.deliveryLabel,
            includes: p.includes,
          })),
        },
        addons: {
          create: input.addons.map((a) => ({
            title: a.title,
            price: a.price,
            currency: a.currency,
            position: a.position,
          })),
        },
        media: {
          create: input.media.map((m) => ({
            mediaAssetId: m.mediaAssetId,
            position: m.position,
            isVideo: m.isVideo,
          })),
        },
      },
      include: detailsInclude,
    });
    });
  }

  async update(
    id: string,
    userId: string,
    input: UpdateServiceOfferingInput,
  ): Promise<ServiceOfferingWithDetails> {
    const existing = await this.prisma.serviceOffering.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Service offering not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM service_offerings
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      const current = await tx.serviceOffering.findFirst({
        where: { id, userId, deletedAt: null },
        include: { taxonomySkills: { select: { skillId: true } } },
      });
      if (!current) {
        throw new NotFoundException('Service offering not found');
      }
      const taxonomy = await resolveCanonicalTaxonomy(tx, {
        categoryId: input.categoryId,
        skillIds: input.skillIds,
        existingCategoryId: current.categoryId,
        existingSkillIds: current.taxonomySkills.map((row) => row.skillId),
        requireCategory: false,
      });
      const custom = await resolveCustomCategory(tx, {
        resultingCategoryId: taxonomy.category?.id ?? current.categoryId,
        customCategory: input.customCategory,
        existingCustomCategory: current.customCategory,
      });
      const columns = taxonomyColumnPatch({
        category: taxonomy.category,
        custom,
        existingCustomCategory: current.customCategory,
      });
      if (input.packages) {
        await tx.servicePackage.deleteMany({ where: { offeringId: id } });
        await tx.servicePackage.createMany({
          data: input.packages.map((p) => ({
            offeringId: id,
            tier: p.tier,
            price: p.price,
            currency: p.currency,
            deliveryLabel: p.deliveryLabel,
            includes: p.includes,
          })),
        });
      }
      if (input.addons) {
        await tx.serviceAddon.deleteMany({ where: { offeringId: id } });
        await tx.serviceAddon.createMany({
          data: input.addons.map((a) => ({
            offeringId: id,
            title: a.title,
            price: a.price,
            currency: a.currency,
            position: a.position,
          })),
        });
      }
      if (input.media) {
        await tx.serviceMedia.deleteMany({ where: { offeringId: id } });
        await tx.serviceMedia.createMany({
          data: input.media.map((m) => ({
            offeringId: id,
            mediaAssetId: m.mediaAssetId,
            position: m.position,
            isVideo: m.isVideo,
          })),
        });
      }
      if (taxonomy.skills) {
        await tx.serviceSkill.deleteMany({ where: { offeringId: id } });
        if (taxonomy.skills.length > 0) {
          await tx.serviceSkill.createMany({
            data: taxonomy.skills.map((skill) => ({
              offeringId: id,
              skillId: skill.id,
              position: skill.position,
            })),
          });
        }
      }

      return tx.serviceOffering.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          status: input.status,
          ...(columns.categoryId
            ? {
                categoryId: columns.categoryId,
                category: columns.legacyLabel,
              }
            : columns.legacyLabel
              ? { category: columns.legacyLabel }
              : {}),
          ...(columns.customCategory !== undefined
            ? { customCategory: columns.customCategory }
            : {}),
        },
        include: detailsInclude,
      });
    });
  }

  async softDelete(id: string, userId: string): Promise<void> {
    const result = await this.prisma.serviceOffering.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Service offering not found');
    }
  }

  async reorder(userId: string, offeringIds: string[]): Promise<void> {
    await this.prisma.$transaction(
      offeringIds.map((id, index) =>
        this.prisma.serviceOffering.updateMany({
          where: { id, userId, deletedAt: null },
          data: { position: index },
        }),
      ),
    );
  }

  countByUser(userId: string): Promise<number> {
    return this.prisma.serviceOffering.count({
      where: { userId, deletedAt: null },
    });
  }
}
