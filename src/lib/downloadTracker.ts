/**
 * Download Tracker - Persists downloaded video and DVW information
 * Stores match IDs and file paths in ~/.vm-tui/downloads.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================
// Types
// ============================================

export type ContentType = 'video' | 'dvw';

export interface DownloadRecord {
  matchId: number;
  filepath: string;
  filename: string;
  downloadedAt: string; // ISO date string
  contentType: ContentType; // Type of content (video or dvw)
}

interface DownloadsData {
  version: 1;
  downloads: DownloadRecord[];
}

// ============================================
// Configuration
// ============================================

const CONFIG_DIR = path.join(os.homedir(), '.vm-tui');
const DOWNLOADS_FILE = path.join(CONFIG_DIR, 'downloads.json');

// ============================================
// File Operations
// ============================================

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

/**
 * Load downloads data from file
 */
async function loadDownloadsData(): Promise<DownloadsData> {
  try {
    const content = await fs.promises.readFile(DOWNLOADS_FILE, 'utf-8');
    const data = JSON.parse(content) as DownloadsData;
    return data;
  } catch {
    // File doesn't exist or is invalid, return empty data
    return {
      version: 1,
      downloads: [],
    };
  }
}

/**
 * Save downloads data to file
 */
async function saveDownloadsData(data: DownloadsData): Promise<void> {
  await ensureConfigDir();
  await fs.promises.writeFile(DOWNLOADS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// Public API
// ============================================

/**
 * Mark a match as downloaded
 * 
 * @param matchId The match ID
 * @param filepath The full path to the downloaded file
 * @param filename The filename
 * @param contentType Type of content (video or dvw), defaults to 'video' for backward compatibility
 */
export async function markAsDownloaded(
  matchId: number,
  filepath: string,
  filename: string,
  contentType: ContentType = 'video'
): Promise<void> {
  const data = await loadDownloadsData();
  
  // Remove any existing record for this match AND content type
  // (a match can have both video and DVW downloads)
  data.downloads = data.downloads.filter(
    d => !(d.matchId === matchId && (d.contentType ?? 'video') === contentType)
  );
  
  // Add new record
  data.downloads.push({
    matchId,
    filepath,
    filename,
    downloadedAt: new Date().toISOString(),
    contentType,
  });
  
  await saveDownloadsData(data);
}

/**
 * Mark a DVW file as downloaded (convenience function)
 */
export async function markDVWAsDownloaded(
  matchId: number,
  filepath: string,
  filename: string
): Promise<void> {
  return markAsDownloaded(matchId, filepath, filename, 'dvw');
}

/**
 * Check if a match has been downloaded
 * Also verifies the file still exists on disk
 * 
 * @param matchId The match ID to check
 * @param contentType Optional content type filter (video or dvw)
 * @returns The download record if downloaded and file exists, null otherwise
 */
export async function getDownloadRecord(
  matchId: number,
  contentType?: ContentType
): Promise<DownloadRecord | null> {
  const data = await loadDownloadsData();
  const record = data.downloads.find(d => {
    if (d.matchId !== matchId) return false;
    if (contentType && (d.contentType ?? 'video') !== contentType) return false;
    return true;
  });
  
  if (!record) {
    return null;
  }
  
  // Verify file still exists
  try {
    const stats = await fs.promises.stat(record.filepath);
    if (stats.size > 0) {
      // Ensure contentType is set (backward compatibility)
      return { ...record, contentType: record.contentType ?? 'video' };
    }
  } catch {
    // File doesn't exist anymore, remove from tracker
    await removeDownloadRecord(matchId, record.contentType ?? 'video');
    return null;
  }
  
  return null;
}

/**
 * Check if a match has been downloaded (quick check without file verification)
 * 
 * @param matchId The match ID to check
 * @param contentType Optional content type filter (video or dvw)
 * @returns true if match is in download records
 */
export async function isDownloaded(
  matchId: number,
  contentType?: ContentType
): Promise<boolean> {
  const record = await getDownloadRecord(matchId, contentType);
  return record !== null;
}

/**
 * Check if a DVW file has been downloaded for a match
 */
export async function isDVWDownloaded(matchId: number): Promise<boolean> {
  return isDownloaded(matchId, 'dvw');
}

/**
 * Check if a video has been downloaded for a match
 */
export async function isVideoDownloaded(matchId: number): Promise<boolean> {
  return isDownloaded(matchId, 'video');
}

/**
 * Get all downloaded matches with verified files
 * 
 * @param contentType Optional content type filter (video or dvw)
 * @returns Map of matchId to DownloadRecord for all valid downloads
 */
export async function getDownloadedMatches(
  contentType?: ContentType
): Promise<Map<number, DownloadRecord>> {
  const data = await loadDownloadsData();
  const validDownloads = new Map<number, DownloadRecord>();
  const invalidRecords: { matchId: number; contentType: ContentType }[] = [];
  
  // Check each download
  for (const record of data.downloads) {
    // Apply content type filter if specified
    const recordType = record.contentType ?? 'video';
    if (contentType && recordType !== contentType) {
      continue;
    }
    
    try {
      const stats = await fs.promises.stat(record.filepath);
      if (stats.size > 0) {
        // For the map key, combine matchId with contentType to support both video and DVW for same match
        const key = contentType 
          ? record.matchId 
          : record.matchId * 10 + (recordType === 'dvw' ? 1 : 0); // Unique key per match+type
        validDownloads.set(record.matchId, { ...record, contentType: recordType });
      } else {
        invalidRecords.push({ matchId: record.matchId, contentType: recordType });
      }
    } catch {
      // File doesn't exist
      invalidRecords.push({ matchId: record.matchId, contentType: recordType });
    }
  }
  
  // Clean up invalid records if any
  if (invalidRecords.length > 0) {
    data.downloads = data.downloads.filter(d => {
      const recordType = d.contentType ?? 'video';
      return !invalidRecords.some(
        inv => inv.matchId === d.matchId && inv.contentType === recordType
      );
    });
    await saveDownloadsData(data);
  }
  
  return validDownloads;
}

/**
 * Get all downloaded DVW files with verified files
 */
export async function getDownloadedDVWs(): Promise<Map<number, DownloadRecord>> {
  return getDownloadedMatches('dvw');
}

/**
 * Get all downloaded videos with verified files
 */
export async function getDownloadedVideos(): Promise<Map<number, DownloadRecord>> {
  return getDownloadedMatches('video');
}

/**
 * Remove a download record
 * 
 * @param matchId The match ID to remove
 * @param contentType Optional content type filter (removes specific type, or all if not specified)
 */
export async function removeDownloadRecord(
  matchId: number,
  contentType?: ContentType
): Promise<void> {
  const data = await loadDownloadsData();
  
  if (contentType) {
    // Remove only the specific content type
    data.downloads = data.downloads.filter(
      d => !(d.matchId === matchId && (d.contentType ?? 'video') === contentType)
    );
  } else {
    // Remove all records for this match
    data.downloads = data.downloads.filter(d => d.matchId !== matchId);
  }
  
  await saveDownloadsData(data);
}

/**
 * Get the filepath for a downloaded match
 * 
 * @param matchId The match ID
 * @returns The filepath if downloaded and exists, null otherwise
 */
export async function getDownloadedFilepath(matchId: number): Promise<string | null> {
  const record = await getDownloadRecord(matchId);
  return record?.filepath ?? null;
}
