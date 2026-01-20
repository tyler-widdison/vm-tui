/**
 * Hudl VolleyMetrics API Client
 * Makes authenticated requests to the Hudl API
 */

import type { HudlAuthData } from './auth.js';

// API Base URL
const API_BASE_URL = 'https://api.volleymetrics.hudl.com';

// Request headers
const DEFAULT_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Origin': 'https://portal.volleymetrics.hudl.com',
  'X-Requested-With': 'XMLHttpRequest',
};

/**
 * API Error with status code
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Account types from the API
 */
export interface AccountType {
  accountClass: string;
  sport: string;
}

export interface Team {
  id: number;
  name: string;
  abbreviation: string;
  dvwAllowed: boolean;
  practiceAllowed: boolean;
  active: boolean;
  conference?: Conference;
}

export interface Conference {
  id: number;
  name: string;
  gender: string;
  court?: { id: number; type: string };
  level?: { id: number; name: string };
  openExchange: boolean;
}

export interface Account {
  id: number;
  accountType: AccountType;
  role: string;
  teamId: number;
  team: Team;
}

export interface AccountsResponse {
  userId: number;
  name: string;
  username: string;
  email: string;
  accounts: Account[];
}

// ============================================
// Match/Event Types (from /portal/events/mine)
// ============================================

/**
 * Conference information for a team
 */
export interface ConferenceInfo {
  id: number;
  gender: 'MALE' | 'FEMALE';
  court: {
    id: number;
    type: string; // 'Indoor' | 'Beach'
  };
  level: {
    id: number;
    name: string; // 'Collegiate', 'Club', etc.
  };
  openExchange: boolean;
}

/**
 * Team information as returned in match events
 */
export interface TeamInfo {
  id: number;
  name: string;
  abbreviation: string;
  conference: ConferenceInfo;
}

/**
 * Camera information for a venue
 */
export interface CameraInfo {
  id: number;
  name: string;
}

/**
 * Venue information for a match
 */
export interface VenueInfo {
  id: number;
  name: string;
  timezone: string;
  cameras: CameraInfo[];
  teams: TeamInfo[];
}

/**
 * A single match/event from the portal events API
 */
export interface MatchEvent {
  id: number;
  description: string | null;
  matchDate: string; // ISO format: "2025-11-21T17:00"
  isSetToRecord: boolean;
  matchType: 'MATCH' | 'PRACTICE';
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  venue: VenueInfo | null;
  isConferenceGame: boolean;
  sand: unknown | null; // Beach volleyball specific
}

/**
 * Pagination metadata from Spring Page response
 */
export interface PageableInfo {
  sort: {
    empty: boolean;
    sorted: boolean;
    unsorted: boolean;
  };
  offset: number;
  pageNumber: number;
  pageSize: number;
  paged: boolean;
  unpaged: boolean;
}

/**
 * Paginated response for matches/events
 */
export interface MatchesResponse {
  content: MatchEvent[];
  pageable: PageableInfo;
  last: boolean;
  totalPages: number;
  totalElements: number;
  size: number;
  number: number; // Current page number (0-based)
  sort: {
    empty: boolean;
    sorted: boolean;
    unsorted: boolean;
  };
  first: boolean;
  numberOfElements: number;
  empty: boolean;
}

/**
 * Parameters for fetching matches
 */
export interface GetMatchesParams {
  page?: number;
  size?: number;
  startDate: string; // ISO format: "2025-01-01T00:00:00.000"
  endDate: string;   // ISO format: "2026-01-01T23:59:00.000"
  matchType?: 'match' | 'practice';
  sort?: string[];   // e.g., ['matchDate,desc', 'id,desc']
  teamId?: number;   // Filter by specific team ID
  searchTerm?: string; // Search by team name (e.g., "University of Utah")
}

/**
 * Team from /portal/teams/byLeague endpoint
 * Simpler structure than the Team from accounts
 */
export interface LeagueTeam {
  id: number;
  name: string;
  abbreviation: string;
  conference: ConferenceInfo;
}

/**
 * Video availability information
 */
export interface VideoInfo {
  available: boolean;
  url: string;
  filename: string;
  matchId: number;
  checked: boolean; // Whether we've verified the URL exists
}

/**
 * DVW file availability information
 */
export interface DVWInfo {
  available: boolean;
  matchId: number;
  filename: string;
  checked: boolean;
}

/**
 * Combined content availability for a match (DVW + Video)
 */
export interface ContentAvailability {
  matchId: number;
  dvw: DVWInfo;
  video: VideoInfo;
}

/**
 * Set data from match analysis
 */
export interface SetData {
  setNumber?: number;
  homeScore?: number;
  awayScore?: number;
  rallyCount?: number;
  rallies?: unknown[];
}

/**
 * Match analysis response from /analysis/matches/{id}
 * Contains video URLs, DVW data, and detailed match events
 */
export interface MatchAnalysis {
  id: string;
  portalMatchId: number;
  scoresheetId: string | null;
  dvwFileId: string | null;
  rawVideoUrl: string | null;
  encodedVideoUrl: string | null;
  transcodingResult: string | null;
  lastUpdated: string;
  homeTeamId: number;
  awayTeamId: number;
  duration: number; // milliseconds
  sets: SetData[];
}

// ============================================
// Video URL Constants
// ============================================

/** CloudFront CDN base URL for video downloads */
export const VIDEO_CDN_BASE_URL = 'https://d3ndfq4ip6ejf2.cloudfront.net';

/** DVW generation endpoint base URL */
export const DVW_GENERATE_URL = 'https://api.volleymetrics.hudl.com/dvw/dvws/generate';

/**
 * Generate a DVW filename for a match
 * DVW files always start with & character
 * Format: &YYYY-MM-DD {matchId} AWAY-HOME.dvw
 */
export function generateDVWFilename(match: MatchEvent): string {
  const date = new Date(match.matchDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  const away = match.awayTeam.abbreviation || match.awayTeam.name;
  const home = match.homeTeam.abbreviation || match.homeTeam.name;
  
  // DVW files always start with &
  // Format: &2025-11-08 712795 MSU-ARK.dvw
  return `&${dateStr} ${match.id} ${away}-${home}.dvw`;
}

// ============================================
// Legacy placeholder types (kept for compatibility)
// ============================================

export interface Video {
  id: string;
  name: string;
  date: string;
  duration?: number;
  size?: number;
  downloadUrl?: string;
  teamId: number;
}

export interface Schedule {
  id: string;
  name: string;
  date: string;
  teamId: number;
}

export interface DVWFile {
  id: string;
  name: string;
  date: string;
  size?: number;
  downloadUrl?: string;
  teamId: number;
}

/**
 * Hudl API Client
 */
export class HudlAPI {
  private token: string;
  private accountId: number;

  constructor(authData: HudlAuthData) {
    this.token = authData.access_token;
    this.accountId = authData.activeAccountId;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      throw new APIError(
        `API request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorBody
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make authenticated API request and return raw response
   */
  private async requestRaw(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new APIError(
        `API request failed: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    return response;
  }

  /**
   * Get user accounts and teams
   */
  async getAccounts(): Promise<AccountsResponse> {
    return this.request<AccountsResponse>('/acct/accounts');
  }

  /**
   * Get current account ID
   */
  getActiveAccountId(): number {
    return this.accountId;
  }

  /**
   * Update active account ID (for switching teams)
   */
  setActiveAccountId(accountId: number): void {
    this.accountId = accountId;
  }

  // ============================================
  // MATCH/EVENT METHODS
  // ============================================

  /**
   * Get matches/events for the authenticated user's team(s)
   * 
   * @param params Query parameters for filtering and pagination
   * @returns Paginated list of matches
   * 
   * @example
   * const matches = await api.getMatches({
   *   startDate: '2025-08-01T00:00:00.000',
   *   endDate: '2026-05-31T23:59:00.000',
   *   matchType: 'match',
   *   page: 1,
   *   size: 35,
   * });
   */
  async getMatches(params: GetMatchesParams): Promise<MatchesResponse> {
    const searchParams = new URLSearchParams();
    
    // Pagination
    searchParams.set('page', String(params.page ?? 1));
    searchParams.set('size', String(params.size ?? 35));
    
    // Date range (required)
    searchParams.set('startDate', params.startDate);
    searchParams.set('endDate', params.endDate);
    
    // Match type filter
    if (params.matchType) {
      searchParams.set('matchType', params.matchType);
    }
    
    // Sorting - default to newest first
    const sortFields = params.sort ?? ['matchDate,desc', 'id,desc'];
    sortFields.forEach(sort => {
      searchParams.append('sort', sort);
    });
    
    const endpoint = `/portal/events/mine?${searchParams.toString()}`;
    return this.request<MatchesResponse>(endpoint);
  }

  /**
   * Get all matches for a date range (handles pagination automatically)
   * 
   * @param params Query parameters (page/size will be managed automatically)
   * @returns All matches in the date range
   */
  async getAllMatches(params: Omit<GetMatchesParams, 'page'>): Promise<MatchEvent[]> {
    const allMatches: MatchEvent[] = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const response = await this.getMatches({
        ...params,
        page,
        size: params.size ?? 50, // Larger page size for efficiency
      });
      
      allMatches.push(...response.content);
      hasMore = !response.last;
      page++;
      
      // Safety limit to prevent infinite loops
      if (page > 100) {
        console.warn('[API] Hit pagination safety limit at 100 pages');
        break;
      }
    }
    
    return allMatches;
  }

  /**
   * Get matches/events from ALL teams (not just user's team)
   * Uses the /portal/events/other endpoint
   * 
   * @param params Query parameters for filtering and pagination
   * @returns Paginated list of matches from all teams
   * 
   * @example
   * const matches = await api.getOtherMatches({
   *   startDate: '2024-08-15T00:00:00.000',
   *   endDate: '2024-12-25T22:48:47.310',
   *   matchType: 'match',
   *   page: 1,
   *   size: 20,
   *   searchTerm: 'University of Utah',
   * });
   */
  async getOtherMatches(params: GetMatchesParams): Promise<MatchesResponse> {
    const searchParams = new URLSearchParams();
    
    // Pagination
    searchParams.set('page', String(params.page ?? 1));
    searchParams.set('size', String(params.size ?? 20));
    
    // Date range (required)
    searchParams.set('startDate', params.startDate);
    searchParams.set('endDate', params.endDate);
    
    // Match type filter
    if (params.matchType) {
      searchParams.set('matchType', params.matchType);
    }
    
    // Team filter (matches where team is home OR away)
    if (params.teamId) {
      searchParams.set('teamId', String(params.teamId));
    }
    
    // Search term filter (team name search)
    if (params.searchTerm) {
      searchParams.set('searchTerm', params.searchTerm);
    }
    
    // Sorting - default to newest first
    const sortFields = params.sort ?? ['matchDate,desc', 'id,desc'];
    sortFields.forEach(sort => {
      searchParams.append('sort', sort);
    });
    
    const endpoint = `/portal/events/other?${searchParams.toString()}`;
    console.log(`[API] getOtherMatches URL: ${API_BASE_URL}${endpoint}`);
    console.log(`[API] getOtherMatches teamId param: ${params.teamId}`);
    
    return this.request<MatchesResponse>(endpoint);
  }

  /**
   * Get all "other" matches for a date range (handles pagination automatically)
   * Warning: This could return thousands of matches, use with caution
   * 
   * @param params Query parameters
   * @param maxPages Maximum pages to fetch (safety limit)
   * @returns All matches in the date range
   */
  async getAllOtherMatches(
    params: Omit<GetMatchesParams, 'page'>,
    maxPages: number = 10
  ): Promise<MatchEvent[]> {
    const allMatches: MatchEvent[] = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore && page <= maxPages) {
      const response = await this.getOtherMatches({
        ...params,
        page,
        size: params.size ?? 50,
      });
      
      allMatches.push(...response.content);
      hasMore = !response.last;
      page++;
    }
    
    return allMatches;
  }

  // ============================================
  // TEAM METHODS
  // ============================================

  /**
   * Get all teams from the league directory
   * Used for team search/autocomplete
   * 
   * @returns Array of all teams with conference info
   * 
   * @example
   * const teams = await api.getTeamsByLeague();
   * // Returns: [{ id: 114, name: "UC Riverside", abbreviation: "UCR", conference: {...} }, ...]
   */
  async getTeamsByLeague(): Promise<LeagueTeam[]> {
    return this.request<LeagueTeam[]>('/portal/teams/byLeague');
  }

  // ============================================
  // VIDEO URL METHODS
  // ============================================

  /**
   * Construct video URL from match data using CloudFront CDN pattern
   * 
   * Pattern: https://d3ndfq4ip6ejf2.cloudfront.net/YYYY.MM.DD-HH.MM-{matchId}.mp4
   * 
   * Note: The time in the URL appears to be 1 hour before matchDate (timezone adjustment?)
   * We'll try both the exact time and -1 hour as fallbacks.
   * 
   * @param match Match event data
   * @returns VideoInfo with constructed URL
   */
  constructVideoUrl(match: MatchEvent): VideoInfo {
    const matchDate = new Date(match.matchDate);
    
    // Format: YYYY.MM.DD-HH.MM
    const year = matchDate.getFullYear();
    const month = String(matchDate.getMonth() + 1).padStart(2, '0');
    const day = String(matchDate.getDate()).padStart(2, '0');
    const hours = String(matchDate.getHours()).padStart(2, '0');
    const minutes = String(matchDate.getMinutes()).padStart(2, '0');
    
    const filename = `${year}.${month}.${day}-${hours}.${minutes}-${match.id}.mp4`;
    const url = `${VIDEO_CDN_BASE_URL}/${filename}`;
    
    return {
      available: true, // Assume available, will verify with checkVideoAvailability
      url,
      filename,
      matchId: match.id,
      checked: false,
    };
  }

  /**
   * Construct alternate video URL with time offset
   * Some videos use a different time (possibly UTC vs local)
   * 
   * @param match Match event data
   * @param hourOffset Hours to subtract from match time (default: 1)
   * @returns VideoInfo with alternate URL
   */
  constructAlternateVideoUrl(match: MatchEvent, hourOffset: number = 1): VideoInfo {
    const matchDate = new Date(match.matchDate);
    matchDate.setHours(matchDate.getHours() - hourOffset);
    
    const year = matchDate.getFullYear();
    const month = String(matchDate.getMonth() + 1).padStart(2, '0');
    const day = String(matchDate.getDate()).padStart(2, '0');
    const hours = String(matchDate.getHours()).padStart(2, '0');
    const minutes = String(matchDate.getMinutes()).padStart(2, '0');
    
    const filename = `${year}.${month}.${day}-${hours}.${minutes}-${match.id}.mp4`;
    const url = `${VIDEO_CDN_BASE_URL}/${filename}`;
    
    return {
      available: true,
      url,
      filename,
      matchId: match.id,
      checked: false,
    };
  }

  /**
   * Check if a video URL is accessible (HEAD request)
   * 
   * @param videoInfo VideoInfo to check
   * @returns Updated VideoInfo with availability status
   */
  async checkVideoAvailability(videoInfo: VideoInfo): Promise<VideoInfo> {
    try {
      const response = await fetch(videoInfo.url, {
        method: 'HEAD',
        // No auth needed for CloudFront CDN
      });
      
      return {
        ...videoInfo,
        available: response.ok,
        checked: true,
      };
    } catch {
      // Network error or CORS issue
      return {
        ...videoInfo,
        available: false,
        checked: true,
      };
    }
  }

  /**
   * Match analysis response from /analysis/matches/{id}
   * Contains video URLs and DVW data
   */
  async getMatchAnalysis(matchId: number): Promise<MatchAnalysis> {
    return this.request<MatchAnalysis>(`/analysis/matches/${matchId}`);
  }

  /**
   * Find a working video URL for a match
   * Fetches from the analysis API to get the actual video URL
   * 
   * @param match Match event data
   * @returns VideoInfo with working URL, or unavailable status
   */
  async findVideoUrl(match: MatchEvent): Promise<VideoInfo> {
    try {
      // Fetch the match analysis which contains the actual video URL
      const analysis = await this.getMatchAnalysis(match.id);
      
      // Check if encodedVideoUrl exists
      if (analysis.encodedVideoUrl) {
        // Convert S3 URL to CloudFront URL for better download performance
        // S3: http://vm-transcoded-videos.s3.amazonaws.com/2025.11.21-16.00-712795.mp4
        // CloudFront: https://d3ndfq4ip6ejf2.cloudfront.net/2025.11.21-16.00-712795.mp4
        const filename = analysis.encodedVideoUrl.split('/').pop() || '';
        const cloudFrontUrl = `${VIDEO_CDN_BASE_URL}/${filename}`;
        
        return {
          available: true,
          url: cloudFrontUrl,
          filename,
          matchId: match.id,
          checked: true,
        };
      }
      
      // No video URL in analysis
      return {
        available: false,
        url: '',
        filename: '',
        matchId: match.id,
        checked: true,
      };
      
    } catch (error) {
      // API call failed - video might not be available
      return {
        available: false,
        url: '',
        filename: '',
        matchId: match.id,
        checked: true,
      };
    }
  }

  // ============================================
  // LEGACY PLACEHOLDER METHODS
  // ============================================

  /**
   * Get videos for a team
   * @deprecated Use getMatches() and constructVideoUrl() instead
   */
  async getVideos(teamId: number, _seasonId?: number): Promise<Video[]> {
    console.log(`[API] getVideos called for team ${teamId}`);
    return [];
  }

  /**
   * Get schedules for a team
   * TODO: Discover actual endpoint
   */
  async getSchedules(teamId: number, _seasonId?: number): Promise<Schedule[]> {
    console.log(`[API] getSchedules called for team ${teamId}`);
    return [];
  }

  /**
   * Get DVW files for a team
   * @deprecated Use checkDVWAvailability() with matches instead
   */
  async getDVWFiles(teamId: number): Promise<DVWFile[]> {
    console.log(`[API] getDVWFiles called for team ${teamId}`);
    return [];
  }

  /**
   * Get download URL for a video
   * @deprecated Use constructVideoUrl() instead
   */
  async getVideoDownloadUrl(_videoId: string): Promise<string> {
    throw new Error('Use constructVideoUrl() instead');
  }

  // ============================================
  // DVW FILE METHODS
  // ============================================

  /**
   * Get the DVW download URL for a match
   * Uses the generate endpoint which returns the DVW file content
   * 
   * @param matchId The portal match ID
   * @returns URL for DVW file generation/download
   */
  getDVWDownloadUrl(matchId: number): string {
    return `${DVW_GENERATE_URL}?portalMatchId=${matchId}`;
  }

/**
 * Check DVW availability for a match
 * Uses the analysis API response length to determine if there's enough data
 * 
 * NOTE: DVW can be generated if the analysis response has substantial data.
 * Matches without stats have minimal response (~500 chars or less).
 * 
 * @param match Match event data
 * @returns DVWInfo with availability status
 */
async checkDVWAvailability(match: MatchEvent): Promise<DVWInfo> {
  try {
    const response = await this.requestRaw(`/analysis/matches/${match.id}`);
    const responseText = await response.text();
    
    // DVW is available if the analysis response has substantial data
    // Empty/minimal responses are typically < 1000 chars
    const MIN_ANALYSIS_LENGTH = 1000;
    const available = responseText.length > MIN_ANALYSIS_LENGTH;
    
    console.log(`[API] DVW check for match ${match.id}: ${responseText.length} chars, available: ${available}`);
    
    return {
      available,
      matchId: match.id,
      filename: generateDVWFilename(match),
      checked: true,
    };
  } catch {
    // API call failed - assume DVW not available
    return {
      available: false,
      matchId: match.id,
      filename: generateDVWFilename(match),
      checked: true,
    };
  }
}

/**
 * Check both DVW and Video availability for a match
 * Useful for DVW browser to show both statuses
 * 
 * NOTE: DVW availability is determined by analysis response length (> 1000 chars)
 * 
 * @param match Match event data
 * @returns ContentAvailability with both DVW and video info
 */
async checkContentAvailability(match: MatchEvent): Promise<ContentAvailability> {
  try {
    const response = await this.requestRaw(`/analysis/matches/${match.id}`);
    const responseText = await response.text();
    const analysis = JSON.parse(responseText) as MatchAnalysis;
    
    // DVW is available if the analysis response has substantial data
    const MIN_ANALYSIS_LENGTH = 1000;
    const dvwAvailable = responseText.length > MIN_ANALYSIS_LENGTH;
    
    console.log(`[API] Content check for match ${match.id}: ${responseText.length} chars, DVW: ${dvwAvailable}`);
    
    const dvw: DVWInfo = {
      available: dvwAvailable,
      matchId: match.id,
      filename: generateDVWFilename(match),
      checked: true,
    };
      
    // Check Video availability
    let videoAvailable = false;
    let videoUrl = '';
    let videoFilename = '';
    
    if (analysis.encodedVideoUrl) {
      videoFilename = analysis.encodedVideoUrl.split('/').pop() || '';
      videoUrl = `${VIDEO_CDN_BASE_URL}/${videoFilename}`;
      videoAvailable = true;
    }
    
    const video: VideoInfo = {
      available: videoAvailable,
      url: videoUrl,
      filename: videoFilename,
      matchId: match.id,
      checked: true,
    };
      
      return { matchId: match.id, dvw, video };
    } catch {
      // Return both as unavailable on error
      return {
        matchId: match.id,
        dvw: {
          available: false,
          matchId: match.id,
          filename: generateDVWFilename(match),
          checked: true,
        },
        video: {
          available: false,
          url: '',
          filename: '',
          matchId: match.id,
          checked: true,
        },
      };
    }
  }

  /**
   * Download DVW file content from the generate endpoint
   * Returns the raw DVW text content
   * 
   * NOTE: This endpoint requires a POST request with an empty body
   * 
   * @param matchId The portal match ID
   * @returns DVW file content as string, or null if unavailable
   */
  async downloadDVWContent(matchId: number): Promise<string | null> {
    const url = this.getDVWDownloadUrl(matchId);
    
    console.log(`[API] DVW POST request to: ${url}`);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json;charset=utf-8',
          'Origin': 'https://portal.volleymetrics.hudl.com',
          'Referer': 'https://portal.volleymetrics.hudl.com/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: '', // Empty body for POST request
      });
      
      console.log(`[API] DVW response status: ${response.status} ${response.statusText}`);
      console.log(`[API] DVW response headers:`, Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        console.error(`[API] DVW download failed: ${response.status} ${response.statusText} for matchId ${matchId}`);
        return null;
      }
      
      const content = await response.text();
      console.log(`[API] DVW content length: ${content.length}, starts with: "${content.substring(0, 50)}"`);
      
      // Trim any leading whitespace/BOM and check for DVW format
      const trimmedContent = content.trimStart();
      
      // DVW files should contain "[3DATAVOLLEY" somewhere near the start
      // or start with & character
      const isDVWFormat = trimmedContent.startsWith('&') || 
                          trimmedContent.includes('[3DATAVOLLEY') ||
                          content.length > 100; // If we got substantial content, it's probably valid
      
      if (!isDVWFormat || content.length < 50) {
        console.warn(`[API] DVW content appears invalid for matchId ${matchId}. Length: ${content.length}, Preview: ${content.substring(0, 100)}`);
        return null;
      }
      
      // Return content as-is (it should start with & for proper DVW format)
      return content;
    } catch {
      return null;
    }
  }
}

/**
 * Test API connection with the given auth data
 */
export async function testAPIConnection(authData: HudlAuthData): Promise<{
  success: boolean;
  user?: { name: string; email: string };
  teams?: { id: number; name: string }[];
  error?: string;
}> {
  try {
    const api = new HudlAPI(authData);
    const accounts = await api.getAccounts();

    return {
      success: true,
      user: {
        name: accounts.name,
        email: accounts.email,
      },
      teams: accounts.accounts.map(acc => ({
        id: acc.team.id,
        name: acc.team.name,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
