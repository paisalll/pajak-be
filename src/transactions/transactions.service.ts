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
    // 1. Generate ID & Hitung DPP
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

    // 2. Hitung Pajak
    let total_ppn = 0;
    let total_pph = 0;
    
    // Tampung ID Akun Pajak
    let coa_ppn_id: string | null = null;
    let coa_pph_id: string | null = null;

    // --- PPN ---
    if (dto.id_ppn_fk) {
       const ppnData = await this.prisma.m_ppn.findUnique({ where: { id_ppn: dto.id_ppn_fk }});
       if (ppnData) {
          total_ppn = total_dpp * Number(ppnData.rate);
          // Jika Penjualan -> PPN Keluaran (Hutang), Jika Pembelian -> PPN Masukan (Aset)
          coa_ppn_id = dto.type === 'penjualan' ? ppnData.id_coa_keluaran : ppnData.id_coa_masukan;
       }
    }

    // --- PPh ---
    if (dto.id_pph_fk) {
       const pphData = await this.prisma.m_pph.findUnique({ where: { id_pph: dto.id_pph_fk }});
       if (pphData) {
          total_pph = total_dpp * Number(pphData.rate);
          coa_pph_id = dto.type === 'penjualan' ? pphData.id_coa_penjualan : pphData.id_coa_pembelian;
       }
    }

    // 3. Hitung Grand Total (Total Uang yang Berpindah Tangan)
    // Rumus Akuntansi Umum: Tagihan = DPP + PPN - PPh
    // (PPh dikurangi karena sifatnya Withholding/Potong Pungut)
    let total_transaksi = total_dpp + total_ppn - total_pph;

    // 4. SUSUN JURNAL (MENGGUNAKAN INPUT USER + LOGIC PAJAK)
    const jurnalEntries: Prisma.transaksi_jurnalCreateWithoutTransaksi_pajakInput[] = [];

    if (dto.type === 'penjualan') {
        // ==========================================
        // LOGIC PENJUALAN (SALES)
        // ==========================================
        
        // 1. DEBIT: Kas / Bank / Piutang (Aset Bertambah)
        // Sebesar: Total Tagihan (Uang yang kita terima)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_debit } }, // User pilih: "Bank BCA" atau "Piutang Usaha"
            posisi: 'debit',
            nominal: total_transaksi,
            keterangan: `Penerimaan Invoice ${newId}`
        });

        // 2. KREDIT: Pendapatan / Penjualan (Ekuitas Bertambah)
        // Sebesar: DPP (Murni harga barang/jasa kita)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_kredit } }, // User pilih: "Pendapatan Jasa"
            posisi: 'kredit',
            nominal: total_dpp,
            keterangan: `Pendapatan Invoice ${newId}`
        });

        // 3. KREDIT: Hutang PPN (Kewajiban Bertambah) -> Jika ada PPN
        // Kita terima uang PPN, tapi itu titipan negara (Hutang)
        if (total_ppn > 0 && coa_ppn_id) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: coa_ppn_id } },
                posisi: 'kredit',
                nominal: total_ppn,
                keterangan: 'PPN Keluaran'
            });
        }

        // 4. DEBIT: PPh Dibayar Dimuka (Aset Bertambah) -> Jika ada PPh
        // Customer bayar kurang karena potong PPh. Bukti potong itu jadi Aset kita.
        if (total_pph > 0 && coa_pph_id) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: coa_pph_id } },
                posisi: 'debit',
                nominal: total_pph,
                keterangan: 'Prepaid PPh 23'
            });
        }

    } else {
        // ==========================================
        // LOGIC PEMBELIAN (PURCHASE)
        // ==========================================

        // 1. DEBIT: Biaya / Aset (Beban Bertambah)
        // Sebesar: DPP
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_debit } }, // User pilih: "Biaya Sewa" atau "Inventaris"
            posisi: 'debit',
            nominal: total_dpp,
            keterangan: `Biaya Invoice ${dto.no_invoice}`
        });

        // 2. KREDIT: Kas / Bank / Hutang (Aset Berkurang / Kewajiban Bertambah)
        // Sebesar: Total Tagihan (Uang yang kita bayar ke vendor)
        jurnalEntries.push({
            m_coa: { connect: { id_coa: dto.id_akun_kredit } }, // User pilih: "Bank BCA" atau "Hutang Usaha"
            posisi: 'kredit',
            nominal: total_transaksi,
            keterangan: `Pembayaran Invoice ${dto.no_invoice}`
        });

        // 3. DEBIT: PPN Masukan (Aset Bertambah) -> Jika ada PPN
        // Kita bayar PPN ke vendor, ini jadi tabungan pajak kita
        if (total_ppn > 0 && coa_ppn_id) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: coa_ppn_id } },
                posisi: 'debit',
                nominal: total_ppn,
                keterangan: 'PPN Masukan'
            });
        }

        // 4. KREDIT: Hutang PPh (Kewajiban Bertambah) -> Jika ada PPh
        // Kita bayar ke vendor kurang, karena kita potong pajak mereka. Uang potongan itu jadi Hutang kita ke negara.
        if (total_pph > 0 && coa_pph_id) {
            jurnalEntries.push({
                m_coa: { connect: { id_coa: coa_pph_id } },
                posisi: 'kredit',
                nominal: total_pph,
                keterangan: 'Hutang PPh Potong Pungut'
            });
        }
    }

    // 5. Simpan ke DB (Sama seperti sebelumnya)
    return this.prisma.transaksi_pajak.create({
      data: {
        id_transaksi: newId,
        tanggal_pencatatan: new Date(dto.tanggal_pencatatan),
        tanggal_invoice: new Date(dto.tanggal_invoice),
        tanggal_jatuh_tempo: new Date(dto.tanggal_jatuh_tempo),
        no_invoice: dto.type === 'penjualan' ? newId : dto.no_invoice,
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
        transaksi_jurnal: { create: jurnalEntries } 
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

  async updateStatus(id: string, status: number) {
    // 1. Cek apakah transaksi ada
    const transaction = await this.prisma.transaksi_pajak.findUnique({
      where: { id_transaksi: id },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    // 2. Update status saja
    return this.prisma.transaksi_pajak.update({
      where: { id_transaksi: id },
      data: {
        status_pembayaran: status,
      },
    });
  }
}