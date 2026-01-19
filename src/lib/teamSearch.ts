/**
 * Team Search Utility
 * Provides fuzzy search/autocomplete for team names and abbreviations
 */

import type { LeagueTeam } from './api.js';

// ============================================
// Types
// ============================================

export interface TeamSearchResult {
  team: LeagueTeam;
  matchType: 'name' | 'abbreviation';
  matchScore: number; // Higher = better match
}

// ============================================
// Search Functions
// ============================================

/**
 * Search teams by name or abbreviation
 * 
 * @param teams - Array of all teams
 * @param query - Search query (case-insensitive)
 * @param maxResults - Maximum results to return (default: 5)
 * @returns Sorted array of matching teams
 * 
 * @example
 * const results = searchTeams(teams, "ucr");
 * // Returns: [{ team: { name: "UC Riverside", ... }, matchType: "abbreviation", matchScore: 100 }]
 */
export function searchTeams(
  teams: LeagueTeam[],
  query: string,
  maxResults: number = 5
): TeamSearchResult[] {
  if (!query || query.length < 1) {
    return [];
  }
  
  const queryLower = query.toLowerCase().trim();
  const results: TeamSearchResult[] = [];
  
  for (const team of teams) {
    const nameLower = team.name.toLowerCase();
    const abbrLower = team.abbreviation.toLowerCase();
    
    let matchScore = 0;
    let matchType: 'name' | 'abbreviation' = 'name';
    
    // Check abbreviation first (higher priority)
    if (abbrLower === queryLower) {
      // Exact abbreviation match - highest score
      matchScore = 100;
      matchType = 'abbreviation';
    } else if (abbrLower.startsWith(queryLower)) {
      // Abbreviation starts with query
      matchScore = 80 + (queryLower.length / abbrLower.length) * 10;
      matchType = 'abbreviation';
    } else if (abbrLower.includes(queryLower)) {
      // Abbreviation contains query
      matchScore = 60;
      matchType = 'abbreviation';
    }
    
    // Check name if no abbreviation match or to find better match
    if (nameLower === queryLower) {
      // Exact name match
      matchScore = Math.max(matchScore, 95);
      if (matchScore === 95) matchType = 'name';
    } else if (nameLower.startsWith(queryLower)) {
      // Name starts with query
      const score = 70 + (queryLower.length / nameLower.length) * 10;
      if (score > matchScore) {
        matchScore = score;
        matchType = 'name';
      }
    } else if (nameLower.includes(queryLower)) {
      // Name contains query
      const score = 50 + (queryLower.length / nameLower.length) * 10;
      if (score > matchScore) {
        matchScore = score;
        matchType = 'name';
      }
    }
    
    // Also check word boundaries in name (e.g., "riverside" matches "UC Riverside")
    const words = nameLower.split(/\s+/);
    for (const word of words) {
      if (word.startsWith(queryLower)) {
        const score = 65 + (queryLower.length / word.length) * 10;
        if (score > matchScore) {
          matchScore = score;
          matchType = 'name';
        }
      }
    }
    
    if (matchScore > 0) {
      results.push({ team, matchType, matchScore });
    }
  }
  
  // Sort by score (highest first), then by name length (shorter first)
  results.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    return a.team.name.length - b.team.name.length;
  });
  
  return results.slice(0, maxResults);
}

/**
 * Format a team for display in search results
 * Shows full name with abbreviation
 * 
 * @param team - Team to format
 * @returns Formatted string: "UC Riverside (UCR)"
 */
export function formatTeamDisplay(team: LeagueTeam): string {
  return `${team.name} (${team.abbreviation})`;
}

/**
 * Format a team for compact display
 * Shows abbreviation with optional name hint
 * 
 * @param team - Team to format
 * @returns Formatted string: "UCR - UC Riverside"
 */
export function formatTeamCompact(team: LeagueTeam): string {
  return `${team.abbreviation} - ${team.name}`;
}

// ============================================
// Team Cache
// ============================================

let cachedTeams: LeagueTeam[] | null = null;

/**
 * Get cached teams or fetch if not available
 * Teams rarely change, so caching is safe
 */
export function getCachedTeams(): LeagueTeam[] | null {
  return cachedTeams;
}

/**
 * Set the team cache
 */
export function setCachedTeams(teams: LeagueTeam[]): void {
  cachedTeams = teams;
}

/**
 * Clear the team cache
 */
export function clearTeamCache(): void {
  cachedTeams = null;
}
