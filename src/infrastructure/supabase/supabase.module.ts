import { Global, Module } from '@nestjs/common';
import { StorageBootstrapService } from './storage-bootstrap.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [SupabaseService, StorageBootstrapService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
