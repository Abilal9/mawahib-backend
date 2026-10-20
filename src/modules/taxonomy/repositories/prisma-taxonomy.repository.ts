import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  TaxonomyCategoryRecord,
  TaxonomyRepository,
  TaxonomyTermMatch,
} from './taxonomy.repository';

const taxonomySelect = {
  id: true,
  slug: true,
  nameEn: true,
  nameAr: true,
  sortOrder: true,
  isActive: true,
  skills: {
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      categoryId: true,
      slug: true,
      nameEn: true,
      nameAr: true,
      sortOrder: true,
      isActive: true,
    },
  },
} satisfies Prisma.CategorySelect;

@Injectable()
export class PrismaTaxonomyRepository implements TaxonomyRepository {
  constructor(private readonly prisma: PrismaService) {}

  listActive(): Promise<TaxonomyCategoryRecord[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }, { id: 'asc' }],
      select: taxonomySelect,
    });
  }

  async matchTerms(normalizedQuery: string): Promise<TaxonomyTermMatch[]> {
    // One- and two-character queries stay prefix-only. Contains search on
    // those strings matches too much of the catalog to be useful.
    const termMatch =
      normalizedQuery.length >= 3
        ? { contains: normalizedQuery }
        : { startsWith: normalizedQuery };
    const rows = await this.prisma.skillTerm.findMany({
      where: {
        normalizedTerm: termMatch,
        skill: { isActive: true, category: { isActive: true } },
      },
      orderBy: [{ normalizedTerm: 'asc' }, { id: 'asc' }],
      select: {
        term: true,
        normalizedTerm: true,
        skill: {
          select: {
            id: true,
            categoryId: true,
            slug: true,
            nameEn: true,
            nameAr: true,
            sortOrder: true,
            isActive: true,
            category: { select: { sortOrder: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      term: row.term,
      normalizedTerm: row.normalizedTerm,
      skill: {
        id: row.skill.id,
        categoryId: row.skill.categoryId,
        slug: row.skill.slug,
        nameEn: row.skill.nameEn,
        nameAr: row.skill.nameAr,
        sortOrder: row.skill.sortOrder,
        isActive: row.skill.isActive,
        categorySortOrder: row.skill.category.sortOrder,
      },
    }));
  }
}
