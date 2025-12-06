import { Controller, Get, Res, Param, Query } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('excel')
  async exportExcel(@Res() res: Response,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('type') type?: any,
    @Query('search') search?: string,
  ) {
    const filters = {
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
        type,
        search
    };
    return this.reportsService.downloadExcel(res, filters);
  }

  @Get('pdf-summary')
  async exportPdfSummary(
    @Res() res: Response,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('type') type?: any,
    @Query('search') search?: string,
  ) {
    const filters = {
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
        type,
        search
    };
    // Panggil method baru tadi
    return this.reportsService.downloadSummaryPdf(res, filters);
  }
}