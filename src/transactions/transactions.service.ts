import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTransactionDto, userId: string) {
    // Hitung Pajak Sederhana (Logic bisa diperkompleks nanti)
    // Disini kita asumsi Frontend kirim ID PPN, Backend hitung nominal
    let nominal_ppn = 0;
    let total = dto.dpp;

    if (dto.id_ppn) {
       const ppnData = await this.prisma.m_ppn.findUnique({ where: { id_ppn: dto.id_ppn }});
       if (ppnData) {
          nominal_ppn = Number(dto.dpp) * Number(ppnData.rate);
          total = Number(dto.dpp) + nominal_ppn;
       }
    }

    return this.prisma.transaksi_pajak.create({
      data: {
        tanggal: new Date(dto.tanggal),
        no_invoice: dto.no_invoice,
        type: dto.type,
        dpp: dto.dpp,
        nominal_ppn: nominal_ppn,
        total_transaksi: total,

        // RELASI (CONNECT)
        m_company: { connect: { id_company: dto.id_company } },
        m_partner: { connect: { id_partner: dto.id_partner } },
        users: { connect: { id_user: userId } }, // Diambil dari Token Login

        // Relasi Akun COA
        m_coa_transaksi_pajak_id_akun_debitTom_coa: { connect: { id_coa: dto.id_akun_debit } },
        m_coa_transaksi_pajak_id_akun_kreditTom_coa: { connect: { id_coa: dto.id_akun_kredit } },

        // Relasi Pajak (Optional)
        ...(dto.id_ppn && { m_ppn: { connect: { id_ppn: dto.id_ppn } } }),
      },
    });
  }

  async findAll() {
    return this.prisma.transaksi_pajak.findMany({
      include: {
        m_partner: true,
        m_company: true,
        // Include nama akun debit/kredit
        m_coa_transaksi_pajak_id_akun_debitTom_coa: true,
        m_coa_transaksi_pajak_id_akun_kreditTom_coa: true,
      },
      orderBy: { created_at: 'desc' }
    });
  }
}