import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  CreateApplicationDto,
  CreateJobListingDto,
  EngagementTransitionDto,
  ListJobListingsQueryDto,
  ListingTransitionDto,
  PatchApplicationDto,
  UpdateJobListingDto,
} from './dto/marketplace.dto';
import {
  AcceptApplicationResponseDto,
  EngagementEventResponseDto,
  JobApplicationResponseDto,
  JobListingResponseDto,
  JobListingsPageDto,
  WorkEngagementResponseDto,
} from './dto/marketplace-response.dto';
import { MarketplaceService } from './marketplace.service';

@Controller('job-listings')
@UseGuards(JwtAuthGuard)
export class JobListingsController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateJobListingDto,
  ): Promise<JobListingResponseDto> {
    return this.marketplace.createListing(user.sub, dto);
  }

  @Get()
  list(@Query() query: ListJobListingsQueryDto): Promise<JobListingsPageDto> {
    return this.marketplace.listListings(query);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<JobListingResponseDto> {
    return this.marketplace.getListing(user.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateJobListingDto,
  ): Promise<JobListingResponseDto> {
    return this.marketplace.updateListing(user.sub, id, dto);
  }

  @Post(':id/transitions')
  transition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ListingTransitionDto,
  ): Promise<JobListingResponseDto> {
    return this.marketplace.transitionListing(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.marketplace.softDeleteListing(user.sub, id);
  }

  @Post(':id/applications')
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateApplicationDto,
  ): Promise<JobApplicationResponseDto> {
    return this.marketplace.apply(user.sub, id, dto);
  }

  @Get(':id/applications')
  listApplications(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<JobApplicationResponseDto[]> {
    return this.marketplace.listApplicationsForListing(user.sub, id);
  }
}

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Patch(':id')
  patch(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PatchApplicationDto,
  ): Promise<JobApplicationResponseDto | AcceptApplicationResponseDto> {
    return this.marketplace.patchApplication(user.sub, id, dto);
  }
}

@Controller('engagements')
@UseGuards(JwtAuthGuard)
export class EngagementsController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get(':id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<WorkEngagementResponseDto> {
    return this.marketplace.getEngagement(user.sub, id);
  }

  @Post(':id/transitions')
  transition(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: EngagementTransitionDto,
  ): Promise<WorkEngagementResponseDto> {
    return this.marketplace.transitionEngagement(user.sub, id, dto);
  }

  @Get(':id/events')
  events(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<EngagementEventResponseDto[]> {
    return this.marketplace.listEngagementEvents(user.sub, id);
  }
}

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class MyMarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('job-listings')
  myListings(
    @CurrentUser() user: JwtPayload,
  ): Promise<JobListingResponseDto[]> {
    return this.marketplace.listMyListings(user.sub);
  }

  @Get('applications')
  myApplications(
    @CurrentUser() user: JwtPayload,
  ): Promise<JobApplicationResponseDto[]> {
    return this.marketplace.listMyApplications(user.sub);
  }

  @Get('engagements')
  myEngagements(
    @CurrentUser() user: JwtPayload,
  ): Promise<WorkEngagementResponseDto[]> {
    return this.marketplace.listMyEngagements(user.sub);
  }
}
