import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  async createCOA(data: Prisma.m_coaCreateInput) {
  return this.prisma.m_coa.create({ data });
  
  }
  async updateCOA(id: string, data: Prisma.m_coaUpdateInput) {
    return this.prisma.m_coa.update({ where: { id_coa: id }, data });
  }
  async deleteCOA(id: string) {
    return this.prisma.m_coa.delete({ where: { id_coa: id } });
  }

  async getPPN() {
    return this.prisma.m_ppn.findMany();
  }

  async getPPH() {
    return this.prisma.m_pph.findMany();
  }
}