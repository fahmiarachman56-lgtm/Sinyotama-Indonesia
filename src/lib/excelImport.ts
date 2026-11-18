import * as XLSX from 'xlsx';

export interface ParsedImportPart {
  sn_order: number;
  sap_code: string;
  parts_name: string;
  section: string;
  use_qty: number | null;
}

export interface ParsedImportModel {
  sap_code: string;
  model_name: string;
  section: string;
  sheetName: string;
  parts: ParsedImportPart[];
}

export interface ExcelImportParseResult {
  models: ParsedImportModel[];
  sheetsProcessed: number;
  warnings: string[];
}

function cellStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function normHeader(val: unknown): string {
  return cellStr(val)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function parseUseQty(val: unknown): number | null {
  const s = cellStr(val);
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function findHeaderCol(
  headers: string[],
  candidates: string[],
): number {
  for (const cand of candidates) {
    const exact = headers.findIndex((h) => h === cand);
    if (exact !== -1) return exact;
  }
  for (const cand of candidates) {
    const partial = headers.findIndex((h) => h.includes(cand));
    if (partial !== -1) return partial;
  }
  return -1;
}

function extractModelMetadataFromRow(row: unknown[]): string | null {
  for (let i = 0; i < Math.min(row.length, 4); i++) {
    const key = normHeader(row[i]);
    if (key === 'MODEL' || key === 'NAMA MODEL' || key === 'MODEL NAME') {
      for (let j = i + 1; j < row.length; j++) {
        const val = cellStr(row[j]);
        if (val) return val;
      }
    }
  }
  return null;
}

export async function parseMasterExcelFile(
  file: File,
): Promise<ExcelImportParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const modelsMap = new Map<string, ParsedImportModel>();
  const warnings: string[] = [];

  const upsertModel = (
    sapCode: string,
    modelName: string,
    section: string,
    sheetName: string,
  ): ParsedImportModel => {
    const key = sapCode.toUpperCase();
    const existing = modelsMap.get(key);
    if (existing) {
      if (modelName && !existing.model_name) existing.model_name = modelName;
      return existing;
    }
    const created: ParsedImportModel = {
      sap_code: key,
      model_name: modelName || key,
      section: section || 'SET',
      sheetName,
      parts: [],
    };
    modelsMap.set(key, created);
    return created;
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });

    let pendingModelName = '';
    let activeModel: ParsedImportModel | null = null;
    let headerCols: {
      colModelName: number;
      colModelSap: number;
      colSn: number;
      colSap: number;
      colPartsName: number;
      colSection: number;
      colUse: number;
    } | null = null;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx] || [];
      const nonEmpty = row.some((c) => cellStr(c) !== '');
      if (!nonEmpty) continue;

      const normalizedCells = row.map((c) => normHeader(c));

      // Check if this row is a table header row
      const hasSapCol = findHeaderCol(normalizedCells, ['SAP CODE', 'KODE SAP']) !== -1;
      const hasPartsCol =
        findHeaderCol(normalizedCells, [
          'PARTS NAME',
          'PART NAME',
          'NAMA PART',
          'NAMA BARANG',
        ]) !== -1;

      if (hasSapCol && hasPartsCol) {
        headerCols = {
          colModelName: findHeaderCol(normalizedCells, [
            'MODEL',
            'MODEL NAME',
            'NAMA MODEL',
          ]),
          colModelSap: findHeaderCol(normalizedCells, [
            'MODEL SAP',
            'MODEL SAP CODE',
            'SAP MODEL',
            'KODE SAP MODEL',
          ]),
          colSn: findHeaderCol(normalizedCells, ['S N', 'SN', 'NO']),
          colSap: findHeaderCol(normalizedCells, ['SAP CODE', 'KODE SAP']),
          colPartsName: findHeaderCol(normalizedCells, [
            'PARTS NAME',
            'PART NAME',
            'NAMA PART',
            'NAMA BARANG',
          ]),
          colSection: findHeaderCol(normalizedCells, ['SECTION', 'BAGIAN']),
          colUse: findHeaderCol(normalizedCells, ['USE', 'QTY USE']),
        };
        continue;
      }

      // Check if this row is a standalone metadata line like ["MODEL", "LUCOZA ..."]
      const metaModel = extractModelMetadataFromRow(row);
      if (
        metaModel &&
        (!headerCols ||
          headerCols.colModelName === -1 ||
          (normHeader(row[0]) === 'MODEL' && cellStr(row[1]) !== ''))
      ) {
        pendingModelName = metaModel;
        activeModel = null;
        continue;
      }

      if (!headerCols) continue;

      const sapCode =
        headerCols.colSap !== -1 ? cellStr(row[headerCols.colSap]).toUpperCase() : '';
      const partsName =
        headerCols.colPartsName !== -1 ? cellStr(row[headerCols.colPartsName]) : '';
      const sectionRaw =
        headerCols.colSection !== -1 ? cellStr(row[headerCols.colSection]) : '';
      const snRaw = headerCols.colSn !== -1 ? cellStr(row[headerCols.colSn]) : '';
      const useQty =
        headerCols.colUse !== -1 ? parseUseQty(row[headerCols.colUse]) : 1;
      const rowModelName =
        headerCols.colModelName !== -1 ? cellStr(row[headerCols.colModelName]) : '';
      const rowModelSap =
        headerCols.colModelSap !== -1
          ? cellStr(row[headerCols.colModelSap]).toUpperCase()
          : '';

      if (!sapCode && !partsName) continue;

      const isSetRow = sectionRaw.toUpperCase() === 'SET';

      // Case A: Explicit MODEL SAP + MODEL NAME columns on every row
      if (rowModelSap && (rowModelName || pendingModelName)) {
        const target = upsertModel(
          rowModelSap,
          rowModelName || pendingModelName,
          'SET',
          sheetName,
        );
        activeModel = target;
        if (!isSetRow && sapCode && partsName && sapCode !== rowModelSap) {
          const snNum = Number(snRaw);
          target.parts.push({
            sn_order:
              Number.isFinite(snNum) && snNum > 1
                ? Math.round(snNum)
                : target.parts.length + 2,
            sap_code: sapCode,
            parts_name: partsName,
            section: sectionRaw || 'part',
            use_qty: useQty ?? 1,
          });
        }
        continue;
      }

      // Case B: SET row defines the Model (Factory Form OR Flat Template with SECTION=SET)
      if (isSetRow) {
        if (!sapCode) {
          warnings.push(
            `Sheet "${sheetName}" baris ${rIdx + 1}: Baris SET tidak memiliki SAP CODE.`,
          );
          continue;
        }
        const resolvedModelName =
          rowModelName || pendingModelName || partsName || sapCode;
        activeModel = upsertModel(sapCode, resolvedModelName, 'SET', sheetName);
        pendingModelName = resolvedModelName;
        continue;
      }

      // Case C: Regular part row
      if (!sapCode || !partsName) {
        warnings.push(
          `Sheet "${sheetName}" baris ${rIdx + 1}: SAP CODE atau PARTS NAME kosong, baris dilewati.`,
        );
        continue;
      }

      // If flat table switched MODEL without an explicit SET row, try matching existing model by name
      if (
        rowModelName &&
        (!activeModel ||
          activeModel.model_name.toLowerCase() !== rowModelName.toLowerCase())
      ) {
        const matched = Array.from(modelsMap.values()).find(
          (m) => m.model_name.toLowerCase() === rowModelName.toLowerCase(),
        );
        if (matched) {
          activeModel = matched;
        } else {
          warnings.push(
            `Sheet "${sheetName}" baris ${rIdx + 1}: Part "${partsName}" untuk model "${rowModelName}" belum memiliki baris induk SECTION = SET (atau kolom MODEL SAP).`,
          );
          continue;
        }
      }

      if (!activeModel) {
        warnings.push(
          `Sheet "${sheetName}" baris ${rIdx + 1}: Part "${partsName}" muncul sebelum baris induk model (SECTION = SET).`,
        );
        continue;
      }

      const snNum = Number(snRaw);
      activeModel.parts.push({
        sn_order:
          Number.isFinite(snNum) && snNum > 1
            ? Math.round(snNum)
            : activeModel.parts.length + 2,
        sap_code: sapCode,
        parts_name: partsName,
        section: sectionRaw || 'part',
        use_qty: useQty ?? 1,
      });
    }
  }

  return {
    models: Array.from(modelsMap.values()),
    sheetsProcessed: workbook.SheetNames.length,
    warnings,
  };
}

export function downloadMasterImportTemplate(): void {
  const rows = [
    {
      MODEL: 'LUCOZA 20LUNAMIS B80M SA',
      'S/N': 1,
      'SAP CODE': '60033365',
      'PARTS NAME': 'LUCOZA 20LUNAMIS B80M SA',
      SECTION: 'SET',
      USE: '',
    },
    {
      MODEL: 'LUCOZA 20LUNAMIS B80M SA',
      'S/N': 2,
      'SAP CODE': '70172148',
      'PARTS NAME': '7KSAOPY RING COPY-41',
      SECTION: 'part',
      USE: 1,
    },
    {
      MODEL: 'LUCOZA 20LUNAMIS B80M SA',
      'S/N': 3,
      'SAP CODE': '70220338',
      'PARTS NAME': '7KSAOZA NUTRING COZA-21',
      SECTION: 'KIJI H.BODY',
      USE: 1,
    },
    {
      MODEL: 'LUCOZA 20LUNAMIS B80M SA',
      'S/N': 4,
      'SAP CODE': '70231763',
      'PARTS NAME': 'LUCOZA 20LUNAMIS B80M #01 BP1',
      SECTION: 'blank',
      USE: 1,
    },
    {
      MODEL: 'LUCOZA 22SEPHIA S86ML SA',
      'S/N': 1,
      'SAP CODE': '60034102',
      'PARTS NAME': 'LUCOZA 22SEPHIA S86ML SA',
      SECTION: 'SET',
      USE: '',
    },
    {
      MODEL: 'LUCOZA 22SEPHIA S86ML SA',
      'S/N': 2,
      'SAP CODE': '70240110',
      'PARTS NAME': 'LUCOZA 22SEPHIA S86ML #01 BP1',
      SECTION: 'blank',
      USE: 1,
    },
    {
      MODEL: 'LUCOZA 22SEPHIA S86ML SA',
      'S/N': 3,
      'SAP CODE': '70198201',
      'PARTS NAME': 'T-KTSG4.5S',
      SECTION: 'part',
      USE: 4,
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 8 },
    { wch: 14 },
    { wch: 36 },
    { wch: 16 },
    { wch: 8 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Master Barang & Part');
  XLSX.writeFile(workbook, 'Template_Import_Master_JoranStock.xlsx');
}
