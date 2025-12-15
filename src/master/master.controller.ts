import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete, 
  Body, 
  Param, 
  UseGuards 
} from '@nestjs/common';
import { MasterService } from './master.service';
import { AuthGuard } from '@nestjs/passport';
import { CreateCoaDto } from './dto/create-master.dto';
import { UpdateCoaDto } from './dto/update-master.dto';

@UseGuards(AuthGuard('jwt')) // Endpoint ini dilindungi Login
@Controller('master')
export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  // --- PARTNER ---
  @Get('partners')
  getPartners() {
    return this.masterService.getPartners();
  }

  // --- COMPANY ---
  @Get('company')
  getCompany() {
    return this.masterService.getCompany();
  }

  // --- COA (CHART OF ACCOUNTS) ---
  
  @Get('coa')
  getCOA() {
    return this.masterService.getCOA();
  }

  @Post('coa')
  createCOA(@Body() dto: CreateCoaDto) {
    // DTO otomatis divalidasi di sini sebelum masuk ke Service
    return this.masterService.createCOA(dto);
  }

  @Patch('coa/:id')
  updateCOA(
    @Param('id') id: string, 
    @Body() dto: UpdateCoaDto
  ) {
    return this.masterService.updateCOA(id, dto);
  }

  @Delete('coa/:id')
  deleteCOA(@Param('id') id: string) {
    return this.masterService.deleteCOA(id);
  }

  // --- PAJAK ---

  @Get('ppn')
  getPPN() {
    return this.masterService.getPPN();
  }

  @Get('pph')
  getPPH() {
    return this.masterService.getPPH();
  }
}