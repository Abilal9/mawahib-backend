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

export type ServiceTaxonomySkill = {
  position: number;
  skill: { id: string; nameEn: string };
};

export type ServiceOfferingWithDetails = ServiceOffering & {
  packages: ServicePackage[];
  addons: ServiceAddon[];
  media: Array<ServiceMedia & { mediaAsset: MediaAsset }>;
  taxonomyCategory?: { id: string; nameEn: string } | null;
  taxonomySkills?: ServiceTaxonomySkill[];
};

export interface CreateServiceOfferingInput {
  id: string;
  userId: string;
  title: string;
  description: string;
  categoryId: string;
  customCategory?: string | null;
  skillIds?: string[];
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
  categoryId?: string;
  customCategory?: string | null;
  skillIds?: string[];
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
  findSaveTarget(id: string): Promise<{
    id: string;
    status: ServiceOfferingStatus;
    deletedAt: Date | null;
    user: { deletedAt: Date | null };
  } | null>;
  createServiceSave(serviceId: string, userId: string): Promise<void>;
  deleteServiceSave(serviceId: string, userId: string): Promise<void>;
  listServiceSaveIds(userId: string, serviceIds: string[]): Promise<string[]>;
  listSavedServices(
    viewerId: string,
    cursor: { createdAt: string; id: string } | null,
    take: number,
  ): Promise<
    Array<{
      serviceId: string;
      createdAt: Date;
      service: ServiceOfferingWithDetails;
    }>
  >;
}

export const SERVICE_OFFERING_REPOSITORY = Symbol(
  'SERVICE_OFFERING_REPOSITORY',
);

export type ServiceCreateData = Prisma.ServiceOfferingCreateInput;
