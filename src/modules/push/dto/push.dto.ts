import { IsIn, IsInt, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class RegisterPushDeviceDto {
  @IsUUID()
  installationId!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/, {
    message: 'Use the push token from this installation.',
  })
  expoPushToken!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}

export class DetachPushDeviceDto {
  @IsUUID()
  installationId!: string;

  @IsInt()
  @Min(1)
  registrationGeneration!: number;

  @IsString()
  @MaxLength(80)
  detachSecret!: string;
}

export class SetPushViewingDto {
  @IsUUID()
  conversationId!: string;
}
