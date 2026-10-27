import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MediaModule } from '../media/media.module';
import { ReviewClock } from './review-clock';
import { ReviewClockInterceptor } from './review-clock.interceptor';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [MediaModule],
  providers: [
    ReviewClock,
    ReviewsService,
    { provide: APP_INTERCEPTOR, useClass: ReviewClockInterceptor },
  ],
  exports: [ReviewClock, ReviewsService],
})
export class ReviewsModule {}
