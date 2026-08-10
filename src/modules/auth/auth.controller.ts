import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BootstrapAuthDto } from '../users/dto/user.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import type { JwtPayload } from './strategies/jwt.strategy';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Idempotent: creates the app user + empty profile on first authenticated call.
   */
  @Post('bootstrap')
  bootstrap(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BootstrapAuthDto,
  ): Promise<UserResponseDto> {
    return this.usersService.bootstrap(user, dto);
  }
}
