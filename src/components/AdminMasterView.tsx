import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Product, ProductPart } from '../types.ts';
import { ExcelImportModal } from './ExcelImportModal.tsx';

interface AdminMasterViewProps {
  products: Product[];
  onRefresh: () => Promise<void>;
}

interface DraftPartForm {
  sn_order: string;
  sap_code: string;
  parts_name: string;
  section: string;
  use_qty: string;
}

const emptyPartForm = (nextSn = 2): DraftPartForm => ({
  sn_order: String(nextSn),
  sap_code: '',
  parts_name: '',
  section: 'part',
  use_qty: '1',
});

export function AdminMasterView({ products, onRefresh }: AdminMasterViewProps) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    products.forEach((p, idx) => {
      init[p.id] = idx === 0;
    });
    return init;
  });

  // Model modal state
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [sapCode, setSapCode] = useState('');
  const [modelName, setModelName] = useState('');
  const [section, setSection] = useState('SET');
  const [initialParts, setInitialParts] = useState<DraftPartForm[]>([]);
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  // Bulk Excel import modal state
  const [excelImportOpen, setExcelImportOpen] = useState(false);
  const [importBanner, setImportBanner] = useState<string | null>(null);

  // Single Part modal state
  const [partModalProductId, setPartModalProductId] = useState<number | null>(null);
  const [editingPart, setEditingPart] = useState<ProductPart | null>(null);
  const [partForm, setPartForm] = useState<DraftPartForm>(emptyPartForm());
  const [partSaving, setPartSaving] = useState(false);
  const [partError, setPartError] = useState<string | null>(null);

  // Bulk Paste from Excel modal
  const [bulkModalProduct, setBulkModalProduct] = useState<Product | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Delete confirmation
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<Product | null>(null);
  const [confirmDeletePart, setConfirmDeletePart] = useState<ProductPart | null>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      if (
        p.sap_code.toLowerCase().includes(q) ||
        p.model_name.toLowerCase().includes(q)
      ) {
        return true;
      }
      return p.parts.some(
        (pt) =>
          pt.sap_code.toLowerCase().includes(q) ||
          pt.parts_name.toLowerCase().includes(q) ||
          pt.section.toLowerCase().includes(q),
      );
    });
  }, [products, search]);

  const totalPartsCount = useMemo(
    () => products.reduce((sum, p) => sum + p.parts.length, 0),
    [products],
  );

  const parsedBulkPreview = useMemo(() => {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    return lines
      .map((line) => {
        const cols = line.split('\t').map((c) => c.trim());
        // Support either: [S/N, SAP CODE, PARTS NAME, SECTION, USE] OR [SAP CODE, PARTS NAME, SECTION, USE]
        if (cols.length >= 4 && /^\d+$/.test(cols[0]) && cols[1].length >= 4) {
          return {
            sn_order: Number(cols[0]),
            sap_code: cols[1],
            parts_name: cols[2] || '',
            section: cols[3] || 'part',
            use_qty: cols[4] ? Number(cols[4]) || 1 : 1,
          };
        }
        return {
          sn_order: undefined,
          sap_code: cols[0] || '',
          parts_name: cols[1] || '',
          section: cols[2] || 'part',
          use_qty: cols[3] ? Number(cols[3]) || 1 : 1,
        };
      })
      .filter((r) => r.sap_code && r.parts_name);
  }, [bulkText]);

  const openCreateProduct = () => {
    setEditingProduct(null);
    setSapCode('');
    setModelName('');
    setSection('SET');
    setInitialParts([emptyPartForm(2)]);
    setProductError(null);
    setProductModalOpen(true);
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setSapCode(product.sap_code);
    setModelName(product.model_name);
    setSection(product.section);
    setInitialParts([]);
    setProductError(null);
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sapCode.trim() || !modelName.trim()) {
      setProductError('SAP CODE dan Nama Model wajib diisi.');
      return;
    }

    setProductSaving(true);
    setProductError(null);
    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, {
          sap_code: sapCode.trim(),
          model_name: modelName.trim(),
          section: section.trim() || 'SET',
        });
      } else {
        const created = await api.createProduct({
          sap_code: sapCode.trim(),
          model_name: modelName.trim(),
          section: section.trim() || 'SET',
          parts: initialParts
            .filter((pt) => pt.sap_code.trim() && pt.parts_name.trim())
            .map((pt, idx) => ({
              sn_order: Number(pt.sn_order) || idx + 2,
              sap_code: pt.sap_code.trim(),
              parts_name: pt.parts_name.trim(),
              section: pt.section.trim() || 'part',
              use_qty: pt.use_qty === '' ? null : Number(pt.use_qty) || 1,
            })),
        });
        setExpanded((prev) => ({ ...prev, [created.id]: true }));
      }
      await onRefresh();
      setProductModalOpen(false);
    } catch (err) {
      setProductError(err instanceof Error ? err.message : 'Gagal menyimpan model.');
    } finally {
      setProductSaving(false);
    }
  };

  const openAddPart = (product: Product) => {
    const nextSn =
      product.parts.reduce((max, pt) => Math.max(max, pt.sn_order), 1) + 1;
    setPartModalProductId(product.id);
    setEditingPart(null);
    setPartForm(emptyPartForm(nextSn));
    setPartError(null);
  };

  const openEditPart = (part: ProductPart) => {
    setPartModalProductId(part.product_id);
    setEditingPart(part);
    setPartForm({
      sn_order: String(part.sn_order),
      sap_code: part.sap_code,
      parts_name: part.parts_name,
      section: part.section,
      use_qty: part.use_qty !== null ? String(part.use_qty) : '',
    });
    setPartError(null);
  };

  const handleSavePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partForm.sap_code.trim() || !partForm.parts_name.trim()) {
      setPartError('SAP CODE dan PARTS NAME wajib diisi.');
      return;
    }

    setPartSaving(true);
    setPartError(null);
    try {
      const payload = {
        sn_order: Math.max(2, Number(partForm.sn_order) || 2),
        sap_code: partForm.sap_code.trim(),
        parts_name: partForm.parts_name.trim(),
        section: partForm.section.trim() || 'part',
        use_qty: partForm.use_qty === '' ? null : Number(partForm.use_qty) || 1,
      };
      if (editingPart) {
        await api.updatePart(editingPart.id, payload);
      } else if (partModalProductId !== null) {
        await api.addPart(partModalProductId, payload);
      }
      await onRefresh();
      setPartModalProductId(null);
      setEditingPart(null);
    } catch (err) {
      setPartError(err instanceof Error ? err.message : 'Gagal menyimpan part.');
    } finally {
      setPartSaving(false);
    }
  };

  const handleBulkSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkModalProduct) return;
    if (parsedBulkPreview.length === 0) {
      setBulkError(
        'Format baris tidak dikenali. Pastikan kolom dipisahkan Tab (copy langsung dari Excel).',
      );
      return;
    }

    setBulkSaving(true);
    setBulkError(null);
    try {
      await api.bulkAddParts(bulkModalProduct.id, parsedBulkPreview);
      await onRefresh();
      setBulkModalProduct(null);
      setBulkText('');
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Gagal mengimpor baris part.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!confirmDeleteProduct) return;
    await api.deleteProduct(confirmDeleteProduct.id);
    setConfirmDeleteProduct(null);
    await onRefresh();
  };

  const handleConfirmDeletePart = async () => {
    if (!confirmDeletePart) return;
    await api.deletePart(confirmDeletePart.id);
    setConfirmDeletePart(null);
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Master Model &amp; Daftar Part (BOM)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono font-semibold tabular-nums text-slate-700">
              {products.length}
            </span>{' '}
            model terdaftar
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
            <span className="font-mono font-semibold tabular-nums text-slate-700">
              {totalPartsCount}
            </span>{' '}
            total part penyusun
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari Model, SAP Code, Parts Name..."
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 sm:w-64"
            />
          </div>
          <button
            type="button"
            onClick={() => setExcelImportOpen(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            Import Massal Excel
          </button>
          <button
            type="button"
            onClick={openCreateProduct}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Tambah Model Baru
          </button>
        </div>
      </div>

      {importBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{importBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportBanner(null)}
            className="rounded p-1 hover:bg-emerald-100"
            aria-label="Tutup pemberitahuan"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {filteredProducts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-900">
            Belum ada master model yang cocok.
          </p>
          <button
            type="button"
            onClick={openCreateProduct}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
          >
            <Plus className="h-4 w-4" />
            Tambah Model Pertama
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProducts.map((product) => {
            const isOpen = expanded[product.id] ?? false;
            return (
              <div
                key={product.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [product.id]: !isOpen }))
                    }
                    className="flex min-w-0 items-start gap-2.5 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-mono text-xs font-semibold text-blue-700">
                          {product.sap_code}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {product.model_name}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        SECTION: {product.section}
                        <span aria-hidden="true" className="mx-1.5">
                          ·
                        </span>
                        <span className="font-mono tabular-nums">
                          1 SET + {product.parts.length} part
                        </span>
                      </p>
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => openAddPart(product)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Part
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkModalProduct(product);
                        setBulkText('');
                        setBulkError(null);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      Tempel dari Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditProduct(product)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteProduct(product)}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-red-600 transition hover:bg-red-50 whitespace-nowrap shrink-0"
                      aria-label={`Hapus ${product.model_name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-white text-xs font-medium text-slate-500">
                          <th className="w-16 px-4 py-2.5 text-center">S/N</th>
                          <th className="w-32 px-3 py-2.5">SAP CODE</th>
                          <th className="px-3 py-2.5">PARTS NAME</th>
                          <th className="w-32 px-3 py-2.5">SECTION</th>
                          <th className="w-20 px-3 py-2.5 text-center">USE</th>
                          <th className="w-28 px-4 py-2.5 text-right">AKSI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr className="bg-blue-50/40 font-medium">
                          <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-600">
                            1
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-blue-700">
                            {product.sap_code}
                          </td>
                          <td className="px-3 py-2.5 text-slate-900">
                            {product.model_name}
                          </td>
                          <td className="px-3 py-2.5 text-xs font-semibold text-blue-700">
                            {product.section}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs text-slate-400">
                            —
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                            Model Induk
                          </td>
                        </tr>

                        {product.parts.map((part) => (
                          <tr key={part.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2 text-center font-mono text-xs tabular-nums text-slate-600">
                              {part.sn_order}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-700">
                              {part.sap_code}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {part.parts_name}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {part.section}
                            </td>
                            <td className="px-3 py-2 text-center font-mono text-xs tabular-nums text-slate-700">
                              {part.use_qty !== null ? part.use_qty : ''}
                            </td>
                            <td className="px-4 py-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openEditPart(part)}
                                className="mr-2.5 text-xs font-medium text-blue-700 hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeletePart(part)}
                                className="text-xs font-medium text-red-600 hover:underline"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Model Modal */}
      {productModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {editingProduct ? 'Edit Master Model' : 'Tambah Model Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    SAP CODE (SET) *
                  </label>
                  <input
                    type="text"
                    required
                    value={sapCode}
                    onChange={(e) => setSapCode(e.target.value)}
                    placeholder="Contoh: 60033365"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm uppercase outline-none focus:border-blue-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    MODEL / PARTS NAME (Baris #1 SET) *
                  </label>
                  <input
                    type="text"
                    required
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="Contoh: LUCOZA 20LUNAMIS B80M SA"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {!editingProduct && (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Part Penyusun Awal (opsional, bisa tempel dari Excel nanti)
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setInitialParts((prev) => [
                          ...prev,
                          emptyPartForm(prev.length + 2),
                        ])
                      }
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Baris Part
                    </button>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {initialParts.map((pt, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-12"
                      >
                        <input
                          type="number"
                          min={2}
                          placeholder="S/N"
                          value={pt.sn_order}
                          onChange={(e) =>
                            setInitialParts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, sn_order: e.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-center font-mono text-xs sm:col-span-1"
                        />
                        <input
                          type="text"
                          placeholder="SAP CODE"
                          value={pt.sap_code}
                          onChange={(e) =>
                            setInitialParts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, sap_code: e.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs uppercase sm:col-span-3"
                        />
                        <input
                          type="text"
                          placeholder="PARTS NAME"
                          value={pt.parts_name}
                          onChange={(e) =>
                            setInitialParts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, parts_name: e.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs sm:col-span-4"
                        />
                        <input
                          type="text"
                          placeholder="SECTION"
                          value={pt.section}
                          onChange={(e) =>
                            setInitialParts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, section: e.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs sm:col-span-2"
                        />
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          placeholder="USE"
                          value={pt.use_qty}
                          onChange={(e) =>
                            setInitialParts((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, use_qty: e.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-center font-mono text-xs sm:col-span-1"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setInitialParts((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                          className="flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 sm:col-span-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {productError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {productError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={productSaving}
                  className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {productSaving ? 'Menyimpan...' : 'Simpan Model'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Single Add / Edit Part Modal */}
      {partModalProductId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {editingPart ? 'Edit Part' : 'Tambah Part'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPartModalProductId(null);
                  setEditingPart(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSavePart} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    S/N
                  </label>
                  <input
                    type="number"
                    min={2}
                    value={partForm.sn_order}
                    onChange={(e) =>
                      setPartForm((prev) => ({ ...prev, sn_order: e.target.value }))
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    SAP CODE *
                  </label>
                  <input
                    type="text"
                    required
                    value={partForm.sap_code}
                    onChange={(e) =>
                      setPartForm((prev) => ({ ...prev, sap_code: e.target.value }))
                    }
                    placeholder="Contoh: 70172148"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm uppercase outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  PARTS NAME *
                </label>
                <input
                  type="text"
                  required
                  value={partForm.parts_name}
                  onChange={(e) =>
                    setPartForm((prev) => ({ ...prev, parts_name: e.target.value }))
                  }
                  placeholder="Contoh: 7KSAOPY RING COPY-41"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    SECTION
                  </label>
                  <input
                    type="text"
                    value={partForm.section}
                    onChange={(e) =>
                      setPartForm((prev) => ({ ...prev, section: e.target.value }))
                    }
                    placeholder="part / KIJI H.BODY / blank / B-SEAL"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    USE
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={partForm.use_qty}
                    onChange={(e) =>
                      setPartForm((prev) => ({ ...prev, use_qty: e.target.value }))
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {partError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {partError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPartModalProductId(null);
                    setEditingPart(null);
                  }}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={partSaving}
                  className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {partSaving ? 'Menyimpan...' : 'Simpan Part'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Paste from Excel Modal */}
      {bulkModalProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Tempel Daftar Part dari Excel
                </h3>
                <p className="text-xs text-slate-500">
                  Model: <strong>{bulkModalProduct.model_name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkModalProduct(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleBulkSave} className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                Salin langsung beberapa baris dari Excel dengan urutan kolom:{' '}
                <span className="font-mono font-medium text-slate-800">
                  S/N | SAP CODE | PARTS NAME | SECTION | USE
                </span>{' '}
                (atau tanpa kolom S/N), lalu tempel ke kotak di bawah.
              </div>

              <textarea
                rows={7}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`2\t70172148\t7KSAOPY RING COPY-41\tpart\t1\n3\t70220338\t7KSAOZA NUTRING COZA-21\tKIJI H.BODY\t1`}
                className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-900 outline-none focus:border-blue-600"
              />

              <div className="text-xs text-slate-600">
                Terdeteksi{' '}
                <strong className="font-mono text-slate-900">
                  {parsedBulkPreview.length}
                </strong>{' '}
                baris part siap ditambahkan.
              </div>

              {bulkError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {bulkError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setBulkModalProduct(null)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={bulkSaving || parsedBulkPreview.length === 0}
                  className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {bulkSaving
                    ? 'Mengimpor...'
                    : `Tambahkan ${parsedBulkPreview.length} Part`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmations */}
      {confirmDeleteProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-slate-900">Hapus Model?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Model <strong>{confirmDeleteProduct.model_name}</strong> beserta{' '}
              {confirmDeleteProduct.parts.length} part akan dihapus dari master.
              Arsip opname bulan sebelumnya tetap tersimpan.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteProduct(null)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProduct}
                className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeletePart && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-slate-900">Hapus Part?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Part <strong>{confirmDeletePart.parts_name}</strong> (
              <span className="font-mono">{confirmDeletePart.sap_code}</span>) akan
              dihapus dari model ini.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeletePart(null)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePart}
                className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      <ExcelImportModal
        isOpen={excelImportOpen}
        existingProducts={products}
        onClose={() => setExcelImportOpen(false)}
        onSuccess={async (summary) => {
          setExcelImportOpen(false);
          await onRefresh();
          const partsText = `${summary.partsCount} part`;
          const segments: string[] = [];
          if (summary.createdCount > 0) {
            segments.push(`${summary.createdCount} model baru ditambahkan`);
          }
          if (summary.updatedCount > 0) {
            segments.push(`${summary.updatedCount} model diperbarui`);
          }
          if (summary.skippedCount > 0) {
            segments.push(`${summary.skippedCount} model dilewati`);
          }
          setImportBanner(
            `Import Excel selesai: ${segments.join(', ')} (${partsText}).`,
          );
        }}
      />
    </div>
  );
}
