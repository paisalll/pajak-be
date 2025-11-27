import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import puppeteer from 'puppeteer';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async downloadExcel(res: Response) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Rekap Pajak');

    // Setup Header
    worksheet.columns = [
      { header: 'No Invoice', key: 'inv', width: 25 },
      { header: 'Tanggal', key: 'date', width: 15 },
      { header: 'Partner', key: 'partner', width: 30 },
      { header: 'DPP', key: 'dpp', width: 20 },
      { header: 'PPN', key: 'ppn', width: 20 },
      { header: 'PPh', key: 'pph', width: 20 },
      { header: 'Total', key: 'total', width: 20 },
    ];

    // Ambil Data dari DB (Include relasi)
    const transactions = await this.prisma.transaksi_pajak.findMany({
      include: {
        m_partner: true, // Relasi ke partner
      }
    });

    // Masukkan data ke row
    transactions.forEach((trx) => {
      worksheet.addRow({
        inv: trx.no_invoice,
        date: trx.tanggal,
        partner: trx.m_partner?.nama_partner || '-',
        dpp: Number(trx.dpp), // Konversi Decimal ke Number JS hati-hati
        ppn: Number(trx.nominal_ppn),
        pph: Number(trx.nominal_pph),
        total: Number(trx.total_transaksi),
      });
    });

    // Style Header (Optional)
    worksheet.getRow(1).font = { bold: true };

    // Kirim Response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=rekap_pajak.xlsx');
    
    await workbook.xlsx.write(res);
    res.end();
  }

  async downloadPDF(res: Response, idTransaksi: number) {
    // 1. Ambil data
    const trx = await this.prisma.transaksi_pajak.findUnique({
        where: { id_transaksi: idTransaksi },
        include: { m_partner: true, m_company: true }
    });

    if (!trx) throw new Error('Transaksi tidak ditemukan');

    // 2. Buat Template HTML (Bisa dipisah ke file .hbs / .html biar rapi)
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            .header { text-align: center; margin-bottom: 30px; }
            .table { width: 100%; border-collapse: collapse; }
            .table th, .table td { border: 1px solid #ddd; padding: 8px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>INVOICE PAJAK</h1>
            <p>${trx.m_company?.nama_perusahaan}</p>
          </div>
          <p>No Invoice: <strong>${trx.no_invoice}</strong></p>
          <p>Kepada: ${trx.m_partner?.nama_partner}</p>
          
          <table class="table">
            <tr>
              <th>Deskripsi</th>
              <th>Nominal</th>
            </tr>
            <tr>
              <td>Dasar Pengenaan Pajak (DPP)</td>
              <td>Rp ${Number(trx.dpp).toLocaleString('id-ID')}</td>
            </tr>
             <tr>
              <td>PPN</td>
              <td>Rp ${Number(trx.nominal_ppn).toLocaleString('id-ID')}</td>
            </tr>
             <tr>
              <td>PPh</td>
              <td>(Rp ${Number(trx.nominal_pph).toLocaleString('id-ID')})</td>
            </tr>
            <tr>
              <td><strong>TOTAL</strong></td>
              <td><strong>Rp ${Number(trx.total_transaksi).toLocaleString('id-ID')}</strong></td>
            </tr>
          </table>
        </body>
      </html>
    `;

    // 3. Launch Puppeteer
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    // 4. Kirim
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=invoice-${trx.no_invoice}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }
}