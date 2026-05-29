'use strict';

// ── Preset themes ─────────────────────────────────────────────────────────────
// Each preset overrides only the vars that differ from the Artisan default.
// Empty vars = Artisan default (theme.css baseline).
window.POS_THEMES = {
  artisan: {
    name: 'Artisan',
    emoji: '☕',
    swatches: ['#FAF8F5', '#1C1917', '#D97706'],
    vars: {}
  },
  midnight: {
    name: 'Midnight',
    emoji: '🌙',
    swatches: ['#0F1117', '#6366F1', '#1A1D27'],
    vars: {
      '--bg':           '#0F1117',
      '--surface':      '#1A1D27',
      '--surface-2':    '#252836',
      '--card-thumb':   '#2D3147',
      '--border':       '#2D3147',
      '--border-strong':'#404560',
      '--text':         '#E8EAF6',
      '--text-2':       '#9FA3BE',
      '--text-3':       '#6B7099',
      '--ink':          '#6366F1',
      '--ink-text':     '#FFFFFF',
      '--ink-hover':    '#4F52CC',
      '--green-light':  '#0C2015',
      '--green-border': '#1A4A2C',
      '--amber-light':  '#1F1300',
      '--amber-border': '#4A2D00',
    }
  },
  ocean: {
    name: 'Ocean',
    emoji: '🌊',
    swatches: ['#EFF6FF', '#0284C7', '#BFDBFE'],
    vars: {
      '--bg':           '#EFF6FF',
      '--surface':      '#FFFFFF',
      '--surface-2':    '#DBEAFE',
      '--card-thumb':   '#BFDBFE',
      '--border':       '#BFDBFE',
      '--border-strong':'#93C5FD',
      '--text':         '#0F172A',
      '--text-2':       '#334155',
      '--text-3':       '#64748B',
      '--ink':          '#0284C7',
      '--ink-text':     '#FFFFFF',
      '--ink-hover':    '#0369A1',
    }
  },
  forest: {
    name: 'Forest',
    emoji: '🌿',
    swatches: ['#F0FDF4', '#15803D', '#BBF7D0'],
    vars: {
      '--bg':           '#F0FDF4',
      '--surface':      '#FFFFFF',
      '--surface-2':    '#DCFCE7',
      '--card-thumb':   '#BBF7D0',
      '--border':       '#BBF7D0',
      '--border-strong':'#86EFAC',
      '--text':         '#052E16',
      '--text-2':       '#166534',
      '--text-3':       '#4B7A5E',
      '--ink':          '#15803D',
      '--ink-text':     '#FFFFFF',
      '--ink-hover':    '#166534',
    }
  },
  slate: {
    name: 'Slate',
    emoji: '🪨',
    swatches: ['#F8FAFC', '#334155', '#CBD5E1'],
    vars: {
      '--bg':           '#F8FAFC',
      '--surface':      '#FFFFFF',
      '--surface-2':    '#F1F5F9',
      '--card-thumb':   '#CBD5E1',
      '--border':       '#CBD5E1',
      '--border-strong':'#94A3B8',
      '--text':         '#0F172A',
      '--text-2':       '#475569',
      '--text-3':       '#94A3B8',
      '--ink':          '#334155',
      '--ink-text':     '#FFFFFF',
      '--ink-hover':    '#1E293B',
    }
  },
  blush: {
    name: 'Blush',
    emoji: '🌸',
    swatches: ['#FFF1F2', '#BE123C', '#FECDD3'],
    vars: {
      '--bg':           '#FFF1F2',
      '--surface':      '#FFFFFF',
      '--surface-2':    '#FFE4E6',
      '--card-thumb':   '#FECDD3',
      '--border':       '#FECDD3',
      '--border-strong':'#FDA4AF',
      '--text':         '#1C0A0E',
      '--text-2':       '#6B2737',
      '--text-3':       '#9F4B5B',
      '--ink':          '#BE123C',
      '--ink-text':     '#FFFFFF',
      '--ink-hover':    '#9F1239',
    }
  },
  espresso: {
    name: 'Espresso',
    emoji: '🫘',
    swatches: ['#1C0A00', '#D97706', '#3D1A00'],
    vars: {
      '--bg':           '#1C0A00',
      '--surface':      '#2D1400',
      '--surface-2':    '#3D1A00',
      '--card-thumb':   '#4A2200',
      '--border':       '#5C2D00',
      '--border-strong':'#7A3D00',
      '--text':         '#FEF3C7',
      '--text-2':       '#FCD34D',
      '--text-3':       '#B45309',
      '--ink':          '#D97706',
      '--ink-text':     '#1C0A00',
      '--ink-hover':    '#F59E0B',
      '--green-light':  '#0A1A08',
      '--green-border': '#1A4020',
      '--amber-light':  '#2A1800',
      '--amber-border': '#5C3300',
    }
  },
};

// ── Apply a theme object to the document ──────────────────────────────────────
// themeData: { preset: 'midnight' } or { preset: 'custom', vars: { '--bg': '#...', ... } }
window.applyPosTheme = function(themeData) {
  const existing = document.getElementById('pos-theme-override');
  if (existing) existing.remove();
  if (!themeData || themeData.preset === 'artisan') return; // artisan = defaults

  const vars = themeData.preset === 'custom'
    ? (themeData.vars || {})
    : ((window.POS_THEMES[themeData.preset] || {}).vars || {});

  const entries = Object.entries(vars);
  if (!entries.length) return;

  const style = document.createElement('style');
  style.id = 'pos-theme-override';
  style.textContent = ':root{' + entries.map(([k, v]) => `${k}:${v}`).join(';') + '}';
  document.head.appendChild(style);
};

// ── Auto-apply from localStorage on every page load ───────────────────────────
(function () {
  try {
    const raw = localStorage.getItem('pos_theme');
    if (raw) window.applyPosTheme(JSON.parse(raw));
  } catch (_) {}
}());
