import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  TaxonomyCategoryRecord,
  TaxonomyRepository,
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
}
