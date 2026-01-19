/**
 * Download utilities for VM-TUI
 * Handles video downloads with progress tracking
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MatchEvent, VideoInfo } from './api.js';
import { throttle } from './throttle.js';

// ============================================
// Types
// ============================================

export interface DownloadProgress {
  matchId: number;
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export interface DownloadResult {
  success: boolean;
  filepath?: string;
  error?: string;
}

// ============================================
// Configuration
// ============================================

/** Default download directory */
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'VM-TUI');

/**
 * Get the download directory, creating it if needed
 */
export async function getDownloadDir(): Promise<string> {
  const dir = DEFAULT_DOWNLOAD_DIR;
  
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    // Directory might already exist, that's fine
  }
  
  return dir;
}

// ============================================
// Filename Generation
// ============================================

/**
 * Generate a download filename for a match video
 * Format: "YYYY-MM-DD AWAY vs HOME.mp4"
 * 
 * @param match Match event data
 * @returns Formatted filename
 * 
 * @example
 * // Match: Oklahoma (home) vs Arkansas (away) on Nov 21, 2025
 * // Returns: "2025-11-21 ARK vs OU.mp4"
 */
export function generateVideoFilename(match: MatchEvent): string {
  const date = new Date(match.matchDate);
  
  // Format date as YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  // Get team abbreviations
  const homeAbbr = match.homeTeam.abbreviation;
  const awayAbbr = match.awayTeam.abbreviation;
  
  // Format: "YYYY-MM-DD AWAY vs HOME.mp4"
  // Away team listed first (they are the visiting team)
  return `${dateStr} ${awayAbbr} vs ${homeAbbr}.mp4`;
}

/**
 * Sanitize a filename to remove invalid characters
 */
function sanitizeFilename(filename: string): string {
  // Replace invalid filename characters with underscores
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}

// ============================================
// Download Functions
// ============================================

/**
 * Download a video file with progress tracking
 * 
 * @param videoInfo Video information with URL
 * @param match Match event data for filename
 * @param onProgress Progress callback
 * @returns Download result
 */
export async function downloadVideo(
  videoInfo: VideoInfo,
  match: MatchEvent,
  onProgress?: DownloadProgressCallback
): Promise<DownloadResult> {
  const downloadDir = await getDownloadDir();
  const filename = sanitizeFilename(generateVideoFilename(match));
  const filepath = path.join(downloadDir, filename);
  
  // Initialize progress
  const progress: DownloadProgress = {
    matchId: match.id,
    filename,
    bytesDownloaded: 0,
    totalBytes: 0,
    percent: 0,
    status: 'pending',
  };
  
  // Throttle progress updates to max 10/second to prevent UI flickering
  const throttledProgress = onProgress 
    ? throttle((p: DownloadProgress) => onProgress({ ...p }), 100)
    : undefined;
  
  onProgress?.(progress);
  
  try {
    // Check if file already exists
    try {
      const stats = await fs.promises.stat(filepath);
      if (stats.size > 0) {
        // File exists and has content, consider it complete
        return {
          success: true,
          filepath,
        };
      }
    } catch {
      // File doesn't exist, continue with download
    }
    
    // Start download
    progress.status = 'downloading';
    onProgress?.(progress);
    
    const response = await fetch(videoInfo.url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Get total size from Content-Length header
    const contentLength = response.headers.get('content-length');
    progress.totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    // Create write stream
    const fileStream = fs.createWriteStream(filepath);
    
    // Get response body as readable stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }
    
    // Download with progress tracking
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
      // Write chunk to file
      fileStream.write(Buffer.from(value));
      
      // Update progress
      progress.bytesDownloaded += value.length;
      if (progress.totalBytes > 0) {
        progress.percent = Math.round((progress.bytesDownloaded / progress.totalBytes) * 100);
      }
      
      // Use throttled callback for intermediate updates
      throttledProgress?.(progress);
    }
    
    // Close file stream
    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Mark as completed
    progress.status = 'completed';
    progress.percent = 100;
    onProgress?.(progress);
    
    return {
      success: true,
      filepath,
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    progress.status = 'error';
    progress.error = errorMessage;
    onProgress?.(progress);
    
    // Clean up partial file
    try {
      await fs.promises.unlink(filepath);
    } catch {
      // Ignore cleanup errors
    }
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format download speed
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
