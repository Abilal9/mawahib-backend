import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            getDatabaseStatus: () => 'not_configured',
          },
        },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('returns ok with database status', () => {
    const result = service.getHealth();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('mawahib-backend');
    expect(result.database).toBe('not_configured');
    expect(result.timestamp).toBeDefined();
  });
});
