import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PublicProfileDto } from './dto/public-profile.dto';
import { UpdateMeDto } from './dto/user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    return this.usersService.getMe(user);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateMe(user, dto);
  }

  /** Explicit public visitor profile (no email / phone). */
  @Get(':userId/public')
  getPublicById(
    @CurrentUser() viewer: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<PublicProfileDto> {
    return this.usersService.getPublicById(userId, viewer.sub);
  }

  /**
   * Visitor profile — public fields only.
   * Private owner data remains on GET /users/me.
   */
  @Get(':userId')
  getById(
    @CurrentUser() viewer: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<PublicProfileDto> {
    return this.usersService.getPublicById(userId, viewer.sub);
  }
}
