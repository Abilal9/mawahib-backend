import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestAuthIdentity } from '../auth/strategies/jwt.strategy';
import { CreateReportDto } from './report.dto';
import { ReportRateLimited, ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: RequestAuthIdentity,
    @Body() body: CreateReportDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.reports.submit(user.sub, body);
      if (result.alreadyReported) response.status(200);
      return result;
    } catch (error) {
      if (error instanceof ReportRateLimited) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
