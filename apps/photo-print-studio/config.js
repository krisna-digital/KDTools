/**
 * config.js — Konfigurasi terpusat PHOTO PRINT STUDIO.
 *
 * SEMUA ukuran fisik dalam MILIMETER. Ubah standar produksi di sini saja.
 * Ukuran pas foto menggunakan ukuran baku produksi (bukan nominal 20x30 / 30x40 / 40x60).
 */
(function () {
  'use strict';
  const PPS = (window.PPS = window.PPS || {});

  const SIZES = [
    // --- Pas foto (ukuran baku produksi) ---
    { id: '2x3', name: '2×3', w: 22, h: 33, group: 'Pas foto' },
    { id: '3x4', name: '3×4', w: 30, h: 40, group: 'Pas foto' },
    { id: '4x6', name: '4×6', w: 38, h: 56, group: 'Pas foto' },
    // --- Ukuran foto R ---
    { id: '2R', name: '2R', w: 60, h: 90, group: 'Foto R' },
    { id: '3R', name: '3R', w: 89, h: 127, group: 'Foto R' },
    { id: '4R', name: '4R', w: 100, h: 150, group: 'Foto R' },
    { id: '5R', name: '5R', w: 127, h: 180, group: 'Foto R' },
    { id: '6R', name: '6R', w: 152, h: 203, group: 'Foto R' },
    { id: '8R', name: '8R', w: 200, h: 250, group: 'Foto R' },
    { id: '10R', name: '10R', w: 200, h: 250, group: 'Foto R' },
    { id: '10RW', name: '10RW', w: 200, h: 300, group: 'Foto R' },
  ];

  const MEDIA = [
    { id: 'A4', name: 'A4', w: 210, h: 297 },
    { id: 'F4', name: 'F4', w: 210, h: 330 },
    { id: 'A3', name: 'A3', w: 297, h: 420 },
    { id: 'A3+', name: 'A3+', w: 329, h: 483 },
    { id: 'custom', name: 'Custom', w: 210, h: 297 },
  ];

  const BG_COLORS = [
    { id: 'red', label: 'Merah', color: '#d90f1c' },
    { id: 'blue', label: 'Biru', color: '#1f5fd6' },
    { id: 'white', label: 'Putih', color: '#ffffff' },
    { id: 'gray', label: 'Abu-abu', color: '#c9ccd1' },
    { id: 'green', label: 'Hijau', color: '#1f9d55' },
  ];

  const DEFAULT_SETTINGS = () => ({
    media: { preset: 'A4', w: 210, h: 297, orientation: 'portrait' },
    margins: { top: 5, bottom: 5, left: 5, right: 5 },
    spacing: { h: 2, v: 2 },
    bleed: 0,
    layout: {
      mode: 'efficiency', // efficiency | person | size | mixed | manual
      allowRotate: true,
      sizePriority: 'largest', // largest | smallest
      pageBreakPerPerson: false,
      backfill: false,
    },
    marks: { style: 'none', color: '#000000', width: 0.15, length: 2, offset: 0.5 },
    guides: { margin: true, bleed: false, center: false, grid: false, gridSize: 10, snap: false },
    export: { dpi: 300, jpegQuality: 0.92, zip: true },
  });

  PPS.Config = {
    VERSION: '1.0.0',
    SIZES,
    MEDIA,
    BG_COLORS,
    DPI_OPTIONS: [150, 240, 300, 600],
    MIN_SAFE_MARGIN: 3, // mm — di bawah ini diberi peringatan (area tak tercetak printer)
    DEFAULT_SETTINGS,
    SHADOW_DEFAULT: { on: false, opacity: 0.35, blur: 2.5, offset: 1.2 },

    /** Preset ukuran custom disimpan di LocalStorage. */
    customSizes() {
      try { return JSON.parse(localStorage.getItem('pps.customSizes') || '[]'); } catch (e) { return []; }
    },
    saveCustomSizes(list) { localStorage.setItem('pps.customSizes', JSON.stringify(list)); },
    /** Semua ukuran (baku + custom). */
    allSizes() {
      return SIZES.concat(this.customSizes().map((s) => Object.assign({ group: 'Custom' }, s)));
    },
    findSize(id) { return this.allSizes().find((s) => s.id === id) || null; },

    /** Ukuran halaman efektif (mm) sesuai orientasi. */
    pageSize(settings) {
      const a = Math.min(settings.media.w, settings.media.h);
      const b = Math.max(settings.media.w, settings.media.h);
      return settings.media.orientation === 'landscape' ? { w: b, h: a } : { w: a, h: b };
    },
    appSettings() {
      try { return JSON.parse(localStorage.getItem('pps.app') || '{}'); } catch (e) { return {}; }
    },
    saveAppSettings(o) { localStorage.setItem('pps.app', JSON.stringify(o)); },
  };
})();
