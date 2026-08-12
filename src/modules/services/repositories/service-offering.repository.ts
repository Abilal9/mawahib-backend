import {
  MediaAsset,
  PackageTier,
  Prisma,
  ServiceAddon,
  ServiceMedia,
  ServiceOffering,
  ServiceOfferingStatus,
  ServicePackage,
} from '@prisma/client';

export type ServiceOfferingWithDetails = ServiceOffering & {
  packages: ServicePackage[];
  addons: ServiceAddon[];
  media: Array<ServiceMedia & { mediaAsset: MediaAsset }>;
};

export interface CreateServiceOfferingInput {
  id: string;
  userId: string;
  title: string;
  description: string;
  category?: string | null;
  position: number;
  currency: string;
  packages: Array<{
    tier: PackageTier;
    price: number;
    currency: string;
    deliveryLabel: string;
    includes: string[];
  }>;
  addons: Array<{
    title: string;
    price: number;
    currency: string;
    position: number;
  }>;
  media: Array<{ mediaAssetId: string; position: number; isVideo: boolean }>;
}

export interface UpdateServiceOfferingInput {
  title?: string;
  description?: string;
  category?: string | null;
  status?: ServiceOfferingStatus;
  packages?: CreateServiceOfferingInput['packages'];
  addons?: CreateServiceOfferingInput['addons'];
  media?: CreateServiceOfferingInput['media'];
}

export interface ServiceOfferingRepository {
  listByUser(
    userId: string,
    opts?: { publishedOnly?: boolean },
  ): Promise<ServiceOfferingWithDetails[]>;
  findById(id: string): Promise<ServiceOfferingWithDetails | null>;
  create(
    input: CreateServiceOfferingInput,
  ): Promise<ServiceOfferingWithDetails>;
  update(
    id: string,
    userId: string,
    input: UpdateServiceOfferingInput,
  ): Promise<ServiceOfferingWithDetails>;
  softDelete(id: string, userId: string): Promise<void>;
  reorder(userId: string, offeringIds: string[]): Promise<void>;
  countByUser(userId: string): Promise<number>;
}

export const SERVICE_OFFERING_REPOSITORY = Symbol(
  'SERVICE_OFFERING_REPOSITORY',
);

export type ServiceCreateData = Prisma.ServiceOfferingCreateInput;
