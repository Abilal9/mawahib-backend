import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TaxonomyService, type TaxonomyResponse } from './taxonomy.service';

/**
 * Reference data stays authenticated. Product APIs use JwtAuthGuard;
 * health is the public exception. Guest access is not part of this phase.
 */
@Controller('taxonomy')
@UseGuards(JwtAuthGuard)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  list(): Promise<TaxonomyResponse> {
    return this.taxonomy.list();
  }
}
