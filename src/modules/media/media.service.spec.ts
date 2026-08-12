import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MediaPurpose, MediaStatus } from '@prisma/client';
import { MediaService } from './media.service';
import { MEDIA_ASSET_REPOSITORY } from './repositories/media-asset.repository';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

describe('MediaService', () => {
  let service: MediaService;
  const mediaRepo = {
    createPending: jest.fn(),
    findById: jest.fn(),
    findOwnedById: jest.fn(),
    markReady: jest.fn(),
    markFailed: jest.fn(),
    findReadyOwnedByIds: jest.fn(),
  };
  const supabase = {
    createSignedUpload: jest.fn(),
    objectExists: jest.fn(),
    createSignedReadUrl: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: MEDIA_ASSET_REPOSITORY, useValue: mediaRepo },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();
    service = module.get(MediaService);
  });

  it('rejects unsupported mime for avatar', async () => {
    await expect(
      service.createUploadSession('user-1', {
        purpose: MediaPurpose.avatar,
        mimeType: 'application/pdf',
        byteSize: 1000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates upload session', async () => {
    const asset = {
      id: 'media-1',
      ownerId: 'user-1',
      bucket: 'avatars',
      objectKey: 'user-1/media-1.jpg',
      mimeType: 'image/jpeg',
      byteSize: BigInt(1000),
      purpose: MediaPurpose.avatar,
      status: MediaStatus.pending,
      width: null,
      height: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mediaRepo.createPending.mockResolvedValue(asset);
    supabase.createSignedUpload.mockResolvedValue({
      path: asset.objectKey,
      token: 'tok',
      signedUrl: 'https://example.com/upload',
    });

    const session = await service.createUploadSession('user-1', {
      purpose: MediaPurpose.avatar,
      mimeType: 'image/jpeg',
      byteSize: 1000,
      fileName: 'pic.jpg',
    });

    expect(session.uploadUrl).toContain('https://');
    expect(session.token).toBe('tok');
    expect(mediaRepo.createPending).toHaveBeenCalled();
  });

  it('completes upload when object exists', async () => {
    const asset = {
      id: 'media-1',
      ownerId: 'user-1',
      bucket: 'avatars',
      objectKey: 'user-1/media-1.jpg',
      mimeType: 'image/jpeg',
      byteSize: BigInt(1000),
      purpose: MediaPurpose.avatar,
      status: MediaStatus.pending,
      width: null,
      height: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mediaRepo.findOwnedById.mockResolvedValue(asset);
    supabase.objectExists.mockResolvedValue(true);
    mediaRepo.markReady.mockResolvedValue({
      ...asset,
      status: MediaStatus.ready,
    });
    supabase.createSignedReadUrl.mockResolvedValue(
      'https://example.com/avatars/x.jpg',
    );

    const ready = await service.completeUpload('user-1', 'media-1');
    expect(ready.status).toBe('ready');
    expect(ready.url).toContain('https://');
  });
});
