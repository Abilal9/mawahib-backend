import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateDirectWorkRequestDto,
  CreateJobListingDto,
  RequestWorkChangesDto,
} from './marketplace.dto';
import { CreatePortfolioProjectDto } from '../../portfolio/dto/portfolio.dto';
import { CreateServiceOfferingDto } from '../../services/dto/service.dto';

const MEDIA = '11111111-1111-4111-8111-111111111111';
const CATEGORY = '33333333-3333-4333-8333-333333333333';

async function errorCount(cls: new () => object, plain: object) {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto);
  return errors.length;
}

describe('truthfulness input validation', () => {
  const blanks = ['', ' ', '   ', '\t', '\n'];

  describe('job listing', () => {
    it.each(blanks)('rejects blank title %j', async (title) => {
      expect(
        await errorCount(CreateJobListingDto, {
          title,
          employmentType: 'freelance',
          location: 'Riyadh',
        }),
      ).toBeGreaterThan(0);
    });

    it.each(blanks)('rejects blank location %j', async (location) => {
      expect(
        await errorCount(CreateJobListingDto, {
          title: 'Photographer needed',
          employmentType: 'freelance',
          location,
        }),
      ).toBeGreaterThan(0);
    });

    it('accepts a typed location, including Remote, and trimmable text', async () => {
      expect(
        await errorCount(CreateJobListingDto, {
          title: ' Photographer needed ',
          employmentType: 'freelance',
          location: ' Remote ',
          categoryId: CATEGORY,
        }),
      ).toBe(0);
      expect(
        await errorCount(CreateJobListingDto, {
          title: 'Photographer needed',
          employmentType: 'freelance',
          location: 'Riyadh',
          categoryId: CATEGORY,
        }),
      ).toBe(0);
    });
  });

  describe('direct work request', () => {
    const recipientUserId = '22222222-2222-4222-8222-222222222222';

    it.each(blanks)('rejects a blank title %j', async (title) => {
      expect(
        await errorCount(CreateDirectWorkRequestDto, { recipientUserId, title }),
      ).toBeGreaterThan(0);
    });

    it('accepts a real title', async () => {
      expect(
        await errorCount(CreateDirectWorkRequestDto, {
          recipientUserId,
          title: ' Brand film ',
        }),
      ).toBe(0);
    });
  });

  describe('work-request changes', () => {
    it('requires a proposedTerms object', async () => {
      expect(await errorCount(RequestWorkChangesDto, {})).toBeGreaterThan(0);
      expect(
        await errorCount(RequestWorkChangesDto, { proposedTerms: null }),
      ).toBeGreaterThan(0);
    });

    it.each(blanks)('rejects a blank proposed title %j', async (title) => {
      expect(
        await errorCount(RequestWorkChangesDto, { proposedTerms: { title } }),
      ).toBeGreaterThan(0);
    });

    it('accepts an empty proposal object and a real title', async () => {
      expect(
        await errorCount(RequestWorkChangesDto, { proposedTerms: {} }),
      ).toBe(0);
      expect(
        await errorCount(RequestWorkChangesDto, {
          proposedTerms: { title: ' Brand film ' },
        }),
      ).toBe(0);
    });
  });

  describe('service offering', () => {
    const valid = {
      title: 'Brand film',
      categoryId: CATEGORY,
      media: [{ mediaAssetId: MEDIA }],
      packages: [
        {
          tier: 'basic',
          price: 0,
          deliveryLabel: '5 days',
          includes: ['Logo'],
        },
      ],
    };

    it('allows a real package price of 0', async () => {
      expect(await errorCount(CreateServiceOfferingDto, valid)).toBe(0);
    });

    it.each(blanks)('rejects a blank service title %j', async (title) => {
      expect(
        await errorCount(CreateServiceOfferingDto, { ...valid, title }),
      ).toBeGreaterThan(0);
    });

    it.each(blanks)('rejects a blank delivery label %j', async (deliveryLabel) => {
      expect(
        await errorCount(CreateServiceOfferingDto, {
          ...valid,
          packages: [{ ...valid.packages[0], deliveryLabel }],
        }),
      ).toBeGreaterThan(0);
    });

    it.each(blanks)('rejects a blank included item %j', async (include) => {
      expect(
        await errorCount(CreateServiceOfferingDto, {
          ...valid,
          packages: [{ ...valid.packages[0], includes: [include] }],
        }),
      ).toBeGreaterThan(0);
    });

    it('accepts an explicitly typed Flexible delivery', async () => {
      expect(
        await errorCount(CreateServiceOfferingDto, {
          ...valid,
          packages: [{ ...valid.packages[0], deliveryLabel: 'Flexible' }],
        }),
      ).toBe(0);
    });
  });

  describe('portfolio project', () => {
    it.each(blanks)('rejects a blank project title %j', async (title) => {
      expect(
        await errorCount(CreatePortfolioProjectDto, {
          title,
          media: [{ mediaAssetId: MEDIA }],
        }),
      ).toBeGreaterThan(0);
    });

    it('accepts a real project title', async () => {
      expect(
        await errorCount(CreatePortfolioProjectDto, {
          title: ' Brand film ',
          media: [{ mediaAssetId: MEDIA }],
        }),
      ).toBe(0);
    });
  });
});
