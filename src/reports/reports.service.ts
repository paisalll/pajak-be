import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { TransactionsService } from 'src/transactions/transactions.service';
import puppeteer from 'puppeteer';

@Injectable()
export class ReportsService {
  constructor(private transactionService: TransactionsService) {}

  // --- DOWNLOAD EXCEL ---
  async downloadExcel(res: Response, filters: any) {
    // 1. Ambil Data
    const data = await this.transactionService.findAllForExport(
        filters.month, 
        filters.year, 
        filters.type, 
        filters.search
    );

    // 2. Setup Workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Laporan Pajak');

    // 3. Columns
    worksheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 15 },
      { header: 'No Invoice', key: 'invoice', width: 25 },
      { header: 'No Invoice Customer/Vendor', key: 'invoice_customer_vendor', width: 25 },
      { header: 'Tipe', key: 'type', width: 15 },
      { header: 'Partner / Vendor', key: 'partner', width: 30 },
      { header: 'Akun Utama', key: 'akun', width: 25 }, // Akun Jurnal
      { header: 'Total DPP', key: 'dpp', width: 20, style: { numFmt: '#,##0.00' } },
      { header: 'PPN', key: 'ppn', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'PPh', key: 'pph', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'Grand Total', key: 'total', width: 25, style: { numFmt: '#,##0.00' } },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { horizontal: 'center' };

    // 4. Populate Data
    data.forEach((row) => {
        // LOGIC CARI NAMA AKUN DARI JURNAL
        // Penjualan -> Cari akun Kredit (Pendapatan)
        // Pembelian -> Cari akun Debit (Biaya)
        // Filter exclude akun pajak jika memungkinkan, atau ambil yang nominalnya = DPP
        let akunName = '-';
        
        if (row.transaksi_jurnal && row.transaksi_jurnal.length > 0) {
            const targetPosisi = row.type === 'penjualan' ? 'kredit' : 'debit';
            // Cari jurnal yang posisinya sesuai DAN nominalnya mendekati DPP (Akun Utama)
            // Atau ambil jurnal pertama yang sesuai posisi
            const mainJournal = row.transaksi_jurnal.find(j => 
                j.posisi === targetPosisi && Number(j.nominal) === Number(row.total_dpp)
            ) || row.transaksi_jurnal.find(j => j.posisi === targetPosisi);

            if (mainJournal && mainJournal.m_coa) {
                akunName = mainJournal.m_coa.nama_akun;
            }
        }

        worksheet.addRow({
            tanggal: row.tanggal_pencatatan,
            invoice: row.id_transaksi,
            invoice_customer_vendor: row.no_invoice,
            type: row.type.toUpperCase(),
            partner: row.m_partner?.nama_partner || '-',
            akun: akunName,
            dpp: Number(row.total_dpp),
            ppn: Number(row.total_ppn),
            pph: Number(row.total_pph),
            total: Number(row.total_transaksi)
        });
    });

    // 5. Footer Total
    const totalRowNumber = data.length + 2;
    worksheet.getCell(`F${totalRowNumber}`).value = 'GRAND TOTAL';
    worksheet.getCell(`F${totalRowNumber}`).font = { bold: true };
    worksheet.getCell(`G${totalRowNumber}`).value = { formula: `SUM(F2:F${data.length + 1})` };
    worksheet.getCell(`H${totalRowNumber}`).value = { formula: `SUM(G2:G${data.length + 1})` };
    worksheet.getCell(`I${totalRowNumber}`).value = { formula: `SUM(H2:H${data.length + 1})` };
    worksheet.getCell(`J${totalRowNumber}`).value = { formula: `SUM(I2:I${data.length + 1})` };
    worksheet.getRow(totalRowNumber).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Laporan_Pajak_${new Date().getTime()}.xlsx`);
    
    await workbook.xlsx.write(res);
    res.end();
  }

  // --- DOWNLOAD SUMMARY PDF ---
  async downloadSummaryPdf(res: Response, filters: any) {
    const data = await this.transactionService.findAllForExport(
        filters.month, 
        filters.year, 
        filters.type, 
        filters.search
    );

    const fCurr = (val: any) => Number(val).toLocaleString('id-ID', { style: 'currency', currency: 'IDR' });
    const fDate = (d: Date) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Hitung Total Footer
    const grandTotal = data.reduce((acc, curr) => ({
        dpp: acc.dpp + Number(curr.total_dpp),
        ppn: acc.ppn + Number(curr.total_ppn),
        pph: acc.pph + Number(curr.total_pph),
        total: acc.total + Number(curr.total_transaksi),
    }), { dpp: 0, ppn: 0, pph: 0, total: 0 });

    // Generate Rows
    const tableRows = data.map((row, index) => {
        // Logic Akun (Sama dengan Excel)
        let akunName = '-';
        if (row.transaksi_jurnal && row.transaksi_jurnal.length > 0) {
            const targetPosisi = row.type === 'penjualan' ? 'kredit' : 'debit';
            const mainJournal = row.transaksi_jurnal.find(j => 
                j.posisi === targetPosisi && Number(j.nominal) === Number(row.total_dpp)
            ) || row.transaksi_jurnal.find(j => j.posisi === targetPosisi);

            if (mainJournal && mainJournal.m_coa) {
                akunName = mainJournal.m_coa.nama_akun;
            }
        }
        
        return `
        <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td style="text-align: center;">${fDate(row.tanggal_pencatatan)}</td>
            <td>${row.no_invoice}</td>
            <td>${row.m_partner?.nama_partner || '-'}</td>
            <td>${akunName}</td>
            <td style="text-align: center;">${row.type.toUpperCase()}</td>
            <td style="text-align: right;">${fCurr(row.total_dpp)}</td>
            <td style="text-align: right;">${fCurr(row.total_ppn)}</td>
            <td style="text-align: right;">(${fCurr(row.total_pph)})</td>
            <td style="text-align: right; font-weight: bold;">${fCurr(row.total_transaksi)}</td>
        </tr>
        `;
    }).join('');

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

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent);
    
    const pdfBuffer = await page.pdf({ 
        format: 'A4', 
        landscape: true, 
        printBackground: true, 
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=Laporan_Rekap_${new Date().getTime()}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }

  // --- DOWNLOAD PDF SATUAN (INVOICE) ---
  async downloadPdf(res: Response, idTransaksi: string) {
    const trx = await this.transactionService.findOne(idTransaksi);

    if (!trx) {
       throw new NotFoundException('Transaksi tidak ditemukan');
    }

    const fCurr = (val: any) => Number(val).toLocaleString('id-ID', { style: 'currency', currency: 'IDR' });
    const fDate = (d: Date) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

    // Generate Product Rows
    const productRows = trx.transaksi_detail.map((item, index) => `
      <tr>
        <td style="text-align: center;">${index + 1}</td>
        <td>
            <strong>${item.nama_produk}</strong><br/>
            <small>${item.deskripsi || ''}</small>
        </td>
        <td style="text-align: center;">${Number(item.qty)}</td>
        <td style="text-align: right;">${fCurr(item.harga_satuan)}</td>
        <td style="text-align: right;">${fCurr(item.sub_total)}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica', Arial, sans-serif; font-size: 14px; padding: 40px; color: #333; }
            .header-container { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
            .company-info h1 { margin: 0; color: #2c3e50; font-size: 24px; }
            .invoice-details { text-align: right; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th { background-color: #f8f9fa; padding: 10px; text-align: left; border-bottom: 2px solid #ddd; }
            td { padding: 10px; border-bottom: 1px solid #eee; }
            .totals { width: 40%; float: right; }
            .totals-row { display: flex; justify-content: space-between; padding: 5px 0; }
            .grand-total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="company-info">
              <h1>${trx.m_company?.nama_perusahaan || 'PERUSAHAAN'}</h1>
              <p>${trx.m_company?.alamat || ''}</p>
              <p>NPWP: ${trx.m_company?.npwp || '-'}</p>
            </div>
            <div class="invoice-details">
              <h2>INVOICE</h2>
              <p><strong>No:</strong> ${trx.no_invoice}</p>
              <p><strong>Tanggal:</strong> ${fDate(trx.tanggal_invoice)}</p>
            </div>
          </div>

          <p><strong>Kepada:</strong> ${trx.m_partner?.nama_partner || '-'}</p>

          <table>
            <thead>
              <tr>
                <th width="5%">No</th>
                <th width="45%">Deskripsi</th>
                <th width="10%">Qty</th>
                <th width="20%">Harga</th>
                <th width="20%">Subtotal</th>
              </tr>
            </thead>
            <tbody>${productRows}</tbody>
          </table>

          <div class="totals">
            <div class="totals-row"><span>DPP</span><span>${fCurr(trx.total_dpp)}</span></div>
            <div class="totals-row"><span>PPN</span><span>${fCurr(trx.total_ppn)}</span></div>
            <div class="totals-row"><span>PPh</span><span>(${fCurr(trx.total_pph)})</span></div>
            <div class="totals-row grand-total"><span>TOTAL</span><span>${fCurr(trx.total_transaksi)}</span></div>
          </div>
        </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent);
    
    const pdfBuffer = await page.pdf({ 
        format: 'A4', 
        printBackground: true,
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
    });
    
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=invoice-${trx.no_invoice}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }
}