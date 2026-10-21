import { Module } from '@nestjs/common';
import { PrismaTaxonomyRepository } from './repositories/prisma-taxonomy.repository';
import { TAXONOMY_REPOSITORY } from './repositories/taxonomy.repository';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyFilterService } from './taxonomy-filter.service';
import { TaxonomyService } from './taxonomy.service';

@Module({
  controllers: [TaxonomyController],
  providers: [
    TaxonomyService,
    TaxonomyFilterService,
    {
      provide: TAXONOMY_REPOSITORY,
      useClass: PrismaTaxonomyRepository,
    },
  ],
  exports: [TaxonomyFilterService],
})
export class TaxonomyModule {}
