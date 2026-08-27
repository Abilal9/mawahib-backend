import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  CommentsQueryDto,
  CreateCommentDto,
  CreatePostDto,
  FeedQueryDto,
  LikesQueryDto,
} from './dto/posts.dto';
import {
  CommentsPageDto,
  EngagementMutationDto,
  FeedPageDto,
  FeedPostDto,
  PostCommentDto,
  PostLikersPageDto,
} from './dto/posts-response.dto';
import { PostsService } from './posts.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get('feed')
  listFeed(
    @CurrentUser() user: JwtPayload,
    @Query() query: FeedQueryDto,
  ): Promise<FeedPageDto> {
    return this.posts.listFeed(user.sub, query.cursor, query.limit);
  }

  @Post('posts')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePostDto,
  ): Promise<FeedPostDto> {
    return this.posts.create(user.sub, dto);
  }

  @Get('posts/:id')
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FeedPostDto> {
    return this.posts.getById(user.sub, id);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  async softDelete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.posts.softDelete(user.sub, id);
  }

  @Post('posts/:id/likes')
  @HttpCode(200)
  like(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EngagementMutationDto> {
    return this.posts.like(user.sub, id);
  }

  @Delete('posts/:id/likes')
  @HttpCode(200)
  unlike(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EngagementMutationDto> {
    return this.posts.unlike(user.sub, id);
  }

  @Get('posts/:id/likes')
  listLikes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LikesQueryDto,
  ): Promise<PostLikersPageDto> {
    return this.posts.listLikes(user.sub, id, query.cursor, query.limit);
  }

  @Post('posts/:id/saves')
  @HttpCode(200)
  save(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EngagementMutationDto> {
    return this.posts.save(user.sub, id);
  }

  @Delete('posts/:id/saves')
  @HttpCode(200)
  unsave(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EngagementMutationDto> {
    return this.posts.unsave(user.sub, id);
  }

  @Get('posts/:id/comments')
  listComments(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CommentsQueryDto,
  ): Promise<CommentsPageDto> {
    return this.posts.listComments(user.sub, id, query.cursor, query.limit);
  }

  @Post('posts/:id/comments')
  createComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<PostCommentDto> {
    return this.posts.createComment(user.sub, id, dto);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async deleteComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.posts.deleteComment(user.sub, id);
  }

  @Get('users/:userId/posts')
  listUserPosts(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: FeedQueryDto,
  ): Promise<FeedPageDto> {
    return this.posts.listUserPosts(user.sub, userId, query.cursor, query.limit);
  }
}
