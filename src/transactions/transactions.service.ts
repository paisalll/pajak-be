import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  // --- CREATE ---
  async create(dto: CreateTransactionDto, userId: string) {
    // 1. Loop Produk untuk menghitung Total DPP
    let total_dpp = 0;
    
    const detailData = dto.products.map((product) => {
        const qty = Number(product.qty);
        const harga = Number(product.harga_satuan);
        const sub_total = qty * harga;
        total_dpp += sub_total; 

        return {
            nama_produk: product.nama_produk,
            deskripsi: product.deskripsi,
            qty: qty,
            harga_satuan: harga,
            sub_total: sub_total
        };
    });

    // 2. Hitung Pajak
    let total_ppn = 0;
    let total_pph = 0;
    let total_transaksi = total_dpp;

    if (dto.id_ppn_fk) {
       const ppnData = await this.prisma.m_ppn.findUnique({ where: { id_ppn: dto.id_ppn_fk }});
       if (ppnData) {
          total_ppn = total_dpp * Number(ppnData.rate);
          total_transaksi += total_ppn;
       }
    }

    if (dto.id_pph_fk) {
       const pphData = await this.prisma.m_pph.findUnique({ where: { id_pph: dto.id_pph_fk }});
       if (pphData) {
          total_pph = total_dpp * Number(pphData.rate);
          total_transaksi -= total_pph; 
       }
    }

    // 3. Simpan
    return this.prisma.transaksi_pajak.create({
      data: {
        tanggal_pencatatan: new Date(dto.tanggal_pencatatan),
        tanggal_invoice: new Date(dto.tanggal_invoice),
        tanggal_jatuh_tempo: new Date(dto.tanggal_jatuh_tempo),
        no_invoice: dto.no_invoice,
        no_faktur: dto.no_faktur,
        type: dto.type,
        
        total_dpp: total_dpp,
        total_ppn: total_ppn,
        total_pph: total_pph,
        total_transaksi: total_transaksi,

        ...(dto.id_company && { m_company: { connect: { id_company: dto.id_company } } }),
        users: { connect: { id_user: userId } },
        m_coa_debit: { connect: { id_coa: dto.id_akun_debit } },
        m_coa_kredit: { connect: { id_coa: dto.id_akun_kredit } },
        ...(dto.id_partner && { m_partner: { connect: { id_partner: dto.id_partner } } }),
        ...(dto.id_ppn_fk && { m_ppn: { connect: { id_ppn: dto.id_ppn_fk } } }),
        ...(dto.id_pph_fk && { m_pph: { connect: { id_pph: dto.id_pph_fk } } }),

        transaksi_detail: { create: detailData }
      },
      include: { transaksi_detail: true }
    });
  }

  // --- FIND ALL (PAGINATED) ---
  async findAll(
    page: number = 1,
    limit: number = 10,
    month?: number, 
    year?: number, 
    type?: 'penjualan' | 'pembelian', 
    searchAccount?: string
  ) {
    const skip = (page - 1) * limit;

    // Filter Logic
    const whereClause: Prisma.transaksi_pajakWhereInput = { AND: [] };

    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      (whereClause.AND as any[]).push({
        tanggal_pencatatan: { gte: startDate, lte: endDate },
      });
    }

    if (type) {
      (whereClause.AND as any[]).push({ type: type });
    }

    if (searchAccount) {
      (whereClause.AND as any[]).push({
        OR: [
          { id_akun_debit: { contains: searchAccount, mode: 'insensitive' } },
          { m_coa_debit: { nama_akun: { contains: searchAccount, mode: 'insensitive' } } },
          { id_akun_kredit: { contains: searchAccount, mode: 'insensitive' } },
          { m_coa_kredit: { nama_akun: { contains: searchAccount, mode: 'insensitive' } } },
          { no_invoice: { contains: searchAccount, mode: 'insensitive' } } // Tambah search by invoice
        ],
      });
    }

    // Execute Parallel
    const [transactions, totalItems, globalStats] = await this.prisma.$transaction([
      // A. Data Table (Paginated)
      this.prisma.transaksi_pajak.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        skip: skip,
        take: limit,
        include: {
          m_company: true,
          m_partner: true,
          m_ppn: true,
          m_pph: true,
          m_coa_debit: true,
          m_coa_kredit: true,
          transaksi_detail: true,
        },
      }),

      // B. Count
      this.prisma.transaksi_pajak.count({ where: whereClause }),

      // C. Summary Global (All Time / Tanpa Filter) - Sesuai request Anda sebelumnya
      this.prisma.transaksi_pajak.groupBy({
        by: ['type'],
        _sum: {
          total_transaksi: true,
          total_dpp: true,
          total_ppn: true,
          total_pph: true,
        },
        orderBy: { type: 'asc' },
      })
    ]);

    // Format Summary
    const getSum = (tipe: 'penjualan' | 'pembelian', field: string) => {
      const found = globalStats.find((g) => g.type === tipe);
      return Number(found?._sum?.[field] || 0);
    };

    const total_penjualan = getSum('penjualan', 'total_transaksi');
    const total_pembelian = getSum('pembelian', 'total_transaksi');
    const total_ppn = getSum('penjualan', 'total_ppn') + getSum('pembelian', 'total_ppn');
    const total_pph = getSum('penjualan', 'total_pph') + getSum('pembelian', 'total_pph');

    return {
      data: transactions,
      meta: {
        total_items: totalItems,
        total_pages: Math.ceil(totalItems / limit),
        current_page: page,
        per_page: limit,
      },
      summary: {
        total_transaksi: total_penjualan + total_pembelian,
        total_penjualan: total_penjualan,
        total_pembelian: total_pembelian,
        total_dpp: getSum('penjualan', 'total_dpp') + getSum('pembelian', 'total_dpp'),
        total_ppn: total_ppn,
        total_pph: total_pph,
        net_pajak: total_ppn - total_pph
      }
    };
  }

  // --- NEW: FIND ALL FOR EXPORT (NO PAGINATION) ---
  async findAllForExport(
    month?: number, 
    year?: number, 
    type?: 'penjualan' | 'pembelian', 
    searchAccount?: string
  ) {
    // Logic filter SAMA PERSIS dengan findAll, tapi tanpa SKIP/TAKE
    const whereClause: Prisma.transaksi_pajakWhereInput = { AND: [] };

    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      (whereClause.AND as any[]).push({
        tanggal_pencatatan: { gte: startDate, lte: endDate },
      });
    }

    if (type) {
      (whereClause.AND as any[]).push({ type: type });
    }

    if (searchAccount) {
      (whereClause.AND as any[]).push({
        OR: [
          { id_akun_debit: { contains: searchAccount, mode: 'insensitive' } },
          { m_coa_debit: { nama_akun: { contains: searchAccount, mode: 'insensitive' } } },
          { id_akun_kredit: { contains: searchAccount, mode: 'insensitive' } },
          { m_coa_kredit: { nama_akun: { contains: searchAccount, mode: 'insensitive' } } },
          { no_invoice: { contains: searchAccount, mode: 'insensitive' } }
        ],
      });
    }

    // Return Raw Data (Array)
    return this.prisma.transaksi_pajak.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      include: {
        m_company: true,
        m_partner: true,
        m_ppn: true,
        m_pph: true,
        m_coa_debit: true,
        m_coa_kredit: true,
      },
    });
  }
}