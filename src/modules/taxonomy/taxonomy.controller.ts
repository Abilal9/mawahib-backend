import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  TaxonomyService,
  type TaxonomyResponse,
  type TaxonomySuggestionDto,
} from './taxonomy.service';

/**
 * Authenticated taxonomy remains JWT-gated.
 * Anonymous reads use GET /public/taxonomy.
 */
@Controller('taxonomy')
@UseGuards(JwtAuthGuard)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  list(): Promise<TaxonomyResponse> {
    return this.taxonomy.list();
  }

  @Get('skills')
  suggest(
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ): Promise<TaxonomySuggestionDto[]> {
    return this.taxonomy.suggest(query, limit);
  }
}
