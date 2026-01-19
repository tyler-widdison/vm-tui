/**
 * Date utilities for VolleyMetrics TUI
 * Handles season calculations, date formatting, and match grouping
 */

import type { MatchEvent } from './api.js';

/**
 * Date range with ISO-formatted strings for API calls
 */
export interface DateRange {
  startDate: string; // ISO format: "2025-01-01T00:00:00.000"
  endDate: string;   // ISO format: "2025-12-31T23:59:00.000"
}

/**
 * Get the current volleyball season date range
 * 
 * Volleyball season typically runs:
 * - Fall: August - December
 * - Spring: January - May
 * 
 * Academic year: August 1 - May 31
 * 
 * @returns Date range for the current season
 */
export function getCurrentSeasonRange(): DateRange {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed (0 = January)
  
  let startYear: number;
  let endYear: number;
  
  // If we're in Jan-Jul, we're in the spring of the previous academic year
  // If we're in Aug-Dec, we're in the fall of the current academic year
  if (currentMonth < 7) { // January - July
    startYear = currentYear - 1;
    endYear = currentYear;
  } else { // August - December
    startYear = currentYear;
    endYear = currentYear + 1;
  }
  
  return {
    startDate: `${startYear}-08-01T00:00:00.000`,
    endDate: `${endYear}-05-31T23:59:00.000`,
  };
}

/**
 * Get date range for a specific number of months back from today
 * 
 * @param months Number of months to look back
 * @returns Date range
 */
export function getLastMonthsRange(months: number): DateRange {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  
  return {
    startDate: formatDateForAPI(start),
    endDate: formatDateForAPI(now),
  };
}

/**
 * Format a Date object for the VolleyMetrics API
 * 
 * @param date Date to format
 * @returns ISO-formatted string: "YYYY-MM-DDTHH:MM:SS.mmm"
 */
export function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Parse a match date string to a Date object
 * 
 * @param dateString Match date string (e.g., "2025-11-21T17:00")
 * @returns Date object
 */
export function parseMatchDate(dateString: string): Date {
  return new Date(dateString);
}

/**
 * Format a match date for display
 * 
 * @param dateString Match date string
 * @param format Display format
 * @returns Formatted date string
 */
export function formatMatchDate(
  dateString: string,
  format: 'short' | 'medium' | 'long' = 'medium'
): string {
  const date = parseMatchDate(dateString);
  
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  const fullMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const month = date.getMonth();
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  
  switch (format) {
    case 'short':
      // "Nov 21"
      return `${months[month]} ${day}`;
    case 'medium':
      // "Nov 21, 2025"
      return `${months[month]} ${day}, ${year}`;
    case 'long':
      // "November 21, 2025 at 5:00 PM"
      return `${fullMonths[month]} ${day}, ${year} at ${hour12}:${minutes} ${ampm}`;
    default:
      return `${months[month]} ${day}, ${year}`;
  }
}

/**
 * Format time from match date
 * 
 * @param dateString Match date string
 * @returns Time string (e.g., "5:00 PM")
 */
export function formatMatchTime(dateString: string): string {
  const date = parseMatchDate(dateString);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  
  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Get month key for grouping matches
 * 
 * @param dateString Match date string
 * @returns Month key (e.g., "November 2025")
 */
export function getMonthKey(dateString: string): string {
  const date = parseMatchDate(dateString);
  const fullMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  return `${fullMonths[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Group matches by month
 * 
 * @param matches Array of match events
 * @returns Map of month keys to match arrays, ordered by most recent first
 */
export function groupMatchesByMonth(matches: MatchEvent[]): Map<string, MatchEvent[]> {
  const groups = new Map<string, MatchEvent[]>();
  
  // Sort matches by date (newest first)
  const sortedMatches = [...matches].sort((a, b) => {
    return new Date(b.matchDate).getTime() - new Date(a.matchDate).getTime();
  });
  
  for (const match of sortedMatches) {
    const key = getMonthKey(match.matchDate);
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(match);
  }
  
  return groups;
}

/**
 * Get a sorted list of month keys (most recent first)
 * 
 * @param groups Grouped matches map
 * @returns Array of month keys sorted by date (newest first)
 */
export function getSortedMonthKeys(groups: Map<string, MatchEvent[]>): string[] {
  const keys = Array.from(groups.keys());
  
  // Parse month keys back to dates for sorting
  return keys.sort((a, b) => {
    const dateA = new Date(a); // "November 2025" -> Date
    const dateB = new Date(b);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Check if a match is in the future
 * 
 * @param dateString Match date string
 * @returns True if match is in the future
 */
export function isFutureMatch(dateString: string): boolean {
  return parseMatchDate(dateString).getTime() > Date.now();
}

/**
 * Check if a match is today
 * 
 * @param dateString Match date string
 * @returns True if match is today
 */
export function isToday(dateString: string): boolean {
  const matchDate = parseMatchDate(dateString);
  const today = new Date();
  
  return (
    matchDate.getFullYear() === today.getFullYear() &&
    matchDate.getMonth() === today.getMonth() &&
    matchDate.getDate() === today.getDate()
  );
}

/**
 * Get relative time description
 * 
 * @param dateString Match date string
 * @returns Relative description (e.g., "Today", "Yesterday", "2 days ago")
 */
export function getRelativeTime(dateString: string): string {
  const matchDate = parseMatchDate(dateString);
  const now = new Date();
  const diffMs = now.getTime() - matchDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    const futureDays = Math.abs(diffDays);
    if (futureDays === 0) return 'Today';
    if (futureDays === 1) return 'Tomorrow';
    return `In ${futureDays} days`;
  }
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
