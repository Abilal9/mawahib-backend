import { Controller, Get } from '@nestjs/common';
import { StaffOnly } from '../../common/decorators/staff-only.decorator';
import { OperationsService } from './operations.service';

@Controller('admin')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  /**
   * Targets come from server configuration only. Query parameters are ignored.
   */
  @Get('operations')
  @StaffOnly()
  overview() {
    return this.operations.overview();
  }
}
