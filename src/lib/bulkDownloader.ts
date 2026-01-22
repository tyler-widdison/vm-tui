/**
 * Bulk Downloader Utility
 * Handles bulk downloads of multiple content types with folder organization
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { downloadVideo, downloadDVW, type DownloadProgress } from './download.js';
import { markAsDownloaded, markDVWAsDownloaded } from './downloadTracker.js';
import { generateVideoFilename } from './download.js';
import { downloadManager } from './downloadContext.js';
import type { MatchEvent, VideoInfo, DVWInfo, HudlAPI } from './api.js';
import type { HudlAuthData } from './auth.js';
import type { UnifiedContentAvailability } from './contentChecker.js';

// ============================================
// Types
// ============================================

export type BulkContentType = 'video' | 'dvw' | 'scoresheet';

export interface BulkDownloadItem {
  match: MatchEvent;
  availability: UnifiedContentAvailability;
  selectedTypes: Set<BulkContentType>;
}

export interface BulkDownloadOptions {
  customFolder?: string;
  organizeByType: boolean; // If true, create subfolders for each content type
}

export interface BulkDownloadProgress {
  totalItems: number;
  completedItems: number;
  currentItem?: {
    matchId: number;
    contentType: BulkContentType;
    filename: string;
  };
  results: BulkDownloadResult[];
}

export interface BulkDownloadResult {
  matchId: number;
  contentType: BulkContentType;
  success: boolean;
  filepath?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface BulkDownloadSummary {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  results: BulkDownloadResult[];
}

export type BulkProgressCallback = (progress: BulkDownloadProgress) => void;

// ============================================
// Configuration
// ============================================

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'VM-TUI');

// Content type subfolder names
const CONTENT_SUBFOLDERS: Record<BulkContentType, string> = {
  video: 'videos',
  dvw: 'dvw',
  scoresheet: 'scoresheets',
};

// ============================================
// Directory Functions
// ============================================

/**
 * Create download directory structure
 * If organizeByType is true, creates subfolders for each content type
 */
export async function createDownloadDirectories(
  options: BulkDownloadOptions,
  contentTypes: BulkContentType[]
): Promise<Map<BulkContentType, string>> {
  const dirs = new Map<BulkContentType, string>();
  
  let baseDir = DEFAULT_DOWNLOAD_DIR;
  
  if (options.customFolder) {
    baseDir = path.join(DEFAULT_DOWNLOAD_DIR, sanitizeFolderName(options.customFolder));
  }
  
  // Create base directory
  await fs.promises.mkdir(baseDir, { recursive: true });
  
  if (options.organizeByType) {
    // Create subfolders for each content type
    for (const type of contentTypes) {
      const subfolder = CONTENT_SUBFOLDERS[type];
      const typeDir = path.join(baseDir, subfolder);
      await fs.promises.mkdir(typeDir, { recursive: true });
      dirs.set(type, typeDir);
    }
  } else {
    // All content goes to base directory
    for (const type of contentTypes) {
      dirs.set(type, baseDir);
    }
  }
  
  return dirs;
}

/**
 * Sanitize a folder name to remove invalid characters
 */
function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Sanitize a filename to remove invalid characters
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}

// ============================================
// Bulk Download Functions
// ============================================

/**
 * Download multiple items with multiple content types
 * Organizes downloads by content type into subfolders
 * 
 * @param items Items to download with their selected content types
 * @param api HudlAPI instance
 * @param authData Authentication data
 * @param options Download options (custom folder, organization)
 * @param onProgress Progress callback
 * @returns Summary of download results
 */
export async function bulkDownload(
  items: BulkDownloadItem[],
  api: HudlAPI,
  authData: HudlAuthData,
  options: BulkDownloadOptions,
  onProgress?: BulkProgressCallback
): Promise<BulkDownloadSummary> {
  const results: BulkDownloadResult[] = [];
  
  // Count total downloads (each item can have multiple content types)
  let totalDownloads = 0;
  const allContentTypes = new Set<BulkContentType>();
  
  for (const item of items) {
    for (const type of item.selectedTypes) {
      totalDownloads++;
      allContentTypes.add(type);
    }
  }
  
  // Create directory structure
  const dirs = await createDownloadDirectories(options, Array.from(allContentTypes));
  
  // Initialize progress
  const progress: BulkDownloadProgress = {
    totalItems: totalDownloads,
    completedItems: 0,
    results: [],
  };
  
  // Update batch progress in download manager
  downloadManager.setBatchProgress({
    current: 0,
    total: totalDownloads,
  });
  
  onProgress?.(progress);
  
  // Process each item
  for (const item of items) {
    for (const contentType of item.selectedTypes) {
      const result = await downloadSingleContent(
        item.match,
        item.availability,
        contentType,
        dirs.get(contentType)!,
        api,
        authData
      );
      
      results.push(result);
      progress.completedItems++;
      progress.results.push(result);
      
      // Update download manager batch progress
      downloadManager.setBatchProgress({
        current: progress.completedItems,
        total: totalDownloads,
        currentMatchId: item.match.id,
      });
      
      onProgress?.(progress);
    }
  }
  
  // Clear batch progress
  downloadManager.setBatchProgress(null);
  
  // Calculate summary
  const summary: BulkDownloadSummary = {
    total: totalDownloads,
    downloaded: results.filter(r => r.success && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    failed: results.filter(r => !r.success && !r.skipped).length,
    results,
  };
  
  // Add notification with summary
  const msg = `Bulk download complete: ${summary.downloaded} downloaded, ${summary.skipped} skipped, ${summary.failed} failed`;
  downloadManager.addNotification(msg, 10000);
  
  return summary;
}

/**
 * Download a single content type for a match
 */
async function downloadSingleContent(
  match: MatchEvent,
  availability: UnifiedContentAvailability,
  contentType: BulkContentType,
  targetDir: string,
  api: HudlAPI,
  authData: HudlAuthData
): Promise<BulkDownloadResult> {
  // Check if content is available
  if (contentType === 'video') {
    if (!availability.video.available) {
      return {
        matchId: match.id,
        contentType,
        success: false,
        skipped: true,
        skipReason: 'Video not available',
      };
    }
    
    return await downloadVideoContent(match, availability.video, targetDir);
  }
  
  if (contentType === 'dvw') {
    if (!availability.dvw.available) {
      return {
        matchId: match.id,
        contentType,
        success: false,
        skipped: true,
        skipReason: 'DVW not available',
      };
    }
    
    return await downloadDVWContent(match, availability.dvw, targetDir, authData);
  }
  
  if (contentType === 'scoresheet') {
    // Scoresheets not yet implemented
    return {
      matchId: match.id,
      contentType,
      success: false,
      skipped: true,
      skipReason: 'Scoresheets coming soon',
    };
  }
  
  return {
    matchId: match.id,
    contentType,
    success: false,
    error: 'Unknown content type',
  };
}

/**
 * Download video content to specified directory
 */
async function downloadVideoContent(
  match: MatchEvent,
  videoInfo: VideoInfo,
  targetDir: string
): Promise<BulkDownloadResult> {
  const filename = sanitizeFilename(generateVideoFilename(match));
  const filepath = path.join(targetDir, filename);
  
  // Check if already exists
  try {
    const stats = await fs.promises.stat(filepath);
    if (stats.size > 0) {
      return {
        matchId: match.id,
        contentType: 'video',
        success: true,
        filepath,
        skipped: true,
        skipReason: 'Already downloaded',
      };
    }
  } catch {
    // File doesn't exist, continue with download
  }
  
  try {
    const response = await fetch(videoInfo.url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Get response body as readable stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }
    
    // Create write stream
    const fileStream = fs.createWriteStream(filepath);
    
    // Download with streaming
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
    
    // Close file stream
    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Track the download
    await markAsDownloaded(match.id, filepath, filename, 'video');
    
    return {
      matchId: match.id,
      contentType: 'video',
      success: true,
      filepath,
    };
    
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    
    // Clean up partial file
    try {
      await fs.promises.unlink(filepath);
    } catch {
      // Ignore cleanup errors
    }
    
    return {
      matchId: match.id,
      contentType: 'video',
      success: false,
      error,
    };
  }
}

/**
 * Download DVW content to specified directory
 */
async function downloadDVWContent(
  match: MatchEvent,
  dvwInfo: DVWInfo,
  targetDir: string,
  authData: HudlAuthData
): Promise<BulkDownloadResult> {
  const filename = sanitizeFilename(dvwInfo.filename);
  const filepath = path.join(targetDir, filename);
  
  // Check if already exists
  try {
    const stats = await fs.promises.stat(filepath);
    if (stats.size > 0) {
      return {
        matchId: match.id,
        contentType: 'dvw',
        success: true,
        filepath,
        skipped: true,
        skipReason: 'Already downloaded',
      };
    }
  } catch {
    // File doesn't exist, continue with download
  }
  
  try {
    // Use the API to download DVW content
    const { HudlAPI } = await import('./api.js');
    const api = new HudlAPI(authData);
    const content = await api.downloadDVWContent(match.id);
    
    if (!content) {
      throw new Error('DVW file not available or invalid format');
    }
    
    // Write to file
    await fs.promises.writeFile(filepath, content, 'utf-8');
    
    // Track the download
    await markDVWAsDownloaded(match.id, filepath, filename);
    
    return {
      matchId: match.id,
      contentType: 'dvw',
      success: true,
      filepath,
    };
    
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    
    // Clean up partial file
    try {
      await fs.promises.unlink(filepath);
    } catch {
      // Ignore cleanup errors
    }
    
    return {
      matchId: match.id,
      contentType: 'dvw',
      success: false,
      error,
    };
  }
}

/**
 * Get unique content types from selected items
 */
export function getSelectedContentTypes(items: BulkDownloadItem[]): Set<BulkContentType> {
  const types = new Set<BulkContentType>();
  for (const item of items) {
    for (const type of item.selectedTypes) {
      types.add(type);
    }
  }
  return types;
}

/**
 * Count total downloads from items
 */
export function countTotalDownloads(items: BulkDownloadItem[]): number {
  let count = 0;
  for (const item of items) {
    count += item.selectedTypes.size;
  }
  return count;
}

/**
 * Format bulk download summary for display
 */
export function formatBulkSummary(summary: BulkDownloadSummary): string {
  const parts: string[] = [];
  
  if (summary.downloaded > 0) {
    parts.push(`${summary.downloaded} downloaded`);
  }
  if (summary.skipped > 0) {
    parts.push(`${summary.skipped} skipped`);
  }
  if (summary.failed > 0) {
    parts.push(`${summary.failed} failed`);
  }
  
  return parts.join(', ');
}
