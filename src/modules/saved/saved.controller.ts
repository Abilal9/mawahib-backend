import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { PostsService } from '../posts/posts.service';
import type { SavedPostsPageDto } from '../posts/dto/posts-response.dto';
import { ServicesService } from '../services/services.service';
import type { ServiceOfferingResponseDto } from '../services/dto/service-response.dto';
import type { JobListingResponseDto } from '../marketplace/dto/marketplace-response.dto';

export class SavedListQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@Controller('saved')
@UseGuards(JwtAuthGuard)
export class SavedController {
  constructor(
    private readonly posts: PostsService,
    private readonly marketplace: MarketplaceService,
    private readonly services: ServicesService,
  ) {}

  @Get('posts')
  postsPage(
    @CurrentUser() user: JwtPayload,
    @Query() query: SavedListQueryDto,
  ): Promise<SavedPostsPageDto> {
    return this.posts.listSaved(user.sub, query.cursor, query.limit);
  }

  @Get('jobs')
  jobsPage(
    @CurrentUser() user: JwtPayload,
    @Query() query: SavedListQueryDto,
  ): Promise<{
    items: JobListingResponseDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return this.marketplace.listSavedJobs(user.sub, query.cursor, query.limit);
  }

  @Get('services')
  servicesPage(
    @CurrentUser() user: JwtPayload,
    @Query() query: SavedListQueryDto,
  ): Promise<{
    items: ServiceOfferingResponseDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return this.services.listSaved(user.sub, query.cursor, query.limit);
  }
}
