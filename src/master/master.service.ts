import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MasterService {
  constructor(private prisma: PrismaService) {}

  async getPartners() {
    return this.prisma.m_partner.findMany();
  }

  async getCompany() {
    return this.prisma.m_company.findMany();
  }

  async getCOA() {
    return this.prisma.m_coa.findMany();
  }

  async getPPN() {
    return this.prisma.m_ppn.findMany();
  }

  async getPPH() {
    return this.prisma.m_pph.findMany();
  }
}