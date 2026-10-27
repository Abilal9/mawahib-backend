import { readFileSync } from 'fs';
import { join } from 'path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SavedController } from '../saved/saved.controller';
import { ServiceSavesController } from './services.controller';

describe('saved service behavior', () => {
  it('guards service saves with the central JWT guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ServiceSavesController,
    ) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    const saved = Reflect.getMetadata(GUARDS_METADATA, SavedController) as unknown[];
    expect(saved).toContain(JwtAuthGuard);
  });
});

describe('saved table lockdown migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../prisma/migrations/20261027190000_saved_jobs_and_services/migration.sql',
    ),
    'utf8',
  );

  it('revokes client roles and enables RLS without policies', () => {
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.job_saves FROM anon, authenticated;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.service_saves FROM anon, authenticated;',
    );
    expect(sql).toContain('ALTER TABLE public.job_saves ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'ALTER TABLE public.service_saves ENABLE ROW LEVEL SECURITY;',
    );
    expect(sql).not.toContain('CREATE POLICY');
    expect(sql).not.toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('ON DELETE CASCADE');
  });
});
