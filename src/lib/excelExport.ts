import * as XLSX from 'xlsx';
import type { OpnameEntry, OpnameSession } from '../types.ts';

export function exportSessionToExcel(
  session: OpnameSession,
  entries: OpnameEntry[],
): void {
  const productsWithSubmittedOrCounted = new Set<number>();
  for (const e of entries) {
    const hasCount =
      e.qty_ok !== null || e.qty_ok_2 !== null || e.qty_nc !== null || Boolean(e.notes);
    if (e.is_submitted || hasCount) {
      productsWithSubmittedOrCounted.add(e.product_id);
    }
  }

  const exportEntries = entries.filter((entry) => {
    const hasCount =
      entry.qty_ok !== null ||
      entry.qty_ok_2 !== null ||
      entry.qty_nc !== null ||
      Boolean(entry.notes);
    if (!entry.is_submitted && !entry.location && !hasCount) {
      return !productsWithSubmittedOrCounted.has(entry.product_id);
    }
    return true;
  });

  const rows = exportEntries.map((entry) => {
    const hasCount =
      entry.qty_ok !== null || entry.qty_ok_2 !== null || entry.qty_nc !== null;
    const total = hasCount
      ? (entry.qty_ok ?? 0) + (entry.qty_ok_2 ?? 0) + (entry.qty_nc ?? 0)
      : '';

    return {
      MODEL: entry.model_name,
      LOCATION: entry.location || '-',
      DATE: session.opname_date || session.period_label,
      'PREPARED BY': entry.operator_name || session.prepared_by || '-',
      'S/N': entry.sn_order,
      'SAP CODE': entry.sap_code,
      'PARTS NAME': entry.parts_name,
      SECTION: entry.section,
      USE: entry.use_qty !== null ? entry.use_qty : '',
      'QTY OK': entry.qty_ok !== null ? entry.qty_ok : '',
      'QTY OK 2': entry.qty_ok_2 !== null ? entry.qty_ok_2 : '',
      'QTY NC': entry.qty_nc !== null ? entry.qty_nc : '',
      TOTAL: total,
      CATATAN: entry.notes || '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  worksheet['!cols'] = headers.map((header) => {
    let maxLen = header.length;
    for (const row of rows) {
      const val = String((row as Record<string, unknown>)[header] ?? '');
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(Math.max(maxLen + 3, 9), 44) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Opname');

  const safePeriod = session.period_label
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const fileName = `Stock_Opname_${safePeriod || session.period_month}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}
