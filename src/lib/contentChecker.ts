/**
 * Content Checker Utility
 * Unified content availability checking for Video, DVW, and Scoresheet
 */

import type { MatchEvent, VideoInfo, DVWInfo, HudlAPI } from './api.js';
import { VIDEO_CDN_BASE_URL, generateDVWFilename } from './api.js';

// ============================================
// Types
// ============================================

export type ContentTypeKey = 'video' | 'dvw' | 'scoresheet';

export interface ScoresheetInfo {
  available: boolean;
  matchId: number;
  filename: string;
  checked: boolean;
}

export interface UnifiedContentAvailability {
  matchId: number;
  video: VideoInfo;
  dvw: DVWInfo;
  scoresheet: ScoresheetInfo;
  checkedAt: number; // Timestamp when checked
}

export interface ContentCheckStatus {
  video: 'unknown' | 'checking' | 'available' | 'unavailable' | 'downloaded';
  dvw: 'unknown' | 'checking' | 'available' | 'unavailable' | 'downloaded';
  scoresheet: 'unknown' | 'checking' | 'available' | 'unavailable' | 'coming_soon';
}

// ============================================
// Content Checking Functions
// ============================================

/**
 * Generate a default scoresheet filename for a match
 * Format: YYYY-MM-DD_AWAY-vs-HOME_scoresheet.pdf
 */
export function generateScoresheetFilename(match: MatchEvent): string {
  const date = new Date(match.matchDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  const away = match.awayTeam.abbreviation || match.awayTeam.name;
  const home = match.homeTeam.abbreviation || match.homeTeam.name;
  
  return `${dateStr}_${away}-vs-${home}_scoresheet.pdf`;
}

/**
 * Check scoresheet availability for a match
 * NOTE: Currently a placeholder - scoresheets are not yet implemented
 * 
 * @param match Match event data
 * @returns ScoresheetInfo with availability status (always false for now)
 */
export function checkScoresheetAvailability(match: MatchEvent): ScoresheetInfo {
  // TODO: Implement actual scoresheet availability check when API is discovered
  // The MatchAnalysis type has a scoresheetId field which might be useful
  return {
    available: false, // Placeholder - always unavailable for now
    matchId: match.id,
    filename: generateScoresheetFilename(match),
    checked: true,
  };
}

/**
 * Check all content types for a match in a single API call
 * Uses the analysis API to determine video and DVW availability
 * Scoresheet is always "coming soon" for now
 * 
 * @param api HudlAPI instance
 * @param match Match event data
 * @returns UnifiedContentAvailability with all content types
 */
export async function checkAllContentAvailability(
  api: HudlAPI,
  match: MatchEvent
): Promise<UnifiedContentAvailability> {
  try {
    // Use the existing checkContentAvailability method which checks both DVW and Video
    const result = await api.checkContentAvailability(match);
    
    return {
      matchId: match.id,
      video: result.video,
      dvw: result.dvw,
      scoresheet: checkScoresheetAvailability(match),
      checkedAt: Date.now(),
    };
  } catch (error) {
    console.error(`[ContentChecker] Failed to check content for match ${match.id}:`, error);
    
    // Return all unavailable on error
    return {
      matchId: match.id,
      video: {
        available: false,
        url: '',
        filename: '',
        matchId: match.id,
        checked: true,
      },
      dvw: {
        available: false,
        matchId: match.id,
        filename: generateDVWFilename(match),
        checked: true,
      },
      scoresheet: checkScoresheetAvailability(match),
      checkedAt: Date.now(),
    };
  }
}

/**
 * Create initial unchecked content status
 */
export function createUnknownContentStatus(): ContentCheckStatus {
  return {
    video: 'unknown',
    dvw: 'unknown',
    scoresheet: 'coming_soon',
  };
}

/**
 * Create checking content status
 */
export function createCheckingContentStatus(): ContentCheckStatus {
  return {
    video: 'checking',
    dvw: 'checking',
    scoresheet: 'coming_soon',
  };
}

/**
 * Convert UnifiedContentAvailability to ContentCheckStatus
 */
export function availabilityToStatus(
  availability: UnifiedContentAvailability,
  downloadedVideos?: Set<number>,
  downloadedDVWs?: Set<number>
): ContentCheckStatus {
  let videoStatus: ContentCheckStatus['video'];
  if (downloadedVideos?.has(availability.matchId)) {
    videoStatus = 'downloaded';
  } else if (availability.video.available) {
    videoStatus = 'available';
  } else {
    videoStatus = 'unavailable';
  }

  let dvwStatus: ContentCheckStatus['dvw'];
  if (downloadedDVWs?.has(availability.matchId)) {
    dvwStatus = 'downloaded';
  } else if (availability.dvw.available) {
    dvwStatus = 'available';
  } else {
    dvwStatus = 'unavailable';
  }

  return {
    video: videoStatus,
    dvw: dvwStatus,
    scoresheet: 'coming_soon', // Always coming soon for now
  };
}

/**
 * Get display character for content status
 */
export function getStatusChar(status: ContentCheckStatus['video'] | ContentCheckStatus['scoresheet']): string {
  switch (status) {
    case 'unknown': return '?';
    case 'checking': return '*'; // Will be replaced with spinner in UI
    case 'available': return 'Y';
    case 'unavailable': return 'X';
    case 'downloaded': return 'D';
    case 'coming_soon': return '-';
    default: return '?';
  }
}

/**
 * Get display color for content status
 */
export function getStatusColor(status: ContentCheckStatus['video'] | ContentCheckStatus['scoresheet']): string {
  switch (status) {
    case 'unknown': return '#64748B'; // textDim
    case 'checking': return '#FBBF24'; // warning/yellow
    case 'available': return '#34D399'; // success/green
    case 'unavailable': return '#F87171'; // error/red
    case 'downloaded': return '#60A5FA'; // primary/blue
    case 'coming_soon': return '#64748B'; // textDim
    default: return '#64748B';
  }
}
