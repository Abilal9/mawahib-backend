import { MediaPurpose, MediaStatus, PrismaClient } from '@prisma/client';
import { seedId } from './ids';

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUNAQEBAQAAAAAAAAAAAAAAAAABAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGmP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64',
);

export const OBJECT_PREFIX = 'dev-seed';

export async function fetchImageBuffer(
  url: string,
): Promise<{ buf: Buffer; mime: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    return { buf, mime: mime.startsWith('image/') ? mime : 'image/jpeg' };
  } catch {
    return { buf: TINY_JPEG, mime: 'image/jpeg' };
  }
}

export async function uploadReadyAsset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  prisma: PrismaClient,
  ownerId: string,
  bucket: 'portfolio' | 'services' | 'avatars',
  purpose: MediaPurpose,
  label: string,
  sourceUrl: string,
) {
  const assetId = seedId(`media:${ownerId}:${label}`);
  const objectKey = `${OBJECT_PREFIX}/${ownerId}/${bucket}/${label}.jpg`;
  const { buf, mime } = await fetchImageBuffer(sourceUrl);
  const { error } = await supabase.storage.from(bucket).upload(objectKey, buf, {
    contentType: mime,
    upsert: true,
  });
  if (error) {
    throw new Error(
      `Storage upload failed (${bucket}/${objectKey}): ${error.message}`,
    );
  }

  let publicUrl: string | null = null;
  if (bucket === 'avatars') {
    publicUrl = supabase.storage.from(bucket).getPublicUrl(objectKey).data
      .publicUrl as string;
  }

  const asset = await prisma.mediaAsset.upsert({
    where: { id: assetId },
    create: {
      id: assetId,
      ownerId,
      bucket,
      objectKey,
      mimeType: mime,
      byteSize: BigInt(buf.length),
      width: 800,
      height: 600,
      purpose,
      status: MediaStatus.ready,
    },
    update: {
      ownerId,
      bucket,
      objectKey,
      mimeType: mime,
      byteSize: BigInt(buf.length),
      purpose,
      status: MediaStatus.ready,
      deletedAt: null,
    },
  });

  return { asset, publicUrl };
}
