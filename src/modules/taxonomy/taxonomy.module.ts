import { Module } from '@nestjs/common';
import { PrismaTaxonomyRepository } from './repositories/prisma-taxonomy.repository';
import { TAXONOMY_REPOSITORY } from './repositories/taxonomy.repository';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';

@Module({
  controllers: [TaxonomyController],
  providers: [
    TaxonomyService,
    {
      provide: TAXONOMY_REPOSITORY,
      useClass: PrismaTaxonomyRepository,
    },
  ],
})
export class TaxonomyModule {}
