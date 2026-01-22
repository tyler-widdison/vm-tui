/**
 * Team Mapping Utility
 * Loads team_mapping.json and provides lookup functions for team and conference data
 */

import fs from 'fs';
import path from 'path';

// ============================================
// Types
// ============================================

export interface MappedTeam {
  id: number;
  name: string;
  abbreviation: string;
  conference_id: number;
  conference_name: string;
  division: string;
}

export interface Conference {
  id: number;
  name: string;
  teams: MappedTeam[];
}

// ============================================
// Cache
// ============================================

let teamMappingCache: MappedTeam[] | null = null;
let conferenceCache: Conference[] | null = null;

// ============================================
// Loading Functions
// ============================================

/**
 * Load team mapping from JSON file
 * Caches the result for subsequent calls
 */
export function loadTeamMapping(): MappedTeam[] {
  if (teamMappingCache) {
    return teamMappingCache;
  }

  try {
    // Try multiple paths to find the file
    const possiblePaths = [
      path.join(process.cwd(), 'team_mapping.json'),
      path.join(__dirname, '../../team_mapping.json'),
      path.join(__dirname, '../../../team_mapping.json'),
    ];

    let content: string | null = null;
    for (const filePath of possiblePaths) {
      try {
        content = fs.readFileSync(filePath, 'utf-8');
        break;
      } catch {
        // Try next path
      }
    }

    if (!content) {
      console.warn('[TeamMapping] team_mapping.json not found, returning empty array');
      return [];
    }

    teamMappingCache = JSON.parse(content) as MappedTeam[];
    return teamMappingCache;
  } catch (error) {
    console.error('[TeamMapping] Failed to load team_mapping.json:', error);
    return [];
  }
}

/**
 * Build conference list from team mapping
 * Groups teams by conference
 */
export function buildConferenceList(): Conference[] {
  if (conferenceCache) {
    return conferenceCache;
  }

  const teams = loadTeamMapping();
  const conferenceMap = new Map<number, Conference>();

  for (const team of teams) {
    if (!conferenceMap.has(team.conference_id)) {
      conferenceMap.set(team.conference_id, {
        id: team.conference_id,
        name: team.conference_name,
        teams: [],
      });
    }
    conferenceMap.get(team.conference_id)!.teams.push(team);
  }

  // Sort conferences by name
  conferenceCache = Array.from(conferenceMap.values()).sort((a, b) => 
    a.name.localeCompare(b.name)
  );

  return conferenceCache;
}

// ============================================
// Lookup Functions
// ============================================

/**
 * Get a team by its ID
 */
export function getTeamById(id: number): MappedTeam | undefined {
  const teams = loadTeamMapping();
  return teams.find(t => t.id === id);
}

/**
 * Get a team by name (case-insensitive partial match)
 */
export function getTeamByName(name: string): MappedTeam | undefined {
  const teams = loadTeamMapping();
  const lowerName = name.toLowerCase();
  return teams.find(t => 
    t.name.toLowerCase() === lowerName || 
    t.abbreviation.toLowerCase() === lowerName
  );
}

/**
 * Get all teams in a specific conference
 */
export function getTeamsByConference(conferenceId: number): MappedTeam[] {
  const teams = loadTeamMapping();
  return teams.filter(t => t.conference_id === conferenceId);
}

/**
 * Get all teams in a conference by name
 */
export function getTeamsByConferenceName(conferenceName: string): MappedTeam[] {
  const teams = loadTeamMapping();
  const lowerName = conferenceName.toLowerCase();
  return teams.filter(t => t.conference_name.toLowerCase() === lowerName);
}

/**
 * Get list of all unique conferences
 */
export function getConferences(): Conference[] {
  return buildConferenceList();
}

/**
 * Get conference by ID
 */
export function getConferenceById(id: number): Conference | undefined {
  const conferences = buildConferenceList();
  return conferences.find(c => c.id === id);
}

/**
 * Get conference by name
 */
export function getConferenceByName(name: string): Conference | undefined {
  const conferences = buildConferenceList();
  const lowerName = name.toLowerCase();
  return conferences.find(c => c.name.toLowerCase() === lowerName);
}

/**
 * Find conference for a team by team name
 * Searches both full name and abbreviation
 */
export function getTeamConference(teamName: string): Conference | undefined {
  const team = getTeamByName(teamName);
  if (!team) return undefined;
  return getConferenceById(team.conference_id);
}

/**
 * Check if a team is in a specific conference
 */
export function isTeamInConference(teamName: string, conferenceId: number): boolean {
  const team = getTeamByName(teamName);
  return team ? team.conference_id === conferenceId : false;
}

/**
 * Search teams with conference filtering
 * Returns teams that match the search query AND are in the specified conference (if provided)
 */
export function searchTeamsWithConference(
  query: string,
  conferenceId?: number,
  maxResults: number = 10
): MappedTeam[] {
  let teams = loadTeamMapping();
  
  // Filter by conference first if specified
  if (conferenceId !== undefined) {
    teams = teams.filter(t => t.conference_id === conferenceId);
  }
  
  // If no query, return all (limited)
  if (!query || query.length < 1) {
    return teams.slice(0, maxResults);
  }
  
  const queryLower = query.toLowerCase().trim();
  
  // Score and filter teams
  const scored = teams.map(team => {
    const nameLower = team.name.toLowerCase();
    const abbrLower = team.abbreviation.toLowerCase();
    
    let score = 0;
    
    // Exact matches
    if (abbrLower === queryLower) score = 100;
    else if (nameLower === queryLower) score = 95;
    // Starts with
    else if (abbrLower.startsWith(queryLower)) score = 80;
    else if (nameLower.startsWith(queryLower)) score = 70;
    // Contains
    else if (abbrLower.includes(queryLower)) score = 60;
    else if (nameLower.includes(queryLower)) score = 50;
    // Word boundary match
    else {
      const words = nameLower.split(/\s+/);
      for (const word of words) {
        if (word.startsWith(queryLower)) {
          score = 65;
          break;
        }
      }
    }
    
    return { team, score };
  });
  
  // Filter out non-matches and sort by score
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.team);
}

/**
 * Get conference name for a team from the mapping
 * Searches by full name first, then by abbreviation
 * Returns the mapped conference name, or falls back to provided fallback
 * 
 * @param teamName Full team name (e.g., "University of Cincinnati")
 * @param teamAbbr Team abbreviation (e.g., "CINCI")
 * @param fallback Fallback value to return if team not found in mapping
 * @returns Conference name from mapping or fallback
 */
export function getTeamConferenceName(teamName: string, teamAbbr: string, fallback?: string): string {
  const teams = loadTeamMapping();
  const lowerName = teamName.toLowerCase();
  const lowerAbbr = teamAbbr.toLowerCase();
  
  // Try exact name match first
  const teamByName = teams.find(t => t.name.toLowerCase() === lowerName);
  if (teamByName) {
    return teamByName.conference_name;
  }
  
  // Try abbreviation match
  const teamByAbbr = teams.find(t => t.abbreviation.toLowerCase() === lowerAbbr);
  if (teamByAbbr) {
    return teamByAbbr.conference_name;
  }
  
  // Try partial name match (case-insensitive)
  const teamByPartial = teams.find(t => 
    lowerName.includes(t.name.toLowerCase()) || 
    t.name.toLowerCase().includes(lowerName)
  );
  if (teamByPartial) {
    return teamByPartial.conference_name;
  }
  
  // Return fallback if provided
  return fallback ?? '';
}

/**
 * Get conference name for display
 * Returns abbreviated version for common conferences
 */
export function getConferenceDisplayName(conferenceName: string): string {
  // Return as-is for most conferences, they're already short enough
  return conferenceName;
}

/**
 * Clear all caches (useful for testing or reloading)
 */
export function clearTeamMappingCache(): void {
  teamMappingCache = null;
  conferenceCache = null;
}
