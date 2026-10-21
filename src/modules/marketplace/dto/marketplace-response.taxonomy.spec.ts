import {
  AccountType,
  EmploymentType,
  JobApplicationStatus,
  JobListingStatus,
  JobPricingType,
} from '@prisma/client';
import { JobApplicationResponseDto } from './marketplace-response.dto';
import type { JobApplicationWithRelations } from '../repositories/marketplace.repository';

function application(
  listing: JobApplicationWithRelations['listing'],
): JobApplicationWithRelations {
  return {
    id: 'app-1',
    listingId: listing.id,
    applicantId: 'applicant-1',
    coverLetter: '',
    status: JobApplicationStatus.submitted,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    applicant: {
      id: 'applicant-1',
      displayName: 'Layla',
      username: 'layla',
      accountType: AccountType.talent,
      isVerified: false,
      profile: null,
    },
    listing,
  };
}

describe('application listing taxonomy', () => {
  const baseListing = {
    id: 'job-1',
    posterId: 'poster-1',
    title: 'Illustrator',
    companyName: null,
    employmentType: EmploymentType.contract,
    location: 'Remote',
    currency: 'SAR',
    pricingType: JobPricingType.negotiable,
    fixedAmount: null,
    minAmount: null,
    maxAmount: null,
    salaryLabel: null,
    description: '',
    skills: ['Illustration', 'Food'],
    exploreTag: 'Food',
    categoryId: null,
    customCategory: null,
    status: JobListingStatus.archived,
    postedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  it('keeps canonical skills when the application listing has no poster', () => {
    const dto = JobApplicationResponseDto.fromEntity(
      application({
        ...baseListing,
        taxonomyCategory: null,
        taxonomySkills: [
          { position: 0, skill: { id: 'ill', nameEn: 'Illustration' } },
        ],
      }),
    );
    expect(dto.listing?.categoryId).toBeNull();
    expect(dto.listing?.categoryName).toBeNull();
    expect(dto.listing?.customCategory).toBeNull();
    expect(dto.listing?.taxonomySkills).toEqual([
      { id: 'ill', name: 'Illustration' },
    ]);
    expect(dto.listing?.skills).toEqual(['Illustration', 'Food']);
    expect(dto.listing?.exploreTag).toBe('Food');
  });

  it('returns the linked category instead of an empty taxonomy stub', () => {
    const dto = JobApplicationResponseDto.fromEntity(
      application({
        ...baseListing,
        categoryId: 'design',
        exploreTag: 'Design',
        skills: ['Branding'],
        taxonomyCategory: { id: 'design', nameEn: 'Design' },
        taxonomySkills: [
          { position: 0, skill: { id: 'branding', nameEn: 'Branding' } },
        ],
      }),
    );
    expect(dto.listing?.categoryId).toBe('design');
    expect(dto.listing?.categoryName).toBe('Design');
    expect(dto.listing?.customCategory).toBeNull();
    expect(dto.listing?.taxonomySkills).toEqual([
      { id: 'branding', name: 'Branding' },
    ]);
  });

  it('keeps Other and its custom description on an application listing', () => {
    const dto = JobApplicationResponseDto.fromEntity(
      application({
        ...baseListing,
        categoryId: 'other',
        customCategory: 'Specialty Research',
        exploreTag: 'Specialty Research',
        skills: ['Content Strategy'],
        taxonomyCategory: { id: 'other', nameEn: 'Other' },
        taxonomySkills: [
          {
            position: 0,
            skill: { id: 'content', nameEn: 'Content Strategy' },
          },
        ],
      }),
    );
    expect(dto.listing?.categoryName).toBe('Other');
    expect(dto.listing?.customCategory).toBe('Specialty Research');
    expect(dto.listing?.exploreTag).toBe('Specialty Research');
    expect(dto.listing?.taxonomySkills).toEqual([
      { id: 'content', name: 'Content Strategy' },
    ]);
  });
});
