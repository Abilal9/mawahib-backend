import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ReportReason, ReportTargetType } from '@prisma/client';

const REASONS = Object.values(ReportReason);
const TARGETS = Object.values(ReportTargetType);

export class CreateReportDto {
  @IsIn(TARGETS)
  targetType!: ReportTargetType;

  @IsUUID()
  targetId!: string;

  @IsIn(REASONS)
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReportStatusDto {
  @IsIn(['open', 'resolved', 'dismissed'])
  status!: 'open' | 'resolved' | 'dismissed';

  @IsIn(['open', 'resolved', 'dismissed'])
  expectedStatus!: 'open' | 'resolved' | 'dismissed';

  @IsString()
  @MaxLength(500)
  note!: string;
}
