/**
 * Download Tracker - Persists downloaded video information
 * Stores match IDs and file paths in ~/.vm-tui/downloads.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================
// Types
// ============================================

export interface DownloadRecord {
  matchId: number;
  filepath: string;
  filename: string;
  downloadedAt: string; // ISO date string
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
 */
export async function markAsDownloaded(
  matchId: number,
  filepath: string,
  filename: string
): Promise<void> {
  const data = await loadDownloadsData();
  
  // Remove any existing record for this match
  data.downloads = data.downloads.filter(d => d.matchId !== matchId);
  
  // Add new record
  data.downloads.push({
    matchId,
    filepath,
    filename,
    downloadedAt: new Date().toISOString(),
  });
  
  await saveDownloadsData(data);
}

/**
 * Check if a match has been downloaded
 * Also verifies the file still exists on disk
 * 
 * @param matchId The match ID to check
 * @returns The download record if downloaded and file exists, null otherwise
 */
export async function getDownloadRecord(matchId: number): Promise<DownloadRecord | null> {
  const data = await loadDownloadsData();
  const record = data.downloads.find(d => d.matchId === matchId);
  
  if (!record) {
    return null;
  }
  
  // Verify file still exists
  try {
    const stats = await fs.promises.stat(record.filepath);
    if (stats.size > 0) {
      return record;
    }
  } catch {
    // File doesn't exist anymore, remove from tracker
    await removeDownloadRecord(matchId);
    return null;
  }
  
  return null;
}

/**
 * Check if a match has been downloaded (quick check without file verification)
 * 
 * @param matchId The match ID to check
 * @returns true if match is in download records
 */
export async function isDownloaded(matchId: number): Promise<boolean> {
  const record = await getDownloadRecord(matchId);
  return record !== null;
}

/**
 * Get all downloaded matches with verified files
 * 
 * @returns Map of matchId to DownloadRecord for all valid downloads
 */
export async function getDownloadedMatches(): Promise<Map<number, DownloadRecord>> {
  const data = await loadDownloadsData();
  const validDownloads = new Map<number, DownloadRecord>();
  const invalidMatchIds: number[] = [];
  
  // Check each download
  for (const record of data.downloads) {
    try {
      const stats = await fs.promises.stat(record.filepath);
      if (stats.size > 0) {
        validDownloads.set(record.matchId, record);
      } else {
        invalidMatchIds.push(record.matchId);
      }
    } catch {
      // File doesn't exist
      invalidMatchIds.push(record.matchId);
    }
  }
  
  // Clean up invalid records if any
  if (invalidMatchIds.length > 0) {
    data.downloads = data.downloads.filter(d => !invalidMatchIds.includes(d.matchId));
    await saveDownloadsData(data);
  }
  
  return validDownloads;
}

/**
 * Remove a download record
 * 
 * @param matchId The match ID to remove
 */
export async function removeDownloadRecord(matchId: number): Promise<void> {
  const data = await loadDownloadsData();
  data.downloads = data.downloads.filter(d => d.matchId !== matchId);
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
