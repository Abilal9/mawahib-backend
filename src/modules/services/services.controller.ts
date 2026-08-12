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
  CreateServiceOfferingDto,
  ReorderServicesDto,
  UpdateServiceOfferingDto,
} from './dto/service.dto';
import { ServiceOfferingResponseDto } from './dto/service-response.dto';
import { ServicesService } from './services.service';

@Controller('users/me/services')
@UseGuards(JwtAuthGuard)
export class MyServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  listMine(
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceOfferingResponseDto[]> {
    return this.servicesService.listMine(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateServiceOfferingDto,
  ): Promise<ServiceOfferingResponseDto> {
    return this.servicesService.create(user.sub, dto);
  }

  @Put('order')
  reorder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderServicesDto,
  ): Promise<ServiceOfferingResponseDto[]> {
    return this.servicesService.reorder(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateServiceOfferingDto,
  ): Promise<ServiceOfferingResponseDto> {
    return this.servicesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.servicesService.remove(user.sub, id);
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class PublicServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get(':userId/services')
  listByUser(
    @Param('userId') userId: string,
  ): Promise<ServiceOfferingResponseDto[]> {
    return this.servicesService.listByUser(userId);
  }
}
