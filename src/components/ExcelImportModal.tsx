import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  downloadMasterImportTemplate,
  parseMasterExcelFile,
  type ExcelImportParseResult,
} from '../lib/excelImport.ts';
import type { Product } from '../types.ts';

interface ExcelImportModalProps {
  isOpen: boolean;
  existingProducts: Product[];
  onClose: () => void;
  onSuccess: (summary: {
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    partsCount: number;
  }) => Promise<void>;
}

export function ExcelImportModal({
  isOpen,
  existingProducts,
  onClose,
  onSuccess,
}: ExcelImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ExcelImportParseResult | null>(null);
  const [mode, setMode] = useState<'skip_existing' | 'replace_parts'>('skip_existing');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingSapSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of existingProducts) {
      s.add(p.sap_code.toUpperCase());
    }
    return s;
  }, [existingProducts]);

  const previewStats = useMemo(() => {
    if (!parseResult) {
      return { totalModels: 0, newModels: 0, existingModels: 0, totalParts: 0 };
    }
    let newModels = 0;
    let existingModels = 0;
    let totalParts = 0;
    for (const m of parseResult.models) {
      if (existingSapSet.has(m.sap_code.toUpperCase())) {
        existingModels += 1;
      } else {
        newModels += 1;
      }
      totalParts += m.parts.length;
    }
    return {
      totalModels: parseResult.models.length,
      newModels,
      existingModels,
      totalParts,
    };
  }, [parseResult, existingSapSet]);

  if (!isOpen) return null;

  const resetState = () => {
    setFileName('');
    setParseResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const parsed = await parseMasterExcelFile(file);
      if (parsed.models.length === 0) {
        setParseResult(null);
        setError(
          'Tidak ada data Model & Part yang terbaca. Pastikan file memiliki baris SECTION = SET atau ikuti Template Excel.',
        );
      } else {
        setParseResult(parsed);
      }
    } catch (err) {
      setParseResult(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal membaca file Excel. Pastikan format .xlsx / .xls / .csv valid.',
      );
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parseResult || parseResult.models.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.bulkImportProducts({
        mode,
        models: parseResult.models.map((m) => ({
          sap_code: m.sap_code,
          model_name: m.model_name,
          section: m.section,
          parts: m.parts,
        })),
      });
      resetState();
      await onSuccess(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal mengimpor data ke database.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="excel-import-title"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h3
              id="excel-import-title"
              className="text-base font-semibold text-slate-900"
            >
              Import Massal Master Barang &amp; Part dari Excel
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Unggah file <span className="font-mono">.xlsx</span>,{' '}
              <span className="font-mono">.xls</span>, atau{' '}
              <span className="font-mono">.csv</span> untuk menambahkan banyak model dan
              daftar part sekaligus.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {/* Format Info & Template Download */}
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">
                Mendukung 2 format file Excel:
              </p>
              <p className="mt-0.5">
                1. Tabel daftar master (<span className="font-mono">MODEL | S/N | SAP CODE | PARTS NAME | SECTION | USE</span>).
              </p>
              <p>
                2. File form opname pabrik langsung (banyak sheet atau blok{' '}
                <span className="font-mono">MODEL</span> + baris{' '}
                <span className="font-mono">SECTION = SET</span>).
              </p>
            </div>
            <button
              type="button"
              onClick={downloadMasterImportTemplate}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 transition hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Download Template (.xlsx)
            </button>
          </div>

          {/* File Upload Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFileChange(e.dataTransfer.files?.[0]);
            }}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center transition hover:border-blue-500 hover:bg-blue-50/30"
          >
            <FileSpreadsheet className="h-8 w-8 text-blue-700" />
            <p className="mt-2 text-sm font-medium text-slate-900">
              {fileName
                ? `File dipilih: ${fileName}`
                : 'Pilih atau seret file Excel ke sini'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Format yang didukung: .xlsx, .xls, .csv
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => void handleFileChange(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              disabled={parsing}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
            >
              <Upload className="h-3.5 w-3.5" />
              {parsing
                ? 'Membaca file...'
                : fileName
                  ? 'Ganti File Excel'
                  : 'Pilih File Excel'}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          {/* Parsed Preview */}
          {parseResult && parseResult.models.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">Model Terdeteksi</div>
                  <div className="font-mono text-base font-semibold tabular-nums text-slate-900">
                    {previewStats.totalModels}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">Model Baru</div>
                  <div className="font-mono text-base font-semibold tabular-nums text-blue-700">
                    {previewStats.newModels}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">Sudah Ada</div>
                  <div className="font-mono text-base font-semibold tabular-nums text-amber-700">
                    {previewStats.existingModels}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">Total Part</div>
                  <div className="font-mono text-base font-semibold tabular-nums text-slate-900">
                    {previewStats.totalParts}
                  </div>
                </div>
              </div>

              {previewStats.existingModels > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-slate-800">
                  <div className="font-semibold text-amber-900">
                    Ditemukan {previewStats.existingModels} model dengan SAP CODE yang
                    sudah terdaftar. Pilih tindakan:
                  </div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-5">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="import-mode"
                        checked={mode === 'skip_existing'}
                        onChange={() => setMode('skip_existing')}
                        className="text-blue-700"
                      />
                      <span>Lewati model yang sudah ada</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="import-mode"
                        checked={mode === 'replace_parts'}
                        onChange={() => setMode('replace_parts')}
                        className="text-blue-700"
                      />
                      <span>Perbarui nama &amp; timpa daftar part-nya</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-medium text-slate-600">
                    <tr>
                      <th className="px-3 py-2">SAP CODE</th>
                      <th className="px-3 py-2">Nama Model</th>
                      <th className="px-3 py-2 text-right">Jumlah Part</th>
                      <th className="px-3 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parseResult.models.map((m) => {
                      const exists = existingSapSet.has(m.sap_code.toUpperCase());
                      return (
                        <tr key={m.sap_code} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2 font-mono font-semibold text-blue-700 whitespace-nowrap">
                            {m.sap_code}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {m.model_name}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                            {m.parts.length} part
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {exists ? (
                              <span className="font-medium text-amber-700">
                                {mode === 'skip_existing'
                                  ? 'Akan Dilewati'
                                  : 'Akan Diperbarui'}
                              </span>
                            ) : (
                              <span className="font-medium text-emerald-700">
                                Model Baru
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {parseResult.warnings.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Catatan Pembacaan ({parseResult.warnings.length})
                  </div>
                  <ul className="mt-1.5 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4">
                    {parseResult.warnings.slice(0, 15).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={
                importing || !parseResult || parseResult.models.length === 0
              }
              onClick={handleConfirmImport}
              className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800 disabled:opacity-60"
            >
              {importing
                ? 'Mengimpor...'
                : parseResult
                  ? `Import ${parseResult.models.length} Model ke Master`
                  : 'Import ke Master'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
