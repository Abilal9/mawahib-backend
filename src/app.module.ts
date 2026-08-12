import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { ServicesModule } from './modules/services/services.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    SupabaseModule,
    UsersModule,
    AuthModule,
    MediaModule,
    PortfolioModule,
    ServicesModule,
    MarketplaceModule,
    HealthModule,
  ],
})
export class AppModule {}
