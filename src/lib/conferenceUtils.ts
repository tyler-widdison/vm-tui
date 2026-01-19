/**
 * Conference utilities - mapping and discovery for conference data
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MatchEvent, ConferenceInfo } from './api.js';

// ============================================
// Types
// ============================================

export interface ConferenceMapping {
  id: number;
  name?: string; // Conference name if known
  gender: string;
  level?: string;
  teams: string[]; // Team abbreviations associated with this conference
  lastUpdated: string;
}

interface ConferencesData {
  version: 1;
  conferences: ConferenceMapping[];
  lastDiscoveryAttempt?: string;
  discoveryEndpointFound?: boolean;
}

// ============================================
// Configuration
// ============================================

const CONFIG_DIR = path.join(os.homedir(), '.vm-tui');
const CONFERENCES_FILE = path.join(CONFIG_DIR, 'conferences.json');

// Known conference name mappings (partial list to start with)
const KNOWN_CONFERENCES: Record<number, string> = {
  1: 'AAC',
  6: 'Big East',
  11: 'Big Ten',
  12: 'Big 12',
  25: 'SEC',
  // Add more as you discover them
};

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
 * Load conferences data from file
 */
async function loadConferencesData(): Promise<ConferencesData> {
  try {
    const content = await fs.promises.readFile(CONFERENCES_FILE, 'utf-8');
    return JSON.parse(content) as ConferencesData;
  } catch {
    return {
      version: 1,
      conferences: [],
    };
  }
}

/**
 * Save conferences data to file
 */
async function saveConferencesData(data: ConferencesData): Promise<void> {
  await ensureConfigDir();
  await fs.promises.writeFile(CONFERENCES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// Conference Discovery
// ============================================

/**
 * Try to discover conference data from API
 * Attempts multiple potential endpoints
 * 
 * @param token Auth token
 * @returns Array of conferences if found, null if no endpoint works
 */
export async function discoverConferences(token: string): Promise<ConferenceMapping[] | null> {
  const baseUrl = 'https://api.volleymetrics.hudl.com';
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Origin': 'https://portal.volleymetrics.hudl.com',
  };
  
  // Endpoints to try
  const endpoints = [
    '/portal/conferences',
    '/portal/conferences/public',
    '/portal/conferences/all',
    '/acct/conferences',
    '/portal/leagues',
    '/portal/leagues/public',
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        
        // Try to parse as conference data
        const conferences = parseConferenceResponse(data);
        if (conferences && conferences.length > 0) {
          console.log(`[Conference] Found conferences at ${endpoint}`);
          
          // Save discovery result
          const existingData = await loadConferencesData();
          existingData.discoveryEndpointFound = true;
          existingData.lastDiscoveryAttempt = new Date().toISOString();
          await saveConferencesData(existingData);
          
          return conferences;
        }
      }
    } catch {
      // Endpoint doesn't exist or failed, try next
    }
  }
  
  // No endpoint found
  const existingData = await loadConferencesData();
  existingData.discoveryEndpointFound = false;
  existingData.lastDiscoveryAttempt = new Date().toISOString();
  await saveConferencesData(existingData);
  
  return null;
}

/**
 * Try to parse various response formats as conference data
 */
function parseConferenceResponse(data: unknown): ConferenceMapping[] | null {
  // Try array format
  if (Array.isArray(data)) {
    return data.map(item => parseConferenceItem(item)).filter(Boolean) as ConferenceMapping[];
  }
  
  // Try paginated format
  if (data && typeof data === 'object' && 'content' in data) {
    const content = (data as { content: unknown[] }).content;
    if (Array.isArray(content)) {
      return content.map(item => parseConferenceItem(item)).filter(Boolean) as ConferenceMapping[];
    }
  }
  
  return null;
}

/**
 * Parse a single conference item
 */
function parseConferenceItem(item: unknown): ConferenceMapping | null {
  if (!item || typeof item !== 'object') return null;
  
  const obj = item as Record<string, unknown>;
  
  if (typeof obj.id !== 'number') return null;
  
  return {
    id: obj.id,
    name: typeof obj.name === 'string' ? obj.name : undefined,
    gender: typeof obj.gender === 'string' ? obj.gender : 'UNKNOWN',
    level: obj.level && typeof obj.level === 'object' 
      ? (obj.level as { name?: string }).name 
      : undefined,
    teams: [],
    lastUpdated: new Date().toISOString(),
  };
}

// ============================================
// Conference Mapping from Match Data
// ============================================

/**
 * Build/update conference mappings from match data
 * This is the fallback when API discovery fails
 * 
 * @param matches Array of match events to scan
 */
export async function updateConferenceMappingsFromMatches(matches: MatchEvent[]): Promise<void> {
  const data = await loadConferencesData();
  const existingMap = new Map(data.conferences.map(c => [c.id, c]));
  
  for (const match of matches) {
    // Process home team
    updateConferenceFromTeam(existingMap, match.homeTeam.conference, match.homeTeam.abbreviation);
    
    // Process away team
    updateConferenceFromTeam(existingMap, match.awayTeam.conference, match.awayTeam.abbreviation);
  }
  
  // Save updated data
  data.conferences = Array.from(existingMap.values());
  await saveConferencesData(data);
}

/**
 * Update a conference entry from team data
 */
function updateConferenceFromTeam(
  map: Map<number, ConferenceMapping>,
  conf: ConferenceInfo,
  teamAbbr: string
): void {
  const existing = map.get(conf.id);
  
  if (existing) {
    // Update existing entry
    if (!existing.teams.includes(teamAbbr)) {
      existing.teams.push(teamAbbr);
    }
    existing.lastUpdated = new Date().toISOString();
  } else {
    // Create new entry
    map.set(conf.id, {
      id: conf.id,
      name: KNOWN_CONFERENCES[conf.id],
      gender: conf.gender,
      level: conf.level?.name,
      teams: [teamAbbr],
      lastUpdated: new Date().toISOString(),
    });
  }
}

// ============================================
// Conference Lookup
// ============================================

/**
 * Get all conference mappings
 */
export async function getConferenceMappings(): Promise<Map<number, ConferenceMapping>> {
  const data = await loadConferencesData();
  return new Map(data.conferences.map(c => [c.id, c]));
}

/**
 * Get conference name by ID
 * Returns the name if known, or "Conference {id}" if not
 * 
 * @param id Conference ID
 * @returns Conference name or formatted ID
 */
export async function getConferenceName(id: number): Promise<string> {
  // Check known conferences first
  if (KNOWN_CONFERENCES[id]) {
    return KNOWN_CONFERENCES[id];
  }
  
  // Check saved mappings
  const data = await loadConferencesData();
  const conf = data.conferences.find(c => c.id === id);
  
  if (conf?.name) {
    return conf.name;
  }
  
  // Return formatted ID
  return `Conf-${id}`;
}

/**
 * Get conference name synchronously (for use in render)
 * Uses cached known conferences only
 * 
 * @param id Conference ID
 * @returns Conference name or formatted ID
 */
export function getConferenceNameSync(id: number): string {
  return KNOWN_CONFERENCES[id] || `Conf-${id}`;
}

/**
 * Format conference display for UI
 * Shows name if known, otherwise just ID
 * 
 * @param conf ConferenceInfo object
 * @returns Formatted string like "SEC" or "25"
 */
export function formatConferenceDisplay(conf: ConferenceInfo): string {
  const name = KNOWN_CONFERENCES[conf.id];
  if (name) {
    return name;
  }
  return String(conf.id);
}

/**
 * Format conference display with ID
 * Shows "SEC-25" or just "25" if name unknown
 * 
 * @param conf ConferenceInfo object
 * @returns Formatted string like "SEC-25" or "25"
 */
export function formatConferenceWithId(conf: ConferenceInfo): string {
  const name = KNOWN_CONFERENCES[conf.id];
  if (name) {
    return `${name}-${conf.id}`;
  }
  return String(conf.id);
}

/**
 * Manually set a conference name
 * Allows user to add mappings as they discover them
 * 
 * @param id Conference ID
 * @param name Conference name
 */
export async function setConferenceName(id: number, name: string): Promise<void> {
  const data = await loadConferencesData();
  
  const existing = data.conferences.find(c => c.id === id);
  if (existing) {
    existing.name = name;
    existing.lastUpdated = new Date().toISOString();
  } else {
    data.conferences.push({
      id,
      name,
      gender: 'UNKNOWN',
      teams: [],
      lastUpdated: new Date().toISOString(),
    });
  }
  
  await saveConferencesData(data);
}

/**
 * Get list of teams in a conference
 * 
 * @param id Conference ID
 * @returns Array of team abbreviations
 */
export async function getConferenceTeams(id: number): Promise<string[]> {
  const data = await loadConferencesData();
  const conf = data.conferences.find(c => c.id === id);
  return conf?.teams || [];
}

/**
 * Get all unique conference IDs from saved data
 */
export async function getAllConferenceIds(): Promise<number[]> {
  const data = await loadConferencesData();
  return data.conferences.map(c => c.id).sort((a, b) => a - b);
}
