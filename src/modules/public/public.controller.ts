import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import {
  PublicFeedQueryDto,
  PublicListQueryDto,
  PublicSearchQueryDto,
} from './dto/public-query.dto';
import { PublicService } from './public.service';

@Public()
@Controller('public')
export class PublicFeedController {
  constructor(private readonly publicApi: PublicService) {}

  @Get('feed')
  listFeed(@Query() query: PublicFeedQueryDto) {
    return this.publicApi.listFeed(query);
  }

  @Get('posts/:id')
  getPost(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.getPost(id);
  }
}

@Public()
@Controller('public')
export class PublicProfilesController {
  constructor(private readonly publicApi: PublicService) {}

  @Get('users/:id')
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.getProfile(id);
  }

  @Get('users/:id/posts')
  listPosts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicListQueryDto,
  ) {
    return this.publicApi.listUserPosts(id, query);
  }

  @Get('users/:id/services')
  listServices(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.listUserServices(id);
  }

  @Get('users/:id/portfolio')
  listPortfolio(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.listUserPortfolio(id);
  }

  @Get('users/:id/reviews')
  listReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicListQueryDto,
  ) {
    return this.publicApi.listUserReviews(id, query);
  }
}

@Public()
@Controller('public')
export class PublicOfferingsController {
  constructor(private readonly publicApi: PublicService) {}

  @Get('services/:id')
  getService(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.getService(id);
  }

  @Get('services/:id/reviews')
  listReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicListQueryDto,
  ) {
    return this.publicApi.listServiceReviews(id, query);
  }
}

@Public()
@Controller('public')
export class PublicJobsController {
  constructor(private readonly publicApi: PublicService) {}

  @Get('job-listings')
  listJobs(@Query() query: PublicSearchQueryDto) {
    return this.publicApi.listJobs(query);
  }

  @Get('job-listings/:id')
  getJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApi.getJob(id);
  }
}

@Public()
@Controller('public')
export class PublicExploreController {
  constructor(private readonly publicApi: PublicService) {}

  @Get('explore/talents')
  listTalents(@Query() query: PublicSearchQueryDto) {
    return this.publicApi.listExploreTalents(query);
  }

  @Get('explore/services')
  listServices(@Query() query: PublicSearchQueryDto) {
    return this.publicApi.listExploreServices(query);
  }
}

@Public()
@Controller('public')
export class PublicTaxonomyController {
  constructor(private readonly publicApi: PublicService) {}

  @Get('taxonomy')
  listTaxonomy() {
    return this.publicApi.listTaxonomy();
  }
}
