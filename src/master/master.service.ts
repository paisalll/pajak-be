import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MasterService {
  constructor(private prisma: PrismaService) {}

  // --- PARTNER ---
  async getPartners() {
    return this.prisma.m_partner.findMany();
  }
  async createPartner(data: Prisma.m_partnerCreateInput) {
    return this.prisma.m_partner.create({ data });
  }
  async updatePartner(id: string, data: Prisma.m_partnerUpdateInput) {
    return this.prisma.m_partner.update({ where: { id_partner: id }, data });
  }
  async deletePartner(id: string) {
    return this.prisma.m_partner.delete({ where: { id_partner: id } });
  }

  // --- COMPANY ---
  async getCompany() {
    return this.prisma.m_company.findMany();
  }
  async createCompany(data: Prisma.m_companyCreateInput) {
    return this.prisma.m_company.create({ data });
  }
  async updateCompany(id: string, data: Prisma.m_companyUpdateInput) {
    return this.prisma.m_company.update({ where: { id_company: id }, data });
  }
  async deleteCompany(id: string) {
    return this.prisma.m_company.delete({ where: { id_company: id } });
  }

  // --- COA ---
  async getCOA() {
    return this.prisma.m_coa.findMany({ orderBy: { id_coa: 'asc' } });
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

  // --- PPN ---
  async getPPN() {
    return this.prisma.m_ppn.findMany({
        include: { coa_keluaran: true, coa_masukan: true } // Include relasi COA agar nama akun tampil
    });
  }
  async createPPN(data: Prisma.m_ppnCreateInput) {
    return this.prisma.m_ppn.create({ data });
  }
  async updatePPN(id: number, data: Prisma.m_ppnUpdateInput) {
    return this.prisma.m_ppn.update({ where: { id_ppn: id }, data });
  }
  async deletePPN(id: number) {
    return this.prisma.m_ppn.delete({ where: { id_ppn: id } });
  }

  // --- PPH ---
  async getPPH() {
    return this.prisma.m_pph.findMany({
        include: { coa_penjualan: true, coa_pembelian: true } // Include relasi COA
    });
  }
  async createPPH(data: Prisma.m_pphCreateInput) {
    return this.prisma.m_pph.create({ data });
  }
  async updatePPH(id: number, data: Prisma.m_pphUpdateInput) {
    return this.prisma.m_pph.update({ where: { id_pph: id }, data });
  }
  async deletePPH(id: number) {
    return this.prisma.m_pph.delete({ where: { id_pph: id } });
  }
}