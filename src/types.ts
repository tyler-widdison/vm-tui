/**
 * VM-TUI Type Definitions
 */

// App screen states
export type Screen = 
  | 'landing'
  | 'authenticating'
  | 'dashboard'
  | 'downloading'
  | 'error';

// Auth state
export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: User | null;
  error: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

// Content types
export type ContentType = 'video' | 'dvw' | 'schedule';

export interface ContentItem {
  id: string;
  type: ContentType;
  name: string;
  date: Date;
  size: number; // bytes
  url: string;
  teamId: string;
}

export interface Team {
  id: string;
  name: string;
  season: string;
}

// Download state
export interface DownloadItem {
  item: ContentItem;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  progress: number; // 0-100
  error?: string;
}

export interface DownloadState {
  items: DownloadItem[];
  isDownloading: boolean;
  currentIndex: number;
}

// Selection state for dashboard
export interface SelectionState {
  selectedIds: Set<string>;
  focusedIndex: number;
  filter: string;
}
