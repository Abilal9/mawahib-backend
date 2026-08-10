import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            checkConnectivity: () => Promise.resolve('connected'),
          },
        },
        {
          provide: SupabaseService,
          useValue: {
            getStatus: () => 'configured',
          },
        },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('returns ok when database and supabase are ready', async () => {
    const result = await service.getHealth();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('mawahib-backend');
    expect(result.database).toBe('connected');
    expect(result.supabase).toBe('configured');
    expect(result.timestamp).toBeDefined();
  });
});
