/**
 * VM-TUI Theme - OpenCode Inspired
 * Declarative theme with no configuration options
 */

export const theme = {
  // Primary colors
  primary: '#60A5FA',        // Blue - primary actions, highlights
  primaryDim: '#3B82F6',     // Darker blue - hover states
  
  // Accent colors  
  accent: '#A78BFA',         // Purple - secondary highlights
  success: '#34D399',        // Green - success states, checkmarks
  warning: '#FBBF24',        // Yellow/amber - warnings
  error: '#F87171',          // Red - errors, destructive actions
  info: '#38BDF8',           // Cyan - info states
  
  // Background colors
  background: '#0F1419',     // Dark background
  backgroundPanel: '#1A1F2E', // Panel/card backgrounds
  backgroundElement: '#242B3D', // Interactive element backgrounds
  
  // Border colors
  border: '#2D3748',         // Default borders
  borderActive: '#60A5FA',   // Active/focused borders
  borderSubtle: '#1E293B',   // Subtle separators
  
  // Text colors
  text: '#E2E8F0',           // Primary text
  textMuted: '#94A3B8',      // Secondary text
  textDim: '#64748B',        // Dimmed/disabled text
  textInverse: '#0F1419',    // Text on light backgrounds
  
  // Special
  selection: '#3B82F6',      // Selection highlight
  cursor: '#60A5FA',         // Cursor color
} as const;

// Border style - always rounded for modern look
export const borderStyle = 'round' as const;

// App info
export const app = {
  name: 'VM-TUI',
  version: '1.0.0',
  description: 'VolleyMetrics Content Tool',
} as const;

// Fixed keyboard shortcuts (declarative, no config)
export const keys = {
  quit: 'q',
  confirm: 'return',
  back: 'escape',
  toggle: ' ',
  search: '/',
  help: '?',
  refresh: 'r',
} as const;

export type Theme = typeof theme;
