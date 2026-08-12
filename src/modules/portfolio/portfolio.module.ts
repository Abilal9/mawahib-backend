import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import {
  MyPortfolioController,
  PublicPortfolioController,
} from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PORTFOLIO_REPOSITORY } from './repositories/portfolio.repository';
import { PrismaPortfolioRepository } from './repositories/prisma-portfolio.repository';

@Module({
  imports: [MediaModule],
  controllers: [MyPortfolioController, PublicPortfolioController],
  providers: [
    PortfolioService,
    {
      provide: PORTFOLIO_REPOSITORY,
      useClass: PrismaPortfolioRepository,
    },
  ],
  exports: [PortfolioService],
})
export class PortfolioModule {}
