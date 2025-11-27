import { Controller, Get, Res, Param } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('excel')
  async exportExcel(@Res() res: Response) {
    return this.reportsService.downloadExcel(res);
  }

  @Get('pdf/:id')
  async exportPDF(@Param('id') id: string, @Res() res: Response) {
    // id perlu diparse ke BigInt atau Number tergantung tipe data DB
    // Karena di DB BigInt, hati-hati parsingnya. 
    // Untuk simplifikasi contoh ini kita anggap number dulu.
    return this.reportsService.downloadPDF(res, Number(id));
  }
}