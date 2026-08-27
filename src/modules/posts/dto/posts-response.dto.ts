export type FeedSourceDto = 'self' | 'connection' | 'discovery';

export type RelationshipStatusDto =
  | 'self'
  | 'none'
  | 'outgoing'
  | 'incoming'
  | 'connected';

export class FeedAuthorDto {
  id!: string;
  username!: string;
  displayName!: string;
  avatarUrl!: string | null;
  accountType!: string;
  title!: string | null;
  isVerified!: boolean;
  locationCity!: string | null;
  locationCountry!: string | null;
}

export class FeedRelationshipDto {
  status!: RelationshipStatusDto;
  connectionRequestId!: string | null;
}

export class FeedMediaDto {
  mediaAssetId!: string;
  url!: string | null;
  position!: number;
}

export class FeedEngagementDto {
  likeCount!: number;
  commentCount!: number;
  isLiked!: boolean;
  isSaved!: boolean;
}

export class FeedPostDto {
  id!: string;
  feedSource!: FeedSourceDto;
  author!: FeedAuthorDto;
  relationship!: FeedRelationshipDto;
  text!: string;
  visibility!: string;
  media!: FeedMediaDto[];
  engagement!: FeedEngagementDto;
  createdAt!: string;
  updatedAt!: string;
}

export class FeedPageDto {
  items!: FeedPostDto[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

export class PostCommentDto {
  id!: string;
  postId!: string;
  text!: string;
  createdAt!: string;
  author!: FeedAuthorDto;
  /** True when viewer is the comment author or the post owner. */
  canDelete!: boolean;
}

export class CommentsPageDto {
  items!: PostCommentDto[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

export class PostLikersPageDto {
  items!: FeedAuthorDto[];
  nextCursor!: string | null;
  hasMore!: boolean;
}

export class EngagementMutationDto {
  likeCount!: number;
  commentCount!: number;
  isLiked!: boolean;
  isSaved!: boolean;
}
