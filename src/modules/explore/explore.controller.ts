import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  ExploreServiceQueryDto,
  ExploreTalentQueryDto,
} from './dto/explore-query.dto';
import {
  ExploreService,
  ExploreServicePageDto,
  ExploreTalentPageDto,
} from './explore.service';

@Controller('explore')
@UseGuards(JwtAuthGuard)
export class ExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get('talents')
  listTalents(
    @CurrentUser() user: JwtPayload,
    @Query() query: ExploreTalentQueryDto,
  ): Promise<ExploreTalentPageDto> {
    return this.explore.listTalents(user.sub, query);
  }

  @Get('services')
  listServices(
    @CurrentUser() user: JwtPayload,
    @Query() query: ExploreServiceQueryDto,
  ): Promise<ExploreServicePageDto> {
    return this.explore.listServices(user.sub, query);
  }
}
