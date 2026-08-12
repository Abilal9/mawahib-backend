import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  CreatePortfolioProjectDto,
  ReorderPortfolioDto,
  UpdatePortfolioProjectDto,
} from './dto/portfolio.dto';
import { PortfolioProjectResponseDto } from './dto/portfolio-response.dto';
import { PortfolioService } from './portfolio.service';

@Controller('users/me/portfolio')
@UseGuards(JwtAuthGuard)
export class MyPortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  listMine(
    @CurrentUser() user: JwtPayload,
  ): Promise<PortfolioProjectResponseDto[]> {
    return this.portfolioService.listMine(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePortfolioProjectDto,
  ): Promise<PortfolioProjectResponseDto> {
    return this.portfolioService.create(user.sub, dto);
  }

  @Put('order')
  reorder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderPortfolioDto,
  ): Promise<PortfolioProjectResponseDto[]> {
    return this.portfolioService.reorder(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePortfolioProjectDto,
  ): Promise<PortfolioProjectResponseDto> {
    return this.portfolioService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.portfolioService.remove(user.sub, id);
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class PublicPortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get(':userId/portfolio')
  listByUser(
    @Param('userId') userId: string,
  ): Promise<PortfolioProjectResponseDto[]> {
    return this.portfolioService.listByUser(userId);
  }
}
