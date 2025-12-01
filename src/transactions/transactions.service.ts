import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTransactionDto, userId: string) {
    // 1. Loop Produk untuk menghitung Total DPP & Siapkan Data Detail
    let total_dpp = 0;
    
    // Kita map array dari DTO menjadi format yang siap disimpan ke database
    const detailData = dto.products.map((product) => {
        const qty = Number(product.qty);
        const harga = Number(product.harga_satuan);
        const sub_total = qty * harga;
        
        // Akumulasi ke Total DPP Invoice (Header)
        total_dpp += sub_total; 

        return {
            nama_produk: product.nama_produk,
            deskripsi: product.deskripsi,
            qty: qty,
            harga_satuan: harga,
            sub_total: sub_total
        };
    });

    // 2. Hitung Pajak (Berdasarkan Total DPP semua item)
    let total_ppn = 0;
    let total_pph = 0;
    let total_transaksi = total_dpp;

    // Hitung PPN
    if (dto.id_ppn_fk) {
       const ppnData = await this.prisma.m_ppn.findUnique({ where: { id_ppn: dto.id_ppn_fk }});
       if (ppnData) {
          total_ppn = total_dpp * Number(ppnData.rate);
          total_transaksi += total_ppn;
       }
    }

    // Hitung PPh
    if (dto.id_pph_fk) {
       const pphData = await this.prisma.m_pph.findUnique({ where: { id_pph: dto.id_pph_fk }});
       if (pphData) {
          total_pph = total_dpp * Number(pphData.rate);
          total_transaksi -= total_pph; 
       }
    }

    // 3. Simpan ke Database (Header + Detail)
    return this.prisma.transaksi_pajak.create({
      data: {
        // --- HEADER DATA ---
        tanggal_pencatatan: new Date(dto.tanggal_pencatatan),
        tanggal_invoice: new Date(dto.tanggal_invoice),
        tanggal_jatuh_tempo: new Date(dto.tanggal_jatuh_tempo),
        no_invoice: dto.no_invoice,
        no_faktur: dto.no_faktur,
        type: dto.type,
        
        // --- ANGKA REKAP ---
        total_dpp: total_dpp,
        total_ppn: total_ppn,
        total_pph: total_pph,
        total_transaksi: total_transaksi,

        // --- RELASI HEADER ---
        // Logic connect hanya jika id_company dikirim
        ...(dto.id_company && { 
            m_company: { connect: { id_company: dto.id_company } } 
        }),
        
        users: { connect: { id_user: userId } },
        
        // Relasi Akun COA (Nama baru sesuai schema.prisma)
        m_coa_debit: { connect: { id_coa: dto.id_akun_debit } },
        m_coa_kredit: { connect: { id_coa: dto.id_akun_kredit } },

        // Relasi Optional
        ...(dto.id_partner && { m_partner: { connect: { id_partner: dto.id_partner } } }),
        ...(dto.id_ppn_fk && { m_ppn: { connect: { id_ppn: dto.id_ppn_fk } } }),
        ...(dto.id_pph_fk && { m_pph: { connect: { id_pph: dto.id_pph_fk } } }),

        // --- SIMPAN DETAIL PRODUK (Nested Write) ---
        transaksi_detail: {
            create: detailData
        }
      },
      include: {
          transaksi_detail: true // Agar respon API menampilkan item produknya juga
      }
    });
  }

  async findAll() {
    return this.prisma.transaksi_pajak.findMany({
        orderBy: { created_at: 'desc' },
        include: {
            m_company: true,
            m_partner: true,
            m_ppn: true,
            m_pph: true,
            // Update nama relasi di sini juga
            m_coa_debit: true,
            m_coa_kredit: true,
            // Include detail produk
            transaksi_detail: true,
        }
    });
  }
}