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
    const data = await this.transactionService.findAllForExport(
        filters.month, 
        filters.year, 
        filters.type, 
        filters.search
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Laporan Pajak');

    worksheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 15 },
      { header: 'No Invoice', key: 'invoice', width: 25 },
      { header: 'No Invoice Vendor', key: 'invoice_vendor', width: 25 },
      { header: 'Tipe', key: 'type', width: 12 },
      { header: 'Partner', key: 'partner', width: 30 },
      
      { header: 'Akun Debit', key: 'akun_debit', width: 30 },
      { header: 'Akun Kredit', key: 'akun_kredit', width: 30 },
      
      { header: 'List Akun COA', key: 'akun_detail', width: 40 }, 

      { header: 'DPP', key: 'dpp', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'PPN', key: 'ppn', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'PPh', key: 'pph', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'Total', key: 'total', width: 20, style: { numFmt: '#,##0.00' } },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    let currentRowIndex = 2; 

    data.forEach((trx) => {
        let relevantJournals: any[] = trx.transaksi_jurnal || [];

        if (relevantJournals.length === 0) {
            relevantJournals = [{ m_coa: { id_coa: '-', nama_akun: '-' }, posisi: '-' }] as any[];
        }

        const debitAccounts = relevantJournals
            .filter(j => j.posisi === 'debit')
            .map(j => `${j.m_coa?.id_coa} - ${j.m_coa?.nama_akun}` || 'Unknown')
            .join('\n');

        const creditAccounts = relevantJournals
            .filter(j => j.posisi === 'kredit')
            .map(j => `${j.m_coa?.id_coa} - ${j.m_coa?.nama_akun}` || 'Unknown')
            .join('\n');

        const rowCount = relevantJournals.length;
        const startRow = currentRowIndex;
        const endRow = currentRowIndex + rowCount - 1;

        relevantJournals.forEach((jurnal, index) => {
            const isFirstRow = index === 0;

            worksheet.addRow({
                tanggal: isFirstRow ? trx.tanggal_pencatatan : null,
                invoice: isFirstRow ? trx.id_transaksi : null,
                invoice_vendor: isFirstRow ? trx.no_invoice : null,
                type: isFirstRow ? trx.type.toUpperCase() : null,
                partner: isFirstRow ? (trx.m_partner?.nama_partner || '-') : null,
                
                akun_debit: isFirstRow ? debitAccounts : null,
                akun_kredit: isFirstRow ? creditAccounts : null,

                akun_detail: `${jurnal.m_coa?.id_coa || '?'} - ${jurnal.m_coa?.nama_akun || 'Unknown'}`,
                
                dpp: isFirstRow ? Number(trx.total_dpp) : null,
                ppn: isFirstRow ? Number(trx.total_ppn) : null,
                pph: isFirstRow ? Number(trx.total_pph) : null,
                total: isFirstRow ? Number(trx.total_transaksi) : null,
            });
        });

        if (rowCount > 1) {
            ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
                 worksheet.mergeCells(`${col}${startRow}:${col}${endRow}`);
            });
            
            ['I', 'J', 'K', 'L'].forEach(col => {
                worksheet.mergeCells(`${col}${startRow}:${col}${endRow}`);
            });
        }

        for (let r = startRow; r <= endRow; r++) {
            const row = worksheet.getRow(r);
            
            row.eachCell((cell) => {
                cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }; // Wrap text aktif agar \n terbaca
                cell.border = {
                    top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
                };
            });
            
            ['dpp', 'ppn', 'pph', 'total'].forEach(key => {
                row.getCell(key).alignment = { vertical: 'top', horizontal: 'right' };
            });
        }

        currentRowIndex += rowCount;
    });

    const footerRowIdx = currentRowIndex;
    const footerRow = worksheet.getRow(footerRowIdx);
    
    footerRow.getCell(8).value = 'GRAND TOTAL'; 
    footerRow.getCell(8).font = { bold: true };
    footerRow.getCell(8).alignment = { horizontal: 'right' };

    footerRow.getCell(9).value = { formula: `SUM(I2:I${footerRowIdx - 1})` };
    footerRow.getCell(10).value = { formula: `SUM(J2:J${footerRowIdx - 1})` };
    footerRow.getCell(11).value = { formula: `SUM(K2:K${footerRowIdx - 1})` };
    footerRow.getCell(12).value = { formula: `SUM(L2:L${footerRowIdx - 1})` };

    [9, 10, 11, 12].forEach(colIdx => {
        const cell = footerRow.getCell(colIdx);
        cell.font = { bold: true };
        cell.border = { top: { style: 'double' }, bottom: { style: 'thick' } };
        cell.numFmt = '#,##0.00';
    });

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
        // --- LOGIC PERBAIKAN AKUN (PDF) ---
        let akunHtml = '-';
        if (row.transaksi_jurnal && row.transaksi_jurnal.length > 0) {
            const targetPosisi = row.type === 'penjualan' ? 'kredit' : 'debit';
            
            const relevantJournals = row.transaksi_jurnal.filter(j => j.posisi === targetPosisi);

            if (relevantJournals.length > 0) {
                // Gunakan <div> atau <br/> agar turun ke bawah
                akunHtml = relevantJournals
                    .map(j => `<div style="margin-bottom: 2px;">${j.m_coa?.id_coa} - ${j.m_coa?.nama_akun}</div>`)
                    .join(''); 
            }
        }
        
        return `
        <tr>
            <td style="text-align: center; vertical-align: top;">${index + 1}</td>
            <td style="text-align: center; vertical-align: top;">${fDate(row.tanggal_pencatatan)}</td>
            <td style="vertical-align: top;">${row.no_invoice}</td>
            <td style="vertical-align: top;">${row.m_partner?.nama_partner || '-'}</td>
            <td style="vertical-align: top; font-size: 9px;">${akunHtml}</td> <td style="text-align: center; vertical-align: top;">${row.type.toUpperCase()}</td>
            <td style="text-align: right; vertical-align: top;">${fCurr(row.total_dpp)}</td>
            <td style="text-align: right; vertical-align: top;">${fCurr(row.total_ppn)}</td>
            <td style="text-align: right; vertical-align: top;">(${fCurr(row.total_pph)})</td>
            <td style="text-align: right; font-weight: bold; vertical-align: top;">${fCurr(row.total_transaksi)}</td>
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
                <th width="15%">Akun COA</th>
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