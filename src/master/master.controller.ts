import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete, 
  Body, 
  Param, 
  UseGuards, 
  ParseIntPipe 
} from '@nestjs/common';
import { MasterService } from './master.service';
import { AuthGuard } from '@nestjs/passport';
import { 
  CreateCoaDto, 
  CreatePartnerDto, 
  CreateCompanyDto, 
  CreatePphDto, 
  CreatePpnDto } from './dto/create-master.dto';
import { 
  UpdateCoaDto,
  UpdateCompanyDto, 
  UpdatePartnerDto, 
  UpdatePphDto, 
  UpdatePpnDto } from './dto/update-master.dto';

// Import DTOs

@UseGuards(AuthGuard('jwt'))
@Controller('master')
export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  // --- COA (Chart of Accounts) ---
  @Get('coa')
  getCOA() { return this.masterService.getCOA(); }

  @Post('coa')
  createCOA(@Body() dto: CreateCoaDto) { return this.masterService.createCOA(dto); }

  @Patch('coa/:id')
  updateCOA(@Param('id') id: string, @Body() dto: UpdateCoaDto) { return this.masterService.updateCOA(id, dto); }

  @Delete('coa/:id')
  deleteCOA(@Param('id') id: string) { return this.masterService.deleteCOA(id); }


  // --- PARTNER (Customer/Vendor) ---
  @Get('partners')
  getPartners() { return this.masterService.getPartners(); }

  @Post('partners')
  createPartner(@Body() dto: CreatePartnerDto) { return this.masterService.createPartner(dto); }

  @Patch('partners/:id')
  updatePartner(@Param('id') id: string, @Body() dto: UpdatePartnerDto) { return this.masterService.updatePartner(id, dto); }

  @Delete('partners/:id')
  deletePartner(@Param('id') id: string) { return this.masterService.deletePartner(id); }


  // --- COMPANY ---
  @Get('company')
  getCompany() { return this.masterService.getCompany(); }

  @Post('company')
  createCompany(@Body() dto: CreateCompanyDto) { return this.masterService.createCompany(dto); }

  @Patch('company/:id')
  updateCompany(@Param('id') id: string, @Body() dto: UpdateCompanyDto) { return this.masterService.updateCompany(id, dto); }

  @Delete('company/:id')
  deleteCompany(@Param('id') id: string) { return this.masterService.deleteCompany(id); }


  // --- PPN (Tax) ---
  @Get('ppn')
  getPPN() { return this.masterService.getPPN(); }

  @Post('ppn')
  createPPN(@Body() dto: CreatePpnDto) { return this.masterService.createPPN(dto); }

  @Patch('ppn/:id') // Menggunakan ParseIntPipe karena ID PPN integer
  updatePPN(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePpnDto) { return this.masterService.updatePPN(id, dto); }

  @Delete('ppn/:id')
  deletePPN(@Param('id', ParseIntPipe) id: number) { return this.masterService.deletePPN(id); }


  // --- PPH (Income Tax) ---
  @Get('pph')
  getPPH() { return this.masterService.getPPH(); }

  @Post('pph')
  createPPH(@Body() dto: CreatePphDto) { return this.masterService.createPPH(dto); }

  @Patch('pph/:id') // Menggunakan ParseIntPipe karena ID PPH integer
  updatePPH(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePphDto) { return this.masterService.updatePPH(id, dto); }

  @Delete('pph/:id')
  deletePPH(@Param('id', ParseIntPipe) id: number) { return this.masterService.deletePPH(id); }
}