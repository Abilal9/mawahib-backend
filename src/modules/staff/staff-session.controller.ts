import { Controller, Get } from '@nestjs/common';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';

/**
 * Proves the staff contract. It does not list users, disputes, or staff.
 */
@Controller('admin')
export class StaffSessionController {
  @Get('session')
  @StaffOnly()
  session(): { role: 'operator'; membership: 'active' } {
    return { role: 'operator', membership: 'active' };
  }
}
