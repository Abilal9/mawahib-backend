import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env.schema';
import {
  SIGNED_READ_URL_TTL_SECONDS,
  SignedReadUrlCache,
} from './signed-read-url-cache';

export type StorageBucket =
  | 'avatars'
  | 'portfolio'
  | 'services'
  | 'messages'
  | 'posts'
  | 'covers'
  | 'work-requests'
  | 'invoices'
  | 'reviews';

export interface SignedUploadResult {
  path: string;
  token: string;
  signedUrl: string;
}

export interface StoredObjectMeta {
  byteSize: number;
  mimeType: string;
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
  /**
   * Reuses signatures only. Does not record who was allowed to see the object.
   */
  private readonly signedReadUrls = new SignedReadUrlCache();

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

  /**
   * Trusted Auth identity + verification from Supabase Admin.
   * Never trust client-supplied emailVerified / phoneVerified.
   */
  async getAuthVerification(userId: string): Promise<{
    email: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    phone: string | null;
    /** False when Supabase admin lookup was unavailable — do not overwrite Nest flags. */
    trusted: boolean;
  }> {
    if (!this.client) {
      this.logger.warn(
        'getAuthVerification skipped — SUPABASE_URL / SUPABASE_SECRET_KEY not set',
      );
      return {
        email: null,
        emailVerified: false,
        phoneVerified: false,
        phone: null,
        trusted: false,
      };
    }
    const { data, error } = await this.client.auth.admin.getUserById(userId);
    if (error || !data.user) {
      this.logger.warn(
        `getAuthVerification failed for ${userId}: ${error?.message ?? 'no user'}`,
      );
      return {
        email: null,
        emailVerified: false,
        phoneVerified: false,
        phone: null,
        trusted: false,
      };
    }
    return {
      email: data.user.email?.trim().toLowerCase() || null,
      emailVerified: Boolean(data.user.email_confirmed_at),
      phoneVerified: Boolean(data.user.phone_confirmed_at),
      phone: data.user.phone?.trim() || null,
      trusted: true,
    };
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
      {
        id: 'posts',
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
        id: 'covers',
        public: true,
        fileSizeLimit: 8 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
      {
        id: 'work-requests',
        public: false,
        fileSizeLimit: 20 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      },
      {
        id: 'invoices',
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['application/pdf'],
      },
      {
        id: 'reviews',
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
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

  /** Server-side upload (e.g. generated invoice PDFs). Never overwrites. */
  async uploadObject(
    bucket: StorageBucket,
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.storage
      .from(bucket)
      .upload(objectKey, body, { contentType, upsert: false });
    if (error) {
      throw new ServiceUnavailableException(
        error.message ?? 'Failed to upload object to storage',
      );
    }
  }

  /**
   * Metadata of the stored object. Null when the object is missing.
   * Throws when storage cannot be read, so callers do not treat an
   * unverified upload as ready.
   */
  async getStoredObjectMeta(
    bucket: StorageBucket,
    objectKey: string,
  ): Promise<StoredObjectMeta | null> {
    const client = this.requireClient();
    const { data, error } = await client.storage.from(bucket).info(objectKey);
    if (error || !data) {
      const status = error?.status;
      const message = error?.message ?? '';
      if (status === 400 || status === 404 || /not found/i.test(message)) {
        return null;
      }
      this.logger.warn(`getStoredObjectMeta failed: ${message}`);
      throw new ServiceUnavailableException(
        'Could not verify the uploaded object',
      );
    }
    const byteSize = typeof data.size === 'number' ? data.size : Number.NaN;
    const rawType = data.contentType ?? '';
    const mimeType = rawType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!Number.isFinite(byteSize) || byteSize < 0 || !mimeType) {
      throw new ServiceUnavailableException(
        'Uploaded object metadata is incomplete',
      );
    }
    return { byteSize, mimeType };
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

  /**
   * Signed read URL for a private object, or the public URL for avatars/covers.
   *
   * This method does not authorize the caller. Services must decide that the
   * current user may read the object before calling it. The in-memory cache
   * only avoids minting a new signature for the same storage path.
   */
  async createSignedReadUrl(
    bucket: StorageBucket,
    objectKey: string,
    expiresInSeconds = SIGNED_READ_URL_TTL_SECONDS,
  ): Promise<string> {
    if (bucket === 'avatars' || bucket === 'covers') {
      return this.getPublicUrl(bucket, objectKey);
    }
    const cached = this.signedReadUrls.get(bucket, objectKey, expiresInSeconds);
    if (cached) return cached;
    const client = this.requireClient();
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrl(objectKey, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new ServiceUnavailableException(
        error?.message ?? 'Failed to create signed read URL',
      );
    }
    this.signedReadUrls.set(
      bucket,
      objectKey,
      expiresInSeconds,
      data.signedUrl,
    );
    return data.signedUrl;
  }

  /** Drop a cached signature after the stored object is removed. */
  forgetSignedReadUrl(bucket: StorageBucket, objectKey: string): void {
    this.signedReadUrls.forget(bucket, objectKey);
  }
}
