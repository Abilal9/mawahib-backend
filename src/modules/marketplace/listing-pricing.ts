import { BadRequestException } from '@nestjs/common';
import { JobPricingType } from '@prisma/client';

export interface ListingPricingInput {
  pricingType?: JobPricingType;
  fixedAmount?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
}

export interface ListingPricing {
  pricingType: JobPricingType;
  fixedAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Normalises structured job compensation. Only `fixed` yields a payable
 * amount; `range` / `negotiable` must be negotiated into a work-request
 * amount. Amounts irrelevant to the chosen type are cleared.
 */
export function resolveListingPricing(
  input: ListingPricingInput,
): ListingPricing {
  const pricingType = input.pricingType ?? JobPricingType.negotiable;

  if (pricingType === JobPricingType.fixed) {
    if (!positive(input.fixedAmount)) {
      throw new BadRequestException(
        'fixedAmount must be greater than 0 when pricingType is fixed',
      );
    }
    return {
      pricingType,
      fixedAmount: round2(input.fixedAmount),
      minAmount: null,
      maxAmount: null,
    };
  }

  if (pricingType === JobPricingType.range) {
    if (!positive(input.minAmount) || !positive(input.maxAmount)) {
      throw new BadRequestException(
        'minAmount and maxAmount must be greater than 0 when pricingType is range',
      );
    }
    if (input.maxAmount < input.minAmount) {
      throw new BadRequestException(
        'maxAmount must not be less than minAmount',
      );
    }
    return {
      pricingType,
      fixedAmount: null,
      minAmount: round2(input.minAmount),
      maxAmount: round2(input.maxAmount),
    };
  }

  return {
    pricingType,
    fixedAmount: null,
    minAmount: null,
    maxAmount: null,
  };
}
