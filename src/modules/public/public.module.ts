import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import {
  PublicExploreController,
  PublicFeedController,
  PublicJobsController,
  PublicOfferingsController,
  PublicProfilesController,
  PublicTaxonomyController,
} from './public.controller';
import { PublicRepository } from './public.repository';
import { PublicService } from './public.service';

@Module({
  imports: [MediaModule, ReviewsModule, TaxonomyModule],
  controllers: [
    PublicFeedController,
    PublicProfilesController,
    PublicOfferingsController,
    PublicJobsController,
    PublicExploreController,
    PublicTaxonomyController,
  ],
  providers: [PublicRepository, PublicService],
})
export class PublicModule {}
