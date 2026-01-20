/**
 * Download Context - Global download state management
 * Allows tracking downloads across page navigation
 */

import { downloadVideo, downloadDVW, type DownloadProgress, type DownloadResult, type DownloadOptions } from './download.js';
import { markAsDownloaded, markDVWAsDownloaded, type DownloadRecord, type ContentType } from './downloadTracker.js';
import { generateVideoFilename } from './download.js';
import type { MatchEvent, VideoInfo, DVWInfo } from './api.js';
import type { HudlAuthData } from './auth.js';

// ============================================
// Types
// ============================================

export interface ActiveDownload {
  matchId: number;
  match: MatchEvent;
  videoInfo?: VideoInfo;
  dvwInfo?: DVWInfo;
  contentType: ContentType;
  progress: DownloadProgress;
  startedAt: number;
}

export interface CompletedDownload {
  matchId: number;
  match: MatchEvent;
  filepath: string;
  filename: string;
  contentType: ContentType;
  completedAt: number;
}

export interface BatchProgress {
  current: number;
  total: number;
  currentMatchId?: number;
}

export type DownloadManagerListener = (state: DownloadManagerState) => void;

export interface DownloadManagerState {
  activeDownloads: Map<number, ActiveDownload>;
  recentCompletions: CompletedDownload[];
  notifications: string[];
  batchProgress: BatchProgress | null;
}

// ============================================
// Download Manager (Singleton)
// ============================================

class DownloadManager {
  private activeDownloads = new Map<number, ActiveDownload>();
  private recentCompletions: CompletedDownload[] = [];
  private notifications: string[] = [];
  private listeners: Set<DownloadManagerListener> = new Set();
  private batchProgress: BatchProgress | null = null;
  
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
      batchProgress: this.batchProgress,
    };
  }
  
  /**
   * Set batch progress (called by batch download functions)
   */
  setBatchProgress(progress: BatchProgress | null) {
    this.batchProgress = progress;
    this.notify();
  }
  
  /**
   * Get current batch progress
   */
  getBatchProgress(): BatchProgress | null {
    return this.batchProgress;
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
   * Generate a unique key for active downloads (to support both video and DVW for same match)
   */
  private getDownloadKey(matchId: number, contentType: ContentType): string {
    return `${matchId}-${contentType}`;
  }
  
  /**
   * Check if a specific content type is currently downloading for a match
   */
  isDownloadingContent(matchId: number, contentType: ContentType): boolean {
    const key = this.getDownloadKey(matchId, contentType);
    for (const [, download] of this.activeDownloads) {
      if (download.matchId === matchId && download.contentType === contentType) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Start a video download
   */
  async startDownload(
    match: MatchEvent,
    videoInfo: VideoInfo,
    options?: DownloadOptions
  ): Promise<DownloadResult> {
    // Check if already downloading this video
    if (this.isDownloadingContent(match.id, 'video')) {
      return { success: false, error: 'Already downloading this video' };
    }
    
    // Initialize active download
    const activeDownload: ActiveDownload = {
      matchId: match.id,
      match,
      videoInfo,
      contentType: 'video',
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
        },
        options
      );
      
      // Remove from active downloads
      this.activeDownloads.delete(match.id);
      
      if (result.success && result.filepath) {
        // Track in persistence
        const filename = generateVideoFilename(match);
        await markAsDownloaded(match.id, result.filepath, filename, 'video');
        
        // Add to recent completions
        const completion: CompletedDownload = {
          matchId: match.id,
          match,
          filepath: result.filepath,
          filename,
          contentType: 'video',
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
  
  /**
   * Start a DVW file download
   */
  async startDVWDownload(
    match: MatchEvent,
    dvwInfo: DVWInfo,
    authData: HudlAuthData,
    options?: DownloadOptions
  ): Promise<DownloadResult> {
    // Check if already downloading this DVW
    if (this.isDownloadingContent(match.id, 'dvw')) {
      return { success: false, error: 'Already downloading this DVW file' };
    }
    
    // Use a unique key for DVW downloads (offset to avoid collision with video)
    const dvwKey = match.id + 1000000; // Offset to differentiate from video downloads
    
    // Initialize active download
    const activeDownload: ActiveDownload = {
      matchId: match.id,
      match,
      dvwInfo,
      contentType: 'dvw',
      progress: {
        matchId: match.id,
        filename: dvwInfo.filename,
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        status: 'pending',
      },
      startedAt: Date.now(),
    };
    
    this.activeDownloads.set(dvwKey, activeDownload);
    this.notify();
    
    try {
      // Perform download with progress tracking
      const result = await downloadDVW(
        dvwInfo,
        match,
        authData,
        (progress) => {
          const download = this.activeDownloads.get(dvwKey);
          if (download) {
            download.progress = progress;
            this.notify();
          }
        },
        options
      );
      
      // Remove from active downloads
      this.activeDownloads.delete(dvwKey);
      
      if (result.success && result.filepath) {
        // Track in persistence
        await markDVWAsDownloaded(match.id, result.filepath, dvwInfo.filename);
        
        // Add to recent completions
        const completion: CompletedDownload = {
          matchId: match.id,
          match,
          filepath: result.filepath,
          filename: dvwInfo.filename,
          contentType: 'dvw',
          completedAt: Date.now(),
        };
        this.recentCompletions.unshift(completion);
        
        // Keep only last 5 completions
        if (this.recentCompletions.length > 5) {
          this.recentCompletions.pop();
        }
        
        // Add notification
        this.addNotification(`Downloaded DVW: ${dvwInfo.filename}`, 10000);
      } else {
        // Add error notification
        this.addNotification(`DVW download failed: ${result.error || 'Unknown error'}`, 10000);
      }
      
      this.notify();
      return result;
      
    } catch (err) {
      // Remove from active downloads on error
      this.activeDownloads.delete(dvwKey);
      this.notify();
      
      const error = err instanceof Error ? err.message : 'Unknown error';
      this.addNotification(`DVW download failed: ${error}`, 10000);
      
      return { success: false, error };
    }
  }
}

// Singleton instance
export const downloadManager = new DownloadManager();
