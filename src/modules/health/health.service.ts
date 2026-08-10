import { Injectable } from '@nestjs/common';
import {
  DatabaseStatus,
  PrismaService,
} from '../../infrastructure/database/prisma.service';

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  database: DatabaseStatus;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'mawahib-backend',
      timestamp: new Date().toISOString(),
      database: this.prisma.getDatabaseStatus(),
    };
  }
}
