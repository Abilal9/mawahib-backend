import {
  IsDefined,
  IsString,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import type {
  EngagementScheduleKind,
  EngagementScheduleSource,
  WorkEngagementStatus,
} from '@prisma/client';
import { isIsoDate } from '../work-request-terms';

/**
 * Query fields stay strings. The global pipe enables implicit conversion, and a
 * Date field would parse `YYYY-MM-DD` through `new Date`, which shifts the day.
 */
@ValidatorConstraint({ name: 'civilDate', async: false })
export class CivilDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isIsoDate(value);
  }

  defaultMessage(): string {
    return 'must be a real date (YYYY-MM-DD)';
  }
}

export class CalendarQueryDto {
  @IsDefined()
  @IsString()
  @Validate(CivilDateConstraint)
  from!: string;

  @IsDefined()
  @IsString()
  @Validate(CivilDateConstraint)
  to!: string;
}

export type CalendarCounterpartDto = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  isVerified: boolean;
};

export type CalendarUnscheduledItemDto = {
  engagementId: string;
  workRequestId: string | null;
  title: string;
  engagementStatus: WorkEngagementStatus;
  tentative: boolean;
  viewerRole: 'client' | 'provider';
  counterpart: CalendarCounterpartDto;
};

export type CalendarScheduledItemDto = CalendarUnscheduledItemDto & {
  kind: EngagementScheduleKind;
  startDate: string;
  endDate: string;
  source: EngagementScheduleSource;
};

export type CalendarResponseDto = {
  from: string;
  to: string;
  scheduled: CalendarScheduledItemDto[];
  scheduledHasMore: boolean;
  unscheduled: CalendarUnscheduledItemDto[];
  unscheduledHasMore: boolean;
};

export type EngagementScheduleResponseDto = {
  engagementId: string;
  engagementStatus: WorkEngagementStatus;
  tentative: boolean;
  schedule: {
    kind: EngagementScheduleKind;
    startDate: string;
    endDate: string;
    source: EngagementScheduleSource;
  } | null;
};
