import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import puppeteer from 'puppeteer';
import { TransactionsService } from 'src/transactions/transactions.service';

@Injectable()
export class ReportsService {
  constructor(private transactionService: TransactionsService) {}

  async downloadExcel(res: Response, filters: any) {
    // 1. Ambil Data dari Database (Tanpa Pagination)
    const data = await this.transactionService.findAllForExport(
        filters.month, 
        filters.year, 
        filters.type, 
        filters.search
    );

    // 2. Setup Workbook & Worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Laporan Pajak');

    // 3. Define Columns
    worksheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 15 },
      { header: 'No Invoice', key: 'invoice', width: 25 },
      { header: 'Tipe', key: 'type', width: 15 },
      { header: 'Partner / Vendor', key: 'partner', width: 30 },
      { header: 'Akun', key: 'akun', width: 25 },
      { header: 'Total DPP', key: 'dpp', width: 20, style: { numFmt: '#,##0.00' } }, // Format Uang
      { header: 'PPN', key: 'ppn', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'PPh', key: 'pph', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'Total Transaksi', key: 'total', width: 25, style: { numFmt: '#,##0.00' } },
    ];

    // Style Header (Bold & Center)
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { horizontal: 'center' };

    // 4. Populate Data Rows
    data.forEach((row) => {
        // Logic Akun (Kredit utk Penjualan, Debit utk Pembelian)
        const akunName = row.type === 'penjualan' 
            ? row.m_coa_kredit?.nama_akun 
            : row.m_coa_debit?.nama_akun;

        worksheet.addRow({
            tanggal: row.tanggal_pencatatan,
            invoice: row.no_invoice,
            type: row.type.toUpperCase(),
            partner: row.m_partner?.nama_partner || '-',
            akun: akunName || '-',
            dpp: Number(row.total_dpp),
            ppn: Number(row.total_ppn),
            pph: Number(row.total_pph),
            total: Number(row.total_transaksi)
        });
    });

    // 5. Add Total Row at Bottom (Optional, biar keren)
    const totalRowNumber = data.length + 2;
    worksheet.getCell(`E${totalRowNumber}`).value = 'GRAND TOTAL';
    worksheet.getCell(`E${totalRowNumber}`).font = { bold: true };
    
    // Rumus Excel SUM (Otomatis hitung di Excel)
    worksheet.getCell(`F${totalRowNumber}`).value = { formula: `SUM(F2:F${data.length + 1})` };
    worksheet.getCell(`G${totalRowNumber}`).value = { formula: `SUM(G2:G${data.length + 1})` };
    worksheet.getCell(`H${totalRowNumber}`).value = { formula: `SUM(H2:H${data.length + 1})` };
    worksheet.getCell(`I${totalRowNumber}`).value = { formula: `SUM(I2:I${data.length + 1})` };
    worksheet.getRow(totalRowNumber).font = { bold: true };

    // 6. Send Response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Laporan_Pajak_${new Date().getTime()}.xlsx`);
    
    await workbook.xlsx.write(res);
    res.end();
  }

  async downloadSummaryPdf(res: Response, filters: any) {
    // 1. Ambil Data (Sama seperti Excel, gunakan findAllForExport)
    const data = await this.transactionService.findAllForExport(
        filters.month, 
        filters.year, 
        filters.type, 
        filters.search
    );

    // Helper Formatters
    const fCurr = (val: any) => Number(val).toLocaleString('id-ID', { style: 'currency', currency: 'IDR' });
    const fDate = (d: Date) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // 2. Hitung Grand Total untuk Footer
    const grandTotal = data.reduce((acc, curr) => ({
        dpp: acc.dpp + Number(curr.total_dpp),
        ppn: acc.ppn + Number(curr.total_ppn),
        pph: acc.pph + Number(curr.total_pph),
        total: acc.total + Number(curr.total_transaksi),
    }), { dpp: 0, ppn: 0, pph: 0, total: 0 });

    // 3. Generate Baris Tabel (Looping Data)
    const tableRows = data.map((row, index) => {
        // Tentukan Akun mana yang ditampilkan
        const akunName = row.type === 'penjualan' ? row.m_coa_kredit?.nama_akun : row.m_coa_debit?.nama_akun;
        
        return `
        <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td style="text-align: center;">${fDate(row.tanggal_pencatatan)}</td>
            <td>${row.no_invoice}</td>
            <td>${row.m_partner?.nama_partner || '-'}</td>
            <td>${akunName || '-'}</td>
            <td style="text-align: center;">${row.type.toUpperCase()}</td>
            <td style="text-align: right;">${fCurr(row.total_dpp)}</td>
            <td style="text-align: right;">${fCurr(row.total_ppn)}</td>
            <td style="text-align: right;">(${fCurr(row.total_pph)})</td>
            <td style="text-align: right; font-weight: bold;">${fCurr(row.total_transaksi)}</td>
        </tr>
        `;
    }).join('');

    // 4. Template HTML Laporan (Landscape Style)
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica', Arial, sans-serif; font-size: 10px; padding: 20px; }
            h1 { text-align: center; margin-bottom: 5px; }
            p.subtitle { text-align: center; margin-top: 0; color: #555; font-size: 12px; }
            
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 6px; }
            th { background-color: #eee; text-align: center; font-weight: bold; }
            
            .footer-row td { background-color: #f9f9f9; font-weight: bold; }
            .badge { padding: 2px 5px; border-radius: 4px; color: white; font-size: 9px; }
          </style>
        </head>
        <body>
          <h1>LAPORAN REKAPITULASI PAJAK</h1>
          <p class="subtitle">
            Periode: ${filters.month ? `Bulan ${filters.month}` : 'Semua Bulan'} ${filters.year || ''} 
            | Tipe: ${filters.type ? filters.type.toUpperCase() : 'SEMUA'}
          </p>

          <table>
            <thead>
              <tr>
                <th width="3%">No</th>
                <th width="8%">Tanggal</th>
                <th width="12%">No Invoice</th>
                <th width="15%">Partner</th>
                <th width="12%">Akun</th>
                <th width="8%">Tipe</th>
                <th width="10%">DPP</th>
                <th width="10%">PPN</th>
                <th width="10%">PPh</th>
                <th width="12%">Total</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
            <tfoot>
               <tr class="footer-row">
                  <td colspan="6" style="text-align: right;">GRAND TOTAL</td>
                  <td style="text-align: right;">${fCurr(grandTotal.dpp)}</td>
                  <td style="text-align: right;">${fCurr(grandTotal.ppn)}</td>
                  <td style="text-align: right;">(${fCurr(grandTotal.pph)})</td>
                  <td style="text-align: right;">${fCurr(grandTotal.total)}</td>
               </tr>
            </tfoot>
          </table>
          
          <div style="margin-top: 20px; font-size: 9px; color: #777;">
            Dicetak pada: ${new Date().toLocaleString('id-ID')}
          </div>
        </body>
      </html>
    `;

    // 5. Generate PDF via Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent);
    
    // Setting Landscape agar tabel muat
    const pdfBuffer = await page.pdf({ 
        format: 'A4', 
        landscape: true, 
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    
    await browser.close();

    // 6. Kirim Response
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=Laporan_Rekap_${new Date().getTime()}.pdf`, // 'inline' agar terbuka di browser
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }
}