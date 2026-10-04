import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AboutCertificationDto,
  AboutEducationDto,
  AboutExperienceDto,
  AboutLanguageDto,
  PROFILE_LANGUAGE_LEVELS,
} from './profile-about.dto';

describe('profile-about.dto', () => {
  describe('AboutLanguageDto', () => {
    it.each([...PROFILE_LANGUAGE_LEVELS])(
      'accepts canonical level %s',
      async (level) => {
        const dto = plainToInstance(AboutLanguageDto, {
          id: 'l1',
          name: 'Arabic',
          level,
          languageCode: 'ar',
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      },
    );

    it('rejects free-text levels on new writes', async () => {
      const dto = plainToInstance(AboutLanguageDto, {
        id: 'l1',
        name: 'Arabic',
        level: 'Native',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('AboutEducationDto', () => {
    it('accepts structured dates without years', async () => {
      const dto = plainToInstance(AboutEducationDto, {
        id: 'ed1',
        school: 'AUS',
        degree: 'BSc',
        field: 'CS',
        startMonth: 9,
        startYear: 2018,
        endMonth: 5,
        endYear: 2022,
        currentlyStudying: false,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('AboutExperienceDto', () => {
    it('accepts canonical employment and location types', async () => {
      const dto = plainToInstance(AboutExperienceDto, {
        id: 'ex1',
        title: 'Designer',
        company: 'Studio',
        employmentType: 'Freelance',
        location: 'Dubai',
        locationType: 'Remote',
        startMonth: 1,
        startYear: 2024,
        currentlyWorking: true,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('AboutCertificationDto', () => {
    it('accepts structured credential fields', async () => {
      const dto = plainToInstance(AboutCertificationDto, {
        id: 'c1',
        name: 'PMP',
        issuingOrganization: 'PMI',
        issueMonth: 3,
        issueYear: 2024,
        doesNotExpire: true,
        credentialId: 'ABC-123',
        credentialUrl: 'https://example.com/cred',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
