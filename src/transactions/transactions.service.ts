import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Prisma } from '@prisma/client';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  private async generateTransactionId(): Promise<string> {
    const now = new Date();
    // Ambil 2 digit tahun terakhir (misal 2025 -> 25)
    const yearShort = now.getFullYear().toString().slice(-2); 
    const prefix = 'INV-';
    const suffix = `/${yearShort}`;

    // Cari transaksi terakhir yang memiliki format tahun ini
    // Query: SELECT * FROM transaksi_pajak WHERE CAST(id_transaksi AS TEXT) LIKE '%/25' ORDER BY id_transaksi DESC LIMIT 1
    const lastTransaction = await this.prisma.transaksi_pajak.findFirst({
        where: {
            id_transaksi: { endsWith: suffix as any }
        },
        orderBy: {
            id_transaksi: 'desc'
        }
    });

    let sequence = 1;

    if (lastTransaction) {
        // Contoh ID: INV-00005/25
        // 1. Split '/' -> ["INV-00005", "25"]
        const parts = lastTransaction.id_transaksi.toString().split('/');
        
        // 2. Ambil bagian depan "INV-00005", Split '-' -> ["INV", "00005"]
        const numberPart = parts[0].split('-')[1]; // "00005"
        
        // 3. Increment
        sequence = parseInt(numberPart) + 1;
    }

    // Format ulang: INV + (sequence dipadding 0 jadi 5 digit) + / + tahun
    // Contoh: INV-00001/25
    return `${prefix}${sequence.toString().padStart(5, '0')}${suffix}`;
  }
  
  async create(dto: CreateTransactionDto, userId: string) {
    // 1. Hitung DPP (Sama seperti sebelumnya)
    const newId = await this.generateTransactionId();
    let total_dpp = 0;
    const detailData = dto.products.map((product) => {
        const qty = Number(product.qty);
        const harga = Number(product.harga_satuan);
        const sub_total = qty * harga;
        total_dpp += sub_total; 
        return {
            nama_produk: product.nama_produk, deskripsi: product.deskripsi,
            qty: qty, harga_satuan: harga, sub_total: sub_total
        };
    });

    // 2. Hitung Pajak & Tentukan Akun Jurnal Otomatis
    let total_ppn = 0;
    let total_pph = 0;
    
    // Variable untuk menampung ID COA Pajak yang terpilih
    let selected_coa_ppn: string | null = null;
    let selected_coa_pph: string | null = null;

    // --- LOGIC PPN ---
    if (dto.id_ppn_fk) {
       const ppnData = await this.prisma.m_ppn.findUnique({ where: { id_ppn: dto.id_ppn_fk }});
       if (ppnData) {
          total_ppn = total_dpp * Number(ppnData.rate);
          
          // PILIH AKUN BERDASARKAN TIPE TRANSAKSI
          if (dto.type === 'penjualan') {
             selected_coa_ppn = ppnData.id_coa_keluaran; // Ex: 2.05.02... (Hutang PPN Keluaran)
          } else {
             selected_coa_ppn = ppnData.id_coa_masukan;  // Ex: 1.01.07... (PPN Masukan)
          }
       }
    }

    // --- LOGIC PPh ---
    if (dto.id_pph_fk) {
       const pphData = await this.prisma.m_pph.findUnique({ where: { id_pph: dto.id_pph_fk }});
       if (pphData) {
          total_pph = total_dpp * Number(pphData.rate);

          // PILIH AKUN BERDASARKAN TIPE TRANSAKSI
          if (dto.type === 'penjualan') {
             selected_coa_pph = pphData.id_coa_penjualan; // Ex: 2.05.02... (Prepaid/Potongan Customer)
          } else {
             selected_coa_pph = pphData.id_coa_pembelian; // Ex: 1.01.07... (Dibayar dimuka)
          }
       }
    }

    // Hitung Grand Total
    // Jika Penjualan: Customer Bayar = DPP + PPN - PPh (yang dipotong customer)
    // Jika Pembelian: Kita Bayar = DPP + PPN - PPh (yang kita potong dari vendor)
    let total_transaksi = total_dpp + total_ppn - total_pph;

    // 3. Susun Jurnal (Double Entry)
    const jurnalEntries: Prisma.transaksi_jurnalCreateWithoutTransaksi_pajakInput[] = [];

    if (dto.type === 'penjualan') {
        // === JURNAL PENJUALAN ===
        
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_kredit } }, // Input User
            posisi: 'kredit',
            nominal: total_transaksi,
            keterangan: '-'
        });

        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_debit } }, // Input User
            posisi: 'debit',
            nominal: total_dpp,
            keterangan: '-'
        });
        
        // 1. DEBIT: Piutang / Kas (Total Tagihan)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: '1.01.02.02.00.01' } }, // Input User: 1.01.02...
            posisi: 'debit',
            nominal: total_transaksi,
            keterangan: 'Piutang Penjualan'
        });

        // 2. KREDIT: Penjualan (Pendapatan)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: '4.01.00.00.00.00' } }, // Input User: 4.01...
            posisi: 'kredit',
            nominal: total_dpp,
            keterangan: 'Pendapatan Penjualan'
        });

        // 3. KREDIT: PPN Keluaran (Jika ada)
        if (total_ppn > 0 && selected_coa_ppn) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_ppn } }, // Otomatis: 2.05.02...
                posisi: 'none',
                nominal: total_ppn,
                keterangan: 'Hutang PPN Keluaran'
            });
        }

        // 4. DEBIT: PPh Dibayar Dimuka (Jika ada)
        // (Asumsi: Customer memotong PPh kita, jadi ini Aset/Prepaid buat kita)
        if (total_pph > 0 && selected_coa_pph) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_pph } }, // Otomatis: 2.05.02...
                posisi: 'none',
                nominal: total_pph,
                keterangan: 'PPh Penjualan (Prepaid)'
            });
        }

    } else {
        // === JURNAL PEMBELIAN ===

        // 1. KREDIT: Hutang / Kas (Total Bayar)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_kredit } }, // Input User
            posisi: 'kredit',
            nominal: total_transaksi,
            keterangan: 'Hutang Pembelian'
        });

        // 2. DEBIT: Pembelian (Biaya/Aset)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_debit } }, // Input User
            posisi: 'debit',
            nominal: total_dpp,
            keterangan: 'Biaya/Aset Pembelian'
        });

        // 3. DEBIT: PPN Masukan (Jika ada)
        if (total_ppn > 0 && selected_coa_ppn) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_ppn } }, // Otomatis: 1.01.07...
                posisi: 'none',
                nominal: total_ppn,
                keterangan: 'PPN Masukan'
            });
        }

        // 4. KREDIT: PPh Terhutang (Jika ada)
        // (Asumsi: Kita memotong PPh Vendor, jadi ini Hutang kita ke Negara)
        if (total_pph > 0 && selected_coa_pph) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_pph } }, // Otomatis: 1.01.07...
                posisi: 'none',
                nominal: total_pph,
                keterangan: 'Hutang PPh Pembelian'
            });
        }
    }

    // 4. Simpan ke DB
    return this.prisma.transaksi_pajak.create({
      data: {
        id_transaksi: newId,
        tanggal_pencatatan: new Date(dto.tanggal_pencatatan),
        tanggal_invoice: new Date(dto.tanggal_invoice),
        tanggal_jatuh_tempo: new Date(dto.tanggal_jatuh_tempo),
        no_invoice: dto.no_invoice,
        no_faktur: dto.no_faktur,
        type: dto.type,
        nama_proyek: dto.nama_proyek,
        pengaju: dto.pengaju,
        nama_sales: dto.type === 'penjualan' ? dto.nama_sales : null,
        due_date: dto.due_date,
        status_pembayaran: dto.status_pembayaran ?? 0,
        
        total_dpp: total_dpp,
        total_ppn: total_ppn,
        total_pph: total_pph,
        total_transaksi: total_transaksi,

        // Relasi
        ...(dto.id_company && { m_company: { connect: { id_company: dto.id_company } } }),
        users: { connect: { id_user: userId } },
        ...(dto.id_partner && { m_partner: { connect: { id_partner: dto.id_partner } } }),
        ...(dto.id_ppn_fk && { m_ppn: { connect: { id_ppn: dto.id_ppn_fk } } }),
        ...(dto.id_pph_fk && { m_pph: { connect: { id_pph: dto.id_pph_fk } } }),

        transaksi_detail: { create: detailData },
        transaksi_jurnal: { create: jurnalEntries } // Insert Jurnal
      },
      include: { 
        transaksi_detail: true,
        transaksi_jurnal: true 
      }
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
      // Logic Search Baru: Cari ke dalam tabel Jurnal -> COA -> Nama Akun
      (whereClause.AND as any[]).push({
        OR: [
          { no_invoice: { contains: searchAccount, mode: 'insensitive' } },
          { 
            transaksi_jurnal: { 
                some: { 
                    m_coa: { nama_akun: { contains: searchAccount, mode: 'insensitive' } } 
                } 
            } 
          }
        ],
      });
    }

    const [transactions, totalItems, globalStats] = await this.prisma.$transaction([
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
          // Detail Jurnal perlu di-load agar frontend bisa ambil nama akunnya
          transaksi_jurnal: {
             include: { m_coa: true }
          },
          transaksi_detail: true,
        },
      }),

      this.prisma.transaksi_pajak.count({ where: whereClause }),

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

  // --- FIND ALL FOR EXPORT ---
  async findAllForExport(
    month?: number, 
    year?: number, 
    type?: 'penjualan' | 'pembelian', 
    searchAccount?: string
  ) {
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
          { no_invoice: { contains: searchAccount, mode: 'insensitive' } },
          { 
            transaksi_jurnal: { 
                some: { 
                    m_coa: { nama_akun: { contains: searchAccount, mode: 'insensitive' } } 
                } 
            } 
          }
        ],
      });
    }

    return this.prisma.transaksi_pajak.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      include: {
        m_company: true,
        m_partner: true,
        m_ppn: true,
        m_pph: true,
        transaksi_jurnal: {
            include: { m_coa: true }
        },
      },
    });
  }
  
  // --- FIND ONE (Untuk Detail PDF) ---
  async findOne(id: string) {
    return this.prisma.transaksi_pajak.findUnique({
      where: { 
        id_transaksi: id 
      },
      include: {
        m_company: true,
        m_partner: true,
        transaksi_detail: true,
        transaksi_jurnal: { include: { m_coa: true } }
      },
    });
  }

  async update(id: string, dto: UpdateTransactionDto, userId: string) {
    // 1. Check if transaction exists
    const existingTransaction = await this.prisma.transaksi_pajak.findUnique({
      where: { id_transaksi: id },
    });

    if (!existingTransaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    // 2. Logic Recalculate (Mirip dengan Create)
    // NOTE: Karena UpdateDto partial, kita harus handle jika user tidak kirim produk/pajak baru.
    // Tapi untuk simplifikasi dan integritas data, biasanya FE mengirim FULL DATA saat update invoice.
    // Asumsi: DTO mengirim data lengkap (products, akun, pajak, dll) seperti Create.
    
    // A. Hitung DPP
    let total_dpp = 0;
    let detailDataCreateInput: Prisma.transaksi_detailCreateWithoutTransaksi_pajakInput[] = [];

    if (dto.products && dto.products.length > 0) {
        detailDataCreateInput = dto.products.map((product) => {
            const qty = Number(product.qty);
            const harga = Number(product.harga_satuan);
            const sub_total = qty * harga;
            total_dpp += sub_total; 
            return {
                nama_produk: product.nama_produk, deskripsi: product.deskripsi,
                qty: qty, harga_satuan: harga, sub_total: sub_total
            };
        });
    }

    // B. Hitung Pajak & Akun Jurnal
    let total_ppn = 0;
    let total_pph = 0;
    let selected_coa_ppn: string | null = null;
    let selected_coa_pph: string | null = null;

    if (dto.id_ppn_fk) {
       const ppnData = await this.prisma.m_ppn.findUnique({ where: { id_ppn: dto.id_ppn_fk }});
       if (ppnData) {
          total_ppn = total_dpp * Number(ppnData.rate);
          selected_coa_ppn = dto.type === 'penjualan' ? ppnData.id_coa_keluaran : ppnData.id_coa_masukan;
       }
    }

    if (dto.id_pph_fk) {
       const pphData = await this.prisma.m_pph.findUnique({ where: { id_pph: dto.id_pph_fk }});
       if (pphData) {
          total_pph = total_dpp * Number(pphData.rate);
          selected_coa_pph = dto.type === 'penjualan' ? pphData.id_coa_penjualan : pphData.id_coa_pembelian;
       }
    }

    let total_transaksi = total_dpp + total_ppn - total_pph;

    // C. Susun Jurnal Baru
    const jurnalEntries: Prisma.transaksi_jurnalCreateWithoutTransaksi_pajakInput[] = [];

    if (dto.type === 'penjualan') {
        // [Logic Jurnal Penjualan]
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_debit } },
            posisi: 'debit', nominal: total_transaksi, keterangan: 'Piutang Penjualan'
        });
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_kredit } },
            posisi: 'kredit', nominal: total_dpp, keterangan: 'Pendapatan Penjualan'
        });
        if (total_ppn > 0 && selected_coa_ppn) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_ppn } },
                posisi: 'kredit', nominal: total_ppn, keterangan: 'Hutang PPN Keluaran'
            });
        }
        if (total_pph > 0 && selected_coa_pph) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_pph } },
                posisi: 'debit', nominal: total_pph, keterangan: 'PPh Penjualan (Prepaid)'
            });
        }
    } else {
        // [Logic Jurnal Pembelian]
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_kredit } },
            posisi: 'kredit', nominal: total_transaksi, keterangan: 'Hutang Pembelian'
        });
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_debit } },
            posisi: 'debit', nominal: total_dpp, keterangan: 'Biaya/Aset Pembelian'
        });
        if (total_ppn > 0 && selected_coa_ppn) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_ppn } },
                posisi: 'debit', nominal: total_ppn, keterangan: 'PPN Masukan'
            });
        }
        if (total_pph > 0 && selected_coa_pph) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: selected_coa_pph } },
                posisi: 'kredit', nominal: total_pph, keterangan: 'Hutang PPh Pembelian'
            });
        }
    }

    // 3. EXECUTE UPDATE (Transaction)
    // Kita gunakan $transaction agar delete & create atomic (berhasil semua atau gagal semua)
    return this.prisma.$transaction(async (prisma) => {
        // A. Hapus Detail Lama
        await prisma.transaksi_detail.deleteMany({ where: { id_transaksi_fk: id } });
        
        // B. Hapus Jurnal Lama
        await prisma.transaksi_jurnal.deleteMany({ where: { id_transaksi_fk: id } });

        // C. Update Header & Insert New Children
        return prisma.transaksi_pajak.update({
            where: { id_transaksi: id },
            data: {
                tanggal_pencatatan: dto.tanggal_pencatatan ? new Date(dto.tanggal_pencatatan) : undefined,
                tanggal_invoice: dto.tanggal_invoice ? new Date(dto.tanggal_invoice) : undefined,
                tanggal_jatuh_tempo: dto.tanggal_jatuh_tempo ? new Date(dto.tanggal_jatuh_tempo) : undefined,
                no_invoice: dto.no_invoice,
                no_faktur: dto.no_faktur,
                type: dto.type,
                nama_proyek: dto.nama_proyek,
                pengaju: dto.pengaju,
                nama_sales: dto.type === 'penjualan' ? dto.nama_sales : null,
                due_date: dto.due_date,
                status_pembayaran: dto.status_pembayaran,

                total_dpp: total_dpp,
                total_ppn: total_ppn,
                total_pph: total_pph,
                total_transaksi: total_transaksi,

                // Relasi (Connect jika ada ID baru, disconnect tidak perlu karena foreign key akan tertimpa)
                ...(dto.id_company && { m_company: { connect: { id_company: dto.id_company } } }),
                ...(dto.id_partner && { m_partner: { connect: { id_partner: dto.id_partner } } }),
                ...(dto.id_ppn_fk ? { m_ppn: { connect: { id_ppn: dto.id_ppn_fk } } } : { m_ppn: { disconnect: true } }),
                ...(dto.id_pph_fk ? { m_pph: { connect: { id_pph: dto.id_pph_fk } } } : { m_pph: { disconnect: true } }),
                
                // Track who updated
                // users: { connect: { id_user: userId } }, // Optional: jika ingin track last updated by

                // Insert New Children
                transaksi_detail: { create: detailDataCreateInput },
                transaksi_jurnal: { create: jurnalEntries }
            },
            include: {
                transaksi_detail: true,
                transaksi_jurnal: true
            }
        });
    });
  }
  
  async remove(id: string) {
    // 1. Cek apakah transaksi ada
    const transaction = await this.prisma.transaksi_pajak.findUnique({
      where: { id_transaksi: id },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    // 2. Hapus Transaksi
    // Karena di schema.prisma sudah ada "onDelete: Cascade" pada relasi detail & jurnal,
    // maka menghapus Header ini akan OTOMATIS menghapus detail dan jurnalnya juga.
    return this.prisma.transaksi_pajak.delete({
      where: { id_transaksi: id },
    });
  }
}