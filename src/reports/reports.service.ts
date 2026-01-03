import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { TransactionsService } from 'src/transactions/transactions.service';
import { PrismaService } from 'src/prisma/prisma.service';
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ReportsService {
  constructor(
    private transactionService: TransactionsService,
    private prisma: PrismaService
  ) {}

  // --- DOWNLOAD EXCEL COMPLETE (PAJAK + JURNAL + NERACA) ---
  async downloadExcel(res: Response, filters: any) {
    const data = await this.transactionService.findAllForExport(
        filters.month, 
        filters.year, 
        filters.type, 
        filters.search
    );

    // 2. SETUP WORKBOOK
    const workbook = new ExcelJS.Workbook();
    
    // ==========================================
    // SHEET 1: LAPORAN PAJAK (Format Merged)
    // ==========================================
    const wsPajak = workbook.addWorksheet('Laporan Pajak');
    
    // Setup Kolom Sheet 1
    wsPajak.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 12 },
      { header: 'No Invoice', key: 'invoice', width: 20 },
      { header: 'No Invoice Vendor', key: 'invoice_vendor', width: 20 },
      { header: 'Tipe', key: 'type', width: 10 },
      { header: 'Partner', key: 'partner', width: 25 },
      { header: 'Akun Debit', key: 'akun_debit', width: 25 },
      { header: 'Akun Kredit', key: 'akun_kredit', width: 25 },
      { header: 'List Akun COA', key: 'akun_detail', width: 35 }, 
      { header: 'DPP', key: 'dpp', width: 15, style: { numFmt: '#,##0.00' } },
      { header: 'PPN', key: 'ppn', width: 15, style: { numFmt: '#,##0.00' } },
      { header: 'PPh', key: 'pph', width: 15, style: { numFmt: '#,##0.00' } },
      { header: 'Total', key: 'total', width: 18, style: { numFmt: '#,##0.00' } },
    ];

    // Style Header Sheet 1
    const headerRow1 = wsPajak.getRow(1);
    headerRow1.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
    headerRow1.alignment = { horizontal: 'center', vertical: 'middle' };

    let currentRowIndex = 2; 

    // POPULATE SHEET 1
    data.forEach((trx) => {
        let relevantJournals: any[] = trx.transaksi_jurnal || [];
        if (relevantJournals.length === 0) {
            relevantJournals = [{ m_coa: { id_coa: '-', nama_akun: '-' }, posisi: '-' }] as any[];
        }

        const debitAccounts = relevantJournals.filter(j => j.posisi === 'debit')
            .map(j => j.m_coa?.nama_akun || 'Unknown').join('\n');
        const creditAccounts = relevantJournals.filter(j => j.posisi === 'kredit')
            .map(j => j.m_coa?.nama_akun || 'Unknown').join('\n');

        const rowCount = relevantJournals.length;
        const startRow = currentRowIndex;
        const endRow = currentRowIndex + rowCount - 1;

        relevantJournals.forEach((jurnal, index) => {
            const isFirstRow = index === 0;
            wsPajak.addRow({
                tanggal: isFirstRow ? trx.tanggal_pencatatan : null,
                invoice: isFirstRow ? trx.id_transaksi : null,
                invoice_vendor: isFirstRow ? trx.no_invoice : null,
                type: isFirstRow ? trx.type.toUpperCase() : null,
                partner: isFirstRow ? (trx.m_partner?.nama_partner || '-') : null,
                akun_debit: isFirstRow ? debitAccounts : null,
                akun_kredit: isFirstRow ? creditAccounts : null,
                akun_detail: `[${jurnal.posisi?.toUpperCase().substring(0,1)}] ${jurnal.m_coa?.id_coa || '?'} - ${jurnal.m_coa?.nama_akun}`,
                dpp: isFirstRow ? Number(trx.total_dpp) : null,
                ppn: isFirstRow ? Number(trx.total_ppn) : null,
                pph: isFirstRow ? Number(trx.total_pph) : null,
                total: isFirstRow ? Number(trx.total_transaksi) : null,
            });
        });

        if (rowCount > 1) {
            ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => wsPajak.mergeCells(`${col}${startRow}:${col}${endRow}`));
            ['I', 'J', 'K', 'L'].forEach(col => wsPajak.mergeCells(`${col}${startRow}:${col}${endRow}`));
        }
        
        // Styling Row
        for (let r = startRow; r <= endRow; r++) {
            const row = wsPajak.getRow(r);
            row.eachCell((cell) => {
                cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
            ['dpp', 'ppn', 'pph', 'total'].forEach(key => row.getCell(key).alignment = { vertical: 'top', horizontal: 'right' });
        }
        currentRowIndex += rowCount;
    });

    // Footer Sheet 1
    const footerRowIdx = currentRowIndex;
    const footerRow = wsPajak.getRow(footerRowIdx);
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


    // ==========================================
    // SHEET 2: JURNAL UMUM (General Journal)
    // ==========================================
    const wsJurnal = workbook.addWorksheet('Jurnal Umum');

    wsJurnal.columns = [
        { header: 'Tanggal', key: 'tgl', width: 12 },
        { header: 'No. Bukti', key: 'bukti', width: 20 },
        { header: 'Keterangan', key: 'ket', width: 40 },
        { header: 'Kode Akun', key: 'kode', width: 15 },
        { header: 'Nama Akun', key: 'nama', width: 30 },
        { header: 'Debit', key: 'debit', width: 18, style: { numFmt: '#,##0.00' } },
        { header: 'Kredit', key: 'kredit', width: 18, style: { numFmt: '#,##0.00' } },
    ];

    const headerRow2 = wsJurnal.getRow(1);
    headerRow2.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '27AE60' } }; // Warna Hijau

    // Flatten Data untuk Jurnal Umum
    // Kita loop transaksi, lalu loop jurnal di dalamnya
    data.forEach((trx) => {
        if (trx.transaksi_jurnal) {
            trx.transaksi_jurnal.forEach((j) => {
                const nominal = Number(j.nominal);
                wsJurnal.addRow({
                    tgl: trx.tanggal_pencatatan,
                    bukti: trx.id_transaksi,
                    ket: j.keterangan || `${trx.type.toUpperCase()} - ${trx.m_partner?.nama_partner}`,
                    kode: j.m_coa?.id_coa,
                    nama: j.m_coa?.nama_akun,
                    debit: j.posisi === 'debit' ? nominal : 0,
                    kredit: j.posisi === 'kredit' ? nominal : 0,
                });
            });
        }
    });

    // Footer Total Jurnal
    const lastRowJurnal = wsJurnal.rowCount + 1;
    wsJurnal.getCell(`E${lastRowJurnal}`).value = 'TOTAL';
    wsJurnal.getCell(`E${lastRowJurnal}`).font = { bold: true };
    wsJurnal.getCell(`F${lastRowJurnal}`).value = { formula: `SUM(F2:F${lastRowJurnal - 1})` };
    wsJurnal.getCell(`G${lastRowJurnal}`).value = { formula: `SUM(G2:G${lastRowJurnal - 1})` };
    wsJurnal.getRow(lastRowJurnal).font = { bold: true };


    // ==========================================
    // SHEET 3: NERACA SALDO (Trial Balance)
    // ==========================================
    const wsNeraca = workbook.addWorksheet('Neraca Saldo');

    wsNeraca.columns = [
        { header: 'Kode Akun', key: 'kode', width: 15 },
        { header: 'Nama Akun', key: 'nama', width: 35 },
        { header: 'Mutasi Debit', key: 'debit', width: 20, style: { numFmt: '#,##0.00' } },
        { header: 'Mutasi Kredit', key: 'kredit', width: 20, style: { numFmt: '#,##0.00' } },
        { header: 'Saldo Akhir', key: 'saldo', width: 20, style: { numFmt: '#,##0.00' } }, // Minus jika kredit (accounting format)
        { header: 'Posisi', key: 'posisi', width: 10 },
    ];

    const headerRow3 = wsNeraca.getRow(1);
    headerRow3.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '8E44AD' } }; // Warna Ungu

    // --- LOGIC AGREGASI NERACA SALDO ---
    // Gunakan Map untuk menampung total per akun
    const coaSummary = new Map<string, { nama: string, debit: number, kredit: number }>();

    data.forEach((trx) => {
        if (trx.transaksi_jurnal) {
            trx.transaksi_jurnal.forEach((j) => {
                const idCoa = j.id_coa_fk;
                const namaCoa = j.m_coa?.nama_akun || 'Unknown';
                const nominal = Number(j.nominal);

                if (!coaSummary.has(idCoa)) {
                    coaSummary.set(idCoa, { nama: namaCoa, debit: 0, kredit: 0 });
                }

                const curr = coaSummary.get(idCoa);
                if (curr) {
                    if (j.posisi === 'debit') {
                        curr.debit += nominal;
                    } else {
                        curr.kredit += nominal;
                    }
                }
            });
        }
    });

    // Convert Map ke Array dan Sort berdasarkan Kode Akun
    const sortedSummary = Array.from(coaSummary.entries())
        .sort((a, b) => a[0].localeCompare(b[0]));

    // Populate Sheet Neraca Saldo
    sortedSummary.forEach(([kode, val]) => {
        // Tentukan Saldo Normal
        const head = kode.charAt(0);
        // Header 1 (Aset), 5 (HPP), 6 (Beban), 8, 9 biasanya DEBIT
        // Header 2 (Kewajiban), 3 (Modal), 4 (Pendapatan), 7 (Pendapatan Lain) biasanya KREDIT
        const isNormalDebit = ['1', '5', '6', '8', '9'].includes(head);
        
        let saldoAkhir = 0;
        let posisiSaldo = '';

        if (isNormalDebit) {
            saldoAkhir = val.debit - val.kredit;
            posisiSaldo = saldoAkhir >= 0 ? 'Debit' : 'Kredit (Min)';
        } else {
            saldoAkhir = val.kredit - val.debit;
            posisiSaldo = saldoAkhir >= 0 ? 'Kredit' : 'Debit (Min)';
        }

        wsNeraca.addRow({
            kode: kode,
            nama: val.nama,
            debit: val.debit,
            kredit: val.kredit,
            saldo: saldoAkhir,
            posisi: posisiSaldo
        });
    });

    // Footer Total Neraca Saldo (Mutasi harus balance)
    const lastRowNeraca = wsNeraca.rowCount + 1;
    wsNeraca.getCell(`B${lastRowNeraca}`).value = 'TOTAL MUTASI';
    wsNeraca.getCell(`B${lastRowNeraca}`).font = { bold: true };
    wsNeraca.getCell(`C${lastRowNeraca}`).value = { formula: `SUM(C2:C${lastRowNeraca - 1})` };
    wsNeraca.getCell(`D${lastRowNeraca}`).value = { formula: `SUM(D2:D${lastRowNeraca - 1})` };
    
    // Check Balance Visual
    wsNeraca.getRow(lastRowNeraca).font = { bold: true };
    
    // Style Borders for all sheets to look neat
    [wsPajak, wsJurnal, wsNeraca].forEach(ws => {
        ws.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
                };
            });
        });
    });

    // 4. WRITE RESPONSE
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Laporan_Keuangan_${new Date().getTime()}.xlsx`);
    
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

  // --- DOWNLOAD PDF SATUAN (FORMAT MIRIP DOCX) ---
  async downloadPdf(res: Response, idTransaksi: string) {
    const trx = await this.transactionService.findOne(idTransaksi);

    if (!trx) {
       throw new NotFoundException('Transaksi tidak ditemukan');
    }

    const fCurr = (val: any) => Number(val).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fDate = (d: Date) => new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

    let logoHtml = '';
    try {
        const logoPath = path.join(process.cwd(), 'src/assets/adana-logo-1.jpg'); 
        
        if (fs.existsSync(logoPath)) {
            const imageBuffer = fs.readFileSync(logoPath);
            const base64Image = imageBuffer.toString('base64');
            const dataUrl = `data:image/jpeg;base64,${base64Image}`;
            
            // HTML Image Tag
            logoHtml = `<img src="${dataUrl}" style="width: 250px; height: auto; display: block; margin-bottom: 5px;" alt="Logo" />`;
        } else {
            console.warn(`Logo file not found at: ${logoPath}`);
        }
    } catch (error) {
        console.error("Gagal load logo:", error);
    }

    const customerName = trx.m_partner?.nama_partner || 'Cash Customer';
    const customerAddress = "Jl Johar Perumahan Ayla Residence Blok C No 8, SUMATERA UTARA, KABUPATEN DELI SERDANG, KUTALIMBARU, SEI MENCIRIM, 20351";
    
    const taxLabel = Number(trx.total_ppn || 0) > 0 ? `PPN 11%` : '0%';

    const productRows = trx.transaksi_detail.map((item) => `
      <tr>
        <td style="text-align: left;">${item.nama_produk}</td>
        <td style="text-align: center;">-</td> 
        <td style="text-align: center;">${Number(item.qty).toFixed(2)}</td>
        <td style="text-align: center;">KG</td>
        <td style="text-align: right;">${fCurr(item.harga_satuan)}</td>
        <td style="text-align: center;">${taxLabel}</td>
        <td style="text-align: right;">${fCurr(item.sub_total)}</td>
      </tr>
    `).join('');

    // 5. HTML Content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice ${trx.id_transaksi}</title>
        <style>
          @page { size: A4; margin: 10mm 15mm 10mm 15mm; }
          body { font-family: 'Arial', sans-serif; font-size: 9pt; line-height: 1.3; color: #000; }
          
          /* HEADER */
          .header-container { display: flex; justify-content: space-between; margin-bottom: 25px; }
          .header-left { width: 55%; }
          .header-right { width: 40%; }

          .logo-section { margin-bottom: 15px; }
          
          /* Customer Info */
          .customer-name { font-weight: bold; font-size: 11pt; margin-bottom: 5px; margin-top: 10px; }
          .address-title { font-weight: bold; margin-bottom: 2px; color: #333; font-size: 9pt;}
          .address-box { margin-bottom: 12px; width: 95%; word-wrap: break-word; line-height: 1.4; }

          /* Invoice Title & Meta */
          .invoice-title { font-weight: bold; font-size: 16pt; margin-bottom: 15px; text-align: right; color: #000; letter-spacing: 1px; }
          
          .info-table { width: 100%; border-collapse: collapse; }
          .info-table td { padding: 3px 0; vertical-align: top; }
          .info-label { font-weight: bold; width: 130px; }
          .info-value { text-align: right; }

          /* PRODUCT TABLE */
          .product-table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
          .product-table th { 
            border-top: 2px solid #000; border-bottom: 2px solid #000; 
            padding: 8px 5px; text-align: center; font-weight: bold; background-color: #fff; font-size: 8.5pt;
          }
          .product-table td { 
            border-bottom: 1px solid #ddd; padding: 8px 5px; vertical-align: top;
          }
          
          /* SUMMARY */
          .summary-container { display: flex; justify-content: space-between; margin-top: 15px; }
          .bank-info { width: 55%; font-size: 9pt; }
          .totals-info { width: 40%; }

          .company-name-bold { font-weight: bold; font-size: 10pt; margin-bottom: 5px; }
          
          .totals-table { width: 100%; border-collapse: collapse; }
          .totals-table td { padding: 4px 0; }
          .totals-label { font-weight: bold; }
          .totals-value { text-align: right; }
          .grand-total-row td { 
              border-top: 2px solid #000; 
              border-bottom: 2px solid #000; 
              font-weight: bold; font-size: 10pt; padding: 8px 0; margin-top: 5px;
          }

          /* SIGNATURE */
          .signature-section { display: flex; margin-top: 40px; justify-content: space-between; width: 80%; }
          .sign-box { text-align: center; width: 40%; }
          .sign-box-title { font-weight: bold; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px; display: block; margin-bottom: 50px; }
          .sign-line { border-top: 1px solid #aaa; margin-top: 10px; }

          /* FOOTER */
          .footer-notes { margin-top: 40px; font-size: 7.5pt; color: #000; border-top: 2px solid #000; padding-top: 8px; }
          .footer-notes ul { padding-left: 15px; margin: 0; }
          .footer-notes li { margin-bottom: 2px; }
          
          .page-number { text-align: right; font-size: 8pt; margin-top: 15px; }
        </style>
      </head>
      <body>

        <div class="header-container">
          <div class="header-left">
            <div class="logo-section">
               ${logoHtml} </div>

            <div class="customer-name">${customerName}</div>
            
            <div class="address-title">Bill to address :</div>
            <div class="address-box">
              ${customerAddress}
            </div>

            <div class="address-title">Shipping to :</div>
            <div class="address-box">
               ${customerAddress}
            </div>
          </div>

          <div class="header-right">
            <div class="invoice-title">Invoice ${trx.id_transaksi}</div>
            
            <table class="info-table">
              <tr><td class="info-label">Invoice Date:</td><td class="info-value">${fDate(trx.tanggal_invoice)}</td></tr>
              <tr><td class="info-label">Due Date:</td><td class="info-value">${fDate(trx.tanggal_jatuh_tempo)}</td></tr>
              <tr><td class="info-label">Source:</td><td class="info-value">SO-${trx.no_faktur || '0000'}</td></tr>
              <tr><td class="info-label">Customer Code:</td><td class="info-value">${trx.m_partner?.id_partner || '-'}</td></tr>
              <tr><td class="info-label">Payment Terms:</td><td class="info-value">D${trx.due_date}</td></tr>
              <tr><td class="info-label">Your Reference:</td><td class="info-value">-</td></tr>
            </table>
          </div>
        </div>

        <table class="product-table">
          <thead>
            <tr>
              <th style="text-align: left; width: 35%;">DESCRIPTION</th>
              <th style="width: 10%;">CARTON</th>
              <th style="width: 10%;">QUANTITY</th>
              <th style="width: 10%;">/KG</th>
              <th style="text-align: right; width: 15%;">UNIT PRICE</th>
              <th style="width: 10%;">TAXES</th>
              <th style="text-align: right; width: 15%;">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            ${productRows}
          </tbody>
        </table>

        <div class="summary-container">
          <div class="bank-info">
             <div class="company-name-bold">${trx.m_company?.nama_perusahaan || 'PT. ADANA MEGA PANEL'}</div>
             <div style="margin-bottom: 20px;">
                Bank Name: BCA<br/>
                Virtual Account: 8888 9999 0000
             </div>
             
             <div class="signature-section">
                <div class="sign-box">
                    <span class="sign-box-title">SENDER</span>
                    <br/><br/>
                    <div class="sign-line"></div>
                    <div>xxxxxxxxxx</div>
                    <div style="font-size: 8pt; margin-top: 2px;">Date : ${new Date().toISOString().slice(0, 10)}</div>
                </div>
                <div class="sign-box">
                    <span class="sign-box-title">RECIPIENT</span>
                    <br/><br/>
                    <div class="sign-line"></div>
                    <div>xxxxxxxxxx</div>
                </div>
             </div>
          </div>

          <div class="totals-info">
            <table class="totals-table">
              <tr>
                <td class="totals-label">Subtotal Excl Tax</td>
                <td class="totals-value">Rp ${fCurr(trx.total_dpp)}</td>
              </tr>
              <tr>
                <td class="totals-label">Taxes (${taxLabel})</td>
                <td class="totals-value">Rp ${fCurr(trx.total_ppn)}</td>
              </tr>
               ${(Number(trx.total_pph) || 0) > 0 ? `
              <tr>
                <td class="totals-label" style="color: red;">PPh (Deduction)</td>
                <td class="totals-value" style="color: red;">(Rp ${fCurr(trx.total_pph)})</td>
              </tr>` : ''}
              <tr class="grand-total-row">
                <td>Total</td>
                <td class="totals-value">Rp ${fCurr(trx.total_transaksi)}</td>
              </tr>
            </table>
          </div>
        </div>

        <div class="footer-notes">
           <div style="margin-bottom: 5px;">
             Invoice ini dibuat secara digital dan merupakan dokumen penagihan yang sah tanpa memerlukan tandatangan dari pihak PT Adana Mega Panel.
           </div>
           <ul>
             <li>Barang yang sudah dibeli tidak dapat dikembalikan lagi.</li>
             <li>Pembayaran diakui sah sebagai pembayaran jika dilakukan secara transfer dan uang/dana telah di terima/masuk ke dalam Rekening Virtual PT Adana Mega Panel yang tercantum pada invoice.</li>
             <li>Pemotongan/pembayaran invoice akan dilakukan oleh system secara otomatis terhadap nomor invoice dengan urutan yang terlama.</li>
             <li>BG/Cek dianggap lunas apabila telah dicairkan ke Bank.</li>
             <li>Mohon melakukan pembayaran sesuai dengan nilai di invoice tanpa adanya pemotongan apapun (biaya bank dll).</li>
           </ul>
        </div>

        <div class="page-number">Page: 1 / 1</div>

      </body>
      </html>
    `;

    // 6. Generate
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent);
    
    const pdfBuffer = await page.pdf({ 
        format: 'A4', 
        printBackground: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
    });
    
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=Invoice-${trx.id_transaksi}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }

  async getTrialBalance(month: number, year: number) {
    // 1. Tentukan Range Tanggal
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Tanggal terakhir bulan tsb

    // 2. Ambil Semua Master COA
    const allCoa = await this.prisma.m_coa.findMany({
        orderBy: { id_coa: 'asc' }
    });

    // 3. Ambil Agregat Debit & Kredit per Akun dalam Bulan Tersebut
    const journalSummary = await this.prisma.transaksi_jurnal.groupBy({
        by: ['id_coa_fk', 'posisi'],
        _sum: {
            nominal: true
        },
        where: {
            transaksi_pajak: {
                // Filter berdasarkan tanggal transaksi header
                tanggal_pencatatan: {
                    gte: startDate,
                    lte: endDate
                }
            }
        }
    });

    // 4. Mapping Data (Gabungkan COA dengan Transaksi)
    const report = allCoa.map((coa) => {
        // Cari total debit untuk akun ini
        const debitEntry = journalSummary.find(
            j => j.id_coa_fk === coa.id_coa && j.posisi === 'debit'
        );
        const totalDebit = Number(debitEntry?._sum?.nominal || 0);

        // Cari total kredit untuk akun ini
        const creditEntry = journalSummary.find(
            j => j.id_coa_fk === coa.id_coa && j.posisi === 'kredit'
        );
        const totalCredit = Number(creditEntry?._sum?.nominal || 0);

        // 5. Tentukan Saldo Akhir Berdasarkan Saldo Normal
        // Header 1 (Aset) & 5,6 (Biaya) -> Normal Debit
        // Header 2 (Hutang), 3 (Modal), 4 (Pendapatan) -> Normal Kredit
        
        const headCode = coa.id_coa.charAt(0); // Ambil digit pertama (1, 2, etc)
        const isNormalDebit = ['1', '5', '6', '7', '8', '9'].includes(headCode); // Sesuaikan dengan struktur akun Anda
        
        let endingBalance = 0;
        
        if (isNormalDebit) {
            endingBalance = totalDebit - totalCredit;
        } else {
            endingBalance = totalCredit - totalDebit;
        }

        // HAPUS AKUN YANG 0 (Opsional, agar report bersih)
        // if (totalDebit === 0 && totalCredit === 0) return null;

        return {
            id_coa: coa.id_coa,
            nama_akun: coa.nama_akun,
            header: headCode,
            is_normal_debit: isNormalDebit,
            mutasi_debit: totalDebit,
            mutasi_kredit: totalCredit,
            saldo_akhir: endingBalance
        };
    }).filter(item => item !== null); // Filter null jika opsi hide 0 aktif

    // 6. Hitung Grand Total untuk Cek Balance (Control)
    const totalDebitAll = report.reduce((sum, item) => sum + item.mutasi_debit, 0);
    const totalCreditAll = report.reduce((sum, item) => sum + item.mutasi_kredit, 0);
    const isBalanced = totalDebitAll === totalCreditAll;

    return {
        periode: `${month}-${year}`,
        is_balanced: isBalanced,
        total_debit: totalDebitAll,
        total_kredit: totalCreditAll,
        data: report
    };
  }
}