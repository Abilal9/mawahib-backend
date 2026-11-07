import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PublicDiscoveryRateLimitGuard } from './common/guards/public-discovery-rate-limit.guard';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { ExploreModule } from './modules/explore/explore.module';
import { HealthModule } from './modules/health/health.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { MediaModule } from './modules/media/media.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { PostsModule } from './modules/posts/posts.module';
import { PublicModule } from './modules/public/public.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SavedModule } from './modules/saved/saved.module';
import { ServicesModule } from './modules/services/services.module';
import { StaffModule } from './modules/staff/staff.module';
import { TaxonomyModule } from './modules/taxonomy/taxonomy.module';
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
    StaffModule,
    NotificationsModule,
    MessagingModule,
    ConnectionsModule,
    MarketplaceModule,
    InvoicesModule,
    PaymentsModule,
    ExploreModule,
    TaxonomyModule,
    PostsModule,
    PublicModule,
    ReviewsModule,
    ReportsModule,
    SavedModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: PublicDiscoveryRateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
