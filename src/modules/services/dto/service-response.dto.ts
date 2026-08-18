import { PackageTier } from '@prisma/client';
import { formatMoneyDisplay } from '../../../common/location/geo';
import { ServiceOfferingWithDetails } from '../repositories/service-offering.repository';

const TIER_LABEL: Record<PackageTier, 'Basic' | 'Standard' | 'Premium'> = {
  basic: 'Basic',
  standard: 'Standard',
  premium: 'Premium',
};

function formatMoney(amount: number, currency: string): string {
  return formatMoneyDisplay({ amount, currency });
}

export class ServiceOfferingResponseDto {
  id!: string;
  title!: string;
  description!: string;
  category!: string | null;
  rating!: number;
  reviewCount!: number;
  images!: string[];
  mediaAssetIds!: string[];
  packages!: Array<{
    name: 'Basic' | 'Standard' | 'Premium';
    priceLabel: string;
    delivery: string;
    includes: string[];
    price: number;
    currency: string;
  }>;
  addons!: Array<{
    id: string;
    title: string;
    priceLabel: string;
    price: number;
    currency: string;
  }>;
  position!: number;
  createdAt!: string;
  updatedAt!: string;

  static fromEntity(
    offering: ServiceOfferingWithDetails,
    urlsByAssetId: Map<string, string | null>,
  ): ServiceOfferingResponseDto {
    const dto = new ServiceOfferingResponseDto();
    dto.id = offering.id;
    dto.title = offering.title;
    dto.description = offering.description;
    dto.category = offering.category;
    dto.rating = Number(offering.ratingAvg);
    dto.reviewCount = offering.ratingCount;
    dto.position = offering.position;
    dto.mediaAssetIds = offering.media.map((m) => m.mediaAssetId);
    dto.images = offering.media
      .map((m) => urlsByAssetId.get(m.mediaAssetId) ?? null)
      .filter((url): url is string => Boolean(url));
    dto.packages = offering.packages.map((p) => {
      const price = Number(p.price);
      return {
        name: TIER_LABEL[p.tier],
        priceLabel: formatMoney(price, p.currency),
        delivery: p.deliveryLabel,
        includes: Array.isArray(p.includes) ? (p.includes as string[]) : [],
        price,
        currency: p.currency,
      };
    });
    dto.addons = offering.addons.map((a) => {
      const price = Number(a.price);
      return {
        id: a.id,
        title: a.title,
        priceLabel: `+ ${formatMoney(price, a.currency)}`,
        price,
        currency: a.currency,
      };
    });
    dto.createdAt = offering.createdAt.toISOString();
    dto.updatedAt = offering.updatedAt.toISOString();
    return dto;
  }
}
