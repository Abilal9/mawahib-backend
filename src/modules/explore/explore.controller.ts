import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  ExploreProfileDto,
  ExploreService,
  ExploreServiceDto,
} from './explore.service';

@Controller('explore')
@UseGuards(JwtAuthGuard)
export class ExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get('talents')
  listTalents(): Promise<ExploreProfileDto[]> {
    return this.explore.listProfiles(AccountType.talent);
  }

  @Get('businesses')
  listBusinesses(): Promise<ExploreProfileDto[]> {
    return this.explore.listProfiles(AccountType.business);
  }

  @Get('services')
  listServices(): Promise<ExploreServiceDto[]> {
    return this.explore.listPublishedServices();
  }
}
