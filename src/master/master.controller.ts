import { Controller, Get, UseGuards } from '@nestjs/common';
import { MasterService } from './master.service';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt')) // Endpoint ini dilindungi Login
@Controller('master')
export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  @Get('partners')
  getPartners() {
    return this.masterService.getPartners();
  }

  @Get('coa')
  getCOA() {
    return this.masterService.getCOA();
  }

  @Get('ppn')
  getPPN() {
    return this.masterService.getPPN();
  }

  @Get('pph')
  getPPH() {
    return this.masterService.getPPH();
  }
}