/**
 * Download Context - Global download state management
 * Allows tracking downloads across page navigation
 */

import { downloadVideo, type DownloadProgress, type DownloadResult } from './download.js';
import { markAsDownloaded, type DownloadRecord } from './downloadTracker.js';
import { generateVideoFilename } from './download.js';
import type { MatchEvent, VideoInfo } from './api.js';

// ============================================
// Types
// ============================================

export interface ActiveDownload {
  matchId: number;
  match: MatchEvent;
  videoInfo: VideoInfo;
  progress: DownloadProgress;
  startedAt: number;
}

export interface CompletedDownload {
  matchId: number;
  match: MatchEvent;
  filepath: string;
  filename: string;
  completedAt: number;
}

export type DownloadManagerListener = (state: DownloadManagerState) => void;

export interface DownloadManagerState {
  activeDownloads: Map<number, ActiveDownload>;
  recentCompletions: CompletedDownload[];
  notifications: string[];
}

// ============================================
// Download Manager (Singleton)
// ============================================

class DownloadManager {
  private activeDownloads = new Map<number, ActiveDownload>();
  private recentCompletions: CompletedDownload[] = [];
  private notifications: string[] = [];
  private listeners: Set<DownloadManagerListener> = new Set();
  
  /**
   * Subscribe to state changes
   */
  subscribe(listener: DownloadManagerListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }
  
  /**
   * Get current state
   */
  getState(): DownloadManagerState {
    return {
      activeDownloads: new Map(this.activeDownloads),
      recentCompletions: [...this.recentCompletions],
      notifications: [...this.notifications],
    };
  }
  
  /**
   * Notify all listeners of state change
   */
  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
  
  /**
   * Check if a match is currently downloading
   */
  isDownloading(matchId: number): boolean {
    return this.activeDownloads.has(matchId);
  }
  
  /**
   * Get download progress for a match
   */
  getProgress(matchId: number): DownloadProgress | undefined {
    return this.activeDownloads.get(matchId)?.progress;
  }
  
  /**
   * Add a notification (auto-clears after timeout)
   */
  addNotification(message: string, timeoutMs: number = 5000) {
    this.notifications.push(message);
    this.notify();
    
    setTimeout(() => {
      const idx = this.notifications.indexOf(message);
      if (idx !== -1) {
        this.notifications.splice(idx, 1);
        this.notify();
      }
    }, timeoutMs);
  }
  
  /**
   * Clear a notification
   */
  clearNotification(message: string) {
    const idx = this.notifications.indexOf(message);
    if (idx !== -1) {
      this.notifications.splice(idx, 1);
      this.notify();
    }
  }
  
  /**
   * Start a download
   */
  async startDownload(
    match: MatchEvent,
    videoInfo: VideoInfo
  ): Promise<DownloadResult> {
    // Check if already downloading
    if (this.activeDownloads.has(match.id)) {
      return { success: false, error: 'Already downloading' };
    }
    
    // Initialize active download
    const activeDownload: ActiveDownload = {
      matchId: match.id,
      match,
      videoInfo,
      progress: {
        matchId: match.id,
        filename: generateVideoFilename(match),
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        status: 'pending',
      },
      startedAt: Date.now(),
    };
    
    this.activeDownloads.set(match.id, activeDownload);
    this.notify();
    
    try {
      // Perform download with progress tracking
      const result = await downloadVideo(
        videoInfo,
        match,
        (progress) => {
          const download = this.activeDownloads.get(match.id);
          if (download) {
            download.progress = progress;
            this.notify();
          }
        }
      );
      
      // Remove from active downloads
      this.activeDownloads.delete(match.id);
      
      if (result.success && result.filepath) {
        // Track in persistence
        const filename = generateVideoFilename(match);
        await markAsDownloaded(match.id, result.filepath, filename);
        
        // Add to recent completions
        const completion: CompletedDownload = {
          matchId: match.id,
          match,
          filepath: result.filepath,
          filename,
          completedAt: Date.now(),
        };
        this.recentCompletions.unshift(completion);
        
        // Keep only last 5 completions
        if (this.recentCompletions.length > 5) {
          this.recentCompletions.pop();
        }
        
        // Add notification
        this.addNotification(`Downloaded: ${filename}`, 10000);
      } else {
        // Add error notification
        this.addNotification(`Download failed: ${result.error || 'Unknown error'}`, 10000);
      }
      
      this.notify();
      return result;
      
    } catch (err) {
      // Remove from active downloads on error
      this.activeDownloads.delete(match.id);
      this.notify();
      
      const error = err instanceof Error ? err.message : 'Unknown error';
      this.addNotification(`Download failed: ${error}`, 10000);
      
      return { success: false, error };
    }
  }
}

// Singleton instance
export const downloadManager = new DownloadManager();
