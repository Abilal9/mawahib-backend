import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env.schema';

export type StorageBucket = 'avatars' | 'portfolio' | 'services' | 'messages';

export interface SignedUploadResult {
  path: string;
  token: string;
  signedUrl: string;
}

/**
 * Server-side Supabase client (secret key) for Auth admin / Storage.
 * Domain data access goes through Prisma — do not use supabase.from() for
 * application tables in controllers or services.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient | null;
  private readonly supabaseUrl: string | undefined;

  constructor(private readonly config: ConfigService<Env, true>) {
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const secretKey = this.config.get('SUPABASE_SECRET_KEY', { infer: true });
    this.supabaseUrl = url;

    if (url && secretKey) {
      this.client = createClient(url, secretKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      this.logger.log('Supabase server client: configured');
    } else {
      this.client = null;
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_SECRET_KEY not set — Supabase client unavailable',
      );
    }
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getStatus(): 'configured' | 'not_configured' {
    return this.client ? 'configured' : 'not_configured';
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Supabase Storage is not configured',
      );
    }
    return this.client;
  }

  async ensureBuckets(): Promise<void> {
    const client = this.requireClient();
    const specs: Array<{
      id: StorageBucket;
      public: boolean;
      fileSizeLimit: number;
      allowedMimeTypes: string[];
    }> = [
      {
        id: 'avatars',
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
      {
        id: 'portfolio',
        public: false,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'video/mp4',
          'video/quicktime',
        ],
      },
      {
        id: 'services',
        public: false,
        fileSizeLimit: 20 * 1024 * 1024,
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
        ],
      },
      {
        id: 'messages',
        public: false,
        fileSizeLimit: 20 * 1024 * 1024,
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf',
        ],
      },
    ];

    for (const spec of specs) {
      const { data: existing } = await client.storage.getBucket(spec.id);
      if (existing) {
        await client.storage.updateBucket(spec.id, {
          public: spec.public,
          fileSizeLimit: spec.fileSizeLimit,
          allowedMimeTypes: spec.allowedMimeTypes,
        });
        continue;
      }
      const { error } = await client.storage.createBucket(spec.id, {
        public: spec.public,
        fileSizeLimit: spec.fileSizeLimit,
        allowedMimeTypes: spec.allowedMimeTypes,
      });
      if (error && !/already exists/i.test(error.message)) {
        this.logger.warn(`Bucket ${spec.id}: ${error.message}`);
      } else {
        this.logger.log(`Storage bucket ready: ${spec.id}`);
      }
    }
  }

  async createSignedUpload(
    bucket: StorageBucket,
    objectKey: string,
  ): Promise<SignedUploadResult> {
    const client = this.requireClient();
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUploadUrl(objectKey, { upsert: false });
    if (error || !data) {
      throw new ServiceUnavailableException(
        error?.message ?? 'Failed to create signed upload URL',
      );
    }
    return {
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
    };
  }

  async objectExists(
    bucket: StorageBucket,
    objectKey: string,
  ): Promise<boolean> {
    const client = this.requireClient();
    const folder = objectKey.includes('/')
      ? objectKey.slice(0, objectKey.lastIndexOf('/'))
      : '';
    const fileName = objectKey.includes('/')
      ? objectKey.slice(objectKey.lastIndexOf('/') + 1)
      : objectKey;
    const { data, error } = await client.storage.from(bucket).list(folder, {
      search: fileName,
      limit: 100,
    });
    if (error) {
      this.logger.warn(`objectExists list failed: ${error.message}`);
      return false;
    }
    return (data ?? []).some((obj) => obj.name === fileName);
  }

  getPublicUrl(bucket: StorageBucket, objectKey: string): string {
    const client = this.requireClient();
    const { data } = client.storage.from(bucket).getPublicUrl(objectKey);
    return data.publicUrl;
  }

  async createSignedReadUrl(
    bucket: StorageBucket,
    objectKey: string,
    expiresInSeconds = 60 * 60,
  ): Promise<string> {
    if (bucket === 'avatars') {
      return this.getPublicUrl(bucket, objectKey);
    }
    const client = this.requireClient();
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrl(objectKey, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new ServiceUnavailableException(
        error?.message ?? 'Failed to create signed read URL',
      );
    }
    return data.signedUrl;
  }
}
