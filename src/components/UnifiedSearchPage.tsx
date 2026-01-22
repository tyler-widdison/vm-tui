/**
 * UnifiedSearchPage - Combined search for all content types
 * 
 * Features:
 * - Conference autocomplete dropdown - search and select conference
 * - Team autocomplete dropdown - shows teams from selected conference, with "All Teams" option
 * - If conference is selected with "All Teams", searches ALL matches from that conference
 * - Date range input
 * - Shows all content types (Video, DVW, Scoresheet) availability
 * - Batch selection and download with content type subfolder organization
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { theme, borderStyle } from '../theme.js';
import {
  HudlAPI,
  groupMatchesByMonth,
  getSortedMonthKeys,
  formatMatchDate,
  formatConferenceDisplay,
  downloadManager,
  formatBytes,
  generateVideoFilename,
  getDownloadedMatches,
  getDownloadedDVWs,
  searchTeams,
  formatTeamDisplay,
  setCachedTeams,
  getCachedTeams,
  debounce,
  getDisplayPath,
  openDownloadDir,
  generateDVWFilename,
  type HudlAuthData,
  type MatchEvent,
  type VideoInfo,
  type DVWInfo,
  type DownloadRecord,
  type LeagueTeam,
  type TeamSearchResult,
} from '../lib/index.js';
import {
  getConferences,
  getTeamsByConference,
  loadTeamMapping,
  searchTeamsWithConference,
  getTeamConferenceName,
  type Conference,
  type MappedTeam,
} from '../lib/teamMapping.js';
import {
  checkAllContentAvailability,
  type UnifiedContentAvailability,
  type ContentCheckStatus,
} from '../lib/contentChecker.js';
import {
  bulkDownload,
  type BulkDownloadItem,
  type BulkContentType,
} from '../lib/bulkDownloader.js';
import { ContentTypeSelector } from './ContentTypeSelector.js';

// ============================================
// Types
// ============================================

interface UnifiedSearchPageProps {
  authData: HudlAuthData;
  onBack: () => void;
}

interface FilterState {
  // Conference filter
  conferenceSearchQuery: string;
  selectedConference: Conference | null;
  
  // Team filter  
  teamSearchQuery: string;
  selectedTeam: MappedTeam | null; // null means "All Teams" in conference
  
  // Date range (YYYY-MM-DD format)
  startDate: string;
  endDate: string;
}

interface PaginationState {
  currentPage: number;
  totalPages: number;
  totalMatches: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}

interface MatchWithContent extends MatchEvent {
  contentStatus: ContentCheckStatus;
  contentAvailability?: UnifiedContentAvailability;
  downloadedVideo?: DownloadRecord;
  downloadedDVW?: DownloadRecord;
}

type FocusArea = 'filters' | 'results' | 'selection';
type FilterField = 'conference' | 'team' | 'startDate' | 'endDate';

// ============================================
// Helper Functions
// ============================================

/** Check if a match date is in the future */
function isMatchInFuture(matchDate: string): boolean {
  return new Date(matchDate) > new Date();
}

/** Validate date string format (YYYY-MM-DD) */
function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** Format date as YYYY-MM-DD */
function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Get default date range - 3 months back to today */
function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  
  return {
    start: formatDateYYYYMMDD(threeMonthsAgo),
    end: formatDateYYYYMMDD(now),
  };
}

/** Search conferences by name */
function searchConferences(conferences: Conference[], query: string): Conference[] {
  if (!query || query.length < 1) return conferences.slice(0, 10);
  
  const queryLower = query.toLowerCase().trim();
  return conferences
    .filter(c => c.name.toLowerCase().includes(queryLower))
    .slice(0, 10);
}

/** Search teams within a conference */
function searchTeamsInConference(teams: MappedTeam[], query: string): MappedTeam[] {
  if (!query || query.length < 1) return teams.slice(0, 10);
  
  const queryLower = query.toLowerCase().trim();
  return teams
    .filter(t => 
      t.name.toLowerCase().includes(queryLower) ||
      t.abbreviation.toLowerCase().includes(queryLower)
    )
    .slice(0, 10);
}

// ============================================
// Component
// ============================================

export function UnifiedSearchPage({ authData, onBack }: UnifiedSearchPageProps) {
  // Filter state
  const defaultDates = useMemo(() => getDefaultDateRange(), []);
  const [filters, setFilters] = useState<FilterState>({
    conferenceSearchQuery: '',
    selectedConference: null,
    teamSearchQuery: '',
    selectedTeam: null,
    startDate: defaultDates.start,
    endDate: defaultDates.end,
  });
  
  // Conference data
  const conferences = useMemo(() => getConferences(), []);
  const [conferenceResults, setConferenceResults] = useState<Conference[]>([]);
  const [conferenceResultIdx, setConferenceResultIdx] = useState(0);
  const [showConferenceDropdown, setShowConferenceDropdown] = useState(false);
  
  // Team data (from team_mapping.json, filtered by conference)
  const teamsInConference = useMemo(() => {
    if (!filters.selectedConference) return [];
    return getTeamsByConference(filters.selectedConference.id);
  }, [filters.selectedConference]);
  
  const [teamResults, setTeamResults] = useState<MappedTeam[]>([]);
  const [teamResultIdx, setTeamResultIdx] = useState(0);
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  
  // API team list (for matching with API results)
  const [allApiTeams, setAllApiTeams] = useState<LeagueTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  
  // Match state
  const [matches, setMatches] = useState<MatchWithContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  // Pagination state
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 0,
    totalPages: 0,
    totalMatches: 0,
    hasMore: false,
    isLoadingMore: false,
  });
  
  // Navigation state
  const [focusArea, setFocusArea] = useState<FocusArea>('filters');
  const [filterField, setFilterField] = useState<FilterField>('conference');
  const [resultIndex, setResultIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  
  // Download tracking
  const [downloadedVideos, setDownloadedVideos] = useState<Map<number, DownloadRecord>>(new Map());
  const [downloadedDVWs, setDownloadedDVWs] = useState<Map<number, DownloadRecord>>(new Map());
  const [notification, setNotification] = useState<string | null>(null);
  
  // Selection state for batch downloads
  const [selectedMatches, setSelectedMatches] = useState<Set<number>>(new Set());
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  
  // Content type selector modal
  const [showContentTypeSelector, setShowContentTypeSelector] = useState(false);
  
  // Content check cache
  const contentCache = useRef<Map<number, UnifiedContentAvailability>>(new Map());
  
  // API client
  const api = useMemo(() => new HudlAPI(authData), [authData]);
  
  // Grouped matches for display
  const groupedMatches = useMemo(() => groupMatchesByMonth(matches), [matches]);
  const monthKeys = useMemo(() => getSortedMonthKeys(groupedMatches), [groupedMatches]);
  
  // Build flat list for navigation
  const flatList = useMemo(() => {
    const items: Array<{ type: 'section'; key: string } | { type: 'match'; match: MatchWithContent }> = [];
    
    for (const monthKey of monthKeys) {
      items.push({ type: 'section', key: monthKey });
      
      if (expandedSections.has(monthKey)) {
        const monthMatches = groupedMatches.get(monthKey) || [];
        for (const match of monthMatches) {
          items.push({ type: 'match', match: match as MatchWithContent });
        }
      }
    }
    
    return items;
  }, [monthKeys, expandedSections, groupedMatches]);
  
  // Check if search can be executed - need either a conference OR a team
  const canSearch = (filters.selectedConference !== null || filters.selectedTeam !== null) && 
    isValidDate(filters.startDate) && 
    isValidDate(filters.endDate);
  
  // ============================================
  // Effects
  // ============================================
  
  // Load API team list on mount
  useEffect(() => {
    async function loadTeams() {
      const cached = getCachedTeams();
      if (cached) {
        setAllApiTeams(cached);
        setTeamsLoading(false);
        return;
      }
      
      try {
        setTeamsLoading(true);
        const teams = await api.getTeamsByLeague();
        setAllApiTeams(teams);
        setCachedTeams(teams);
      } catch (err) {
        setTeamsError(err instanceof Error ? err.message : 'Failed to load teams');
      } finally {
        setTeamsLoading(false);
      }
    }
    loadTeams();
  }, [api]);
  
  // Update conference search results
  useEffect(() => {
    if (showConferenceDropdown) {
      const results = searchConferences(conferences, filters.conferenceSearchQuery);
      setConferenceResults(results);
      setConferenceResultIdx(0);
    }
  }, [filters.conferenceSearchQuery, conferences, showConferenceDropdown]);
  
  // Update team search results when conference changes or query changes
  useEffect(() => {
    if (showTeamDropdown && filters.selectedConference) {
      const results = searchTeamsInConference(teamsInConference, filters.teamSearchQuery);
      setTeamResults(results);
      setTeamResultIdx(0);
    }
  }, [filters.teamSearchQuery, teamsInConference, showTeamDropdown, filters.selectedConference]);
  
  // Load downloaded status on mount
  useEffect(() => {
    async function loadDownloadedStatus() {
      try {
        const [videos, dvws] = await Promise.all([
          getDownloadedMatches('video'),
          getDownloadedDVWs(),
        ]);
        setDownloadedVideos(videos);
        setDownloadedDVWs(dvws);
      } catch (err) {
        console.error('Failed to load download status:', err);
      }
    }
    loadDownloadedStatus();
  }, []);
  
  // Update matches with download status
  useEffect(() => {
    if (matches.length > 0 && (downloadedVideos.size > 0 || downloadedDVWs.size > 0)) {
      setMatches(prev => prev.map(m => {
        const videoRecord = downloadedVideos.get(m.id);
        const dvwRecord = downloadedDVWs.get(m.id);
        
        const newStatus = { ...m.contentStatus };
        if (videoRecord && newStatus.video !== 'downloaded') {
          newStatus.video = 'downloaded';
        }
        if (dvwRecord && newStatus.dvw !== 'downloaded') {
          newStatus.dvw = 'downloaded';
        }
        
        return {
          ...m,
          contentStatus: newStatus,
          downloadedVideo: videoRecord,
          downloadedDVW: dvwRecord,
        };
      }));
    }
  }, [matches.length, downloadedVideos, downloadedDVWs]);
  
  // Auto-expand first section when results change
  useEffect(() => {
    if (monthKeys.length > 0 && expandedSections.size === 0) {
      setExpandedSections(new Set([monthKeys[0]!]));
    }
  }, [monthKeys]);
  
  // Lazy content check for visible items
  useEffect(() => {
    if (focusArea !== 'results' || matches.length === 0) return;
    
    const startIdx = Math.max(0, resultIndex - 5);
    const endIdx = Math.min(flatList.length - 1, resultIndex + 5);
    
    for (let i = startIdx; i <= endIdx; i++) {
      const item = flatList[i];
      if (item?.type === 'match') {
        const match = item.match;
        if (match.contentStatus.video === 'unknown' && !isMatchInFuture(match.matchDate)) {
          checkContentForMatch(match);
        }
      }
    }
  }, [resultIndex, flatList, focusArea]);
  
  // Lazy load more when scrolling near bottom
  useEffect(() => {
    if (focusArea !== 'results') return;
    if (!pagination.hasMore || pagination.isLoadingMore) return;
    
    if (resultIndex >= flatList.length - 10) {
      loadMoreMatches();
    }
  }, [resultIndex, flatList.length, pagination.hasMore, pagination.isLoadingMore]);
  
  // ============================================
  // Actions
  // ============================================
  
  // Check content availability for a match
  const checkContentForMatch = useCallback(async (match: MatchWithContent) => {
    if (contentCache.current.has(match.id)) {
      const cached = contentCache.current.get(match.id)!;
      setMatches(prev => prev.map(m => {
        if (m.id !== match.id) return m;
        
        const newStatus: ContentCheckStatus = {
          video: downloadedVideos.has(m.id) ? 'downloaded' : (cached.video.available ? 'available' : 'unavailable'),
          dvw: downloadedDVWs.has(m.id) ? 'downloaded' : (cached.dvw.available ? 'available' : 'unavailable'),
          scoresheet: 'coming_soon',
        };
        
        return { ...m, contentStatus: newStatus, contentAvailability: cached };
      }));
      return;
    }
    
    setMatches(prev => prev.map(m => 
      m.id === match.id 
        ? { ...m, contentStatus: { video: 'checking', dvw: 'checking', scoresheet: 'coming_soon' } }
        : m
    ));
    
    try {
      const availability = await checkAllContentAvailability(api, match);
      contentCache.current.set(match.id, availability);
      
      setMatches(prev => prev.map(m => {
        if (m.id !== match.id) return m;
        
        const newStatus: ContentCheckStatus = {
          video: downloadedVideos.has(m.id) ? 'downloaded' : (availability.video.available ? 'available' : 'unavailable'),
          dvw: downloadedDVWs.has(m.id) ? 'downloaded' : (availability.dvw.available ? 'available' : 'unavailable'),
          scoresheet: 'coming_soon',
        };
        
        return { ...m, contentStatus: newStatus, contentAvailability: availability };
      }));
    } catch {
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, contentStatus: { video: 'unavailable', dvw: 'unavailable', scoresheet: 'coming_soon' } }
          : m
      ));
    }
  }, [api, downloadedVideos, downloadedDVWs]);
  
  // Execute search - supports conference-wide search or specific team search
  const executeSearch = useCallback(async () => {
    if (!canSearch) return;
    
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setMatches([]);
    setExpandedSections(new Set());
    setResultIndex(0);
    setSelectedMatches(new Set());
    
    try {
      let allMatches: MatchEvent[] = [];
      
      if (filters.selectedTeam) {
        // Search for specific team
        const response = await api.getOtherMatches({
          startDate: `${filters.startDate}T00:00:00.000`,
          endDate: `${filters.endDate}T23:59:00.000`,
          matchType: 'match',
          page: 1,
          size: 50,
          searchTerm: filters.selectedTeam.name,
        });
        
        allMatches = response.content;
        
        // Fallback to abbreviation if no results
        if (allMatches.length === 0) {
          const fallbackResponse = await api.getOtherMatches({
            startDate: `${filters.startDate}T00:00:00.000`,
            endDate: `${filters.endDate}T23:59:00.000`,
            matchType: 'match',
            page: 1,
            size: 50,
            searchTerm: filters.selectedTeam.abbreviation,
          });
          allMatches = fallbackResponse.content;
        }
        
        setPagination({
          currentPage: 1,
          totalPages: 1,
          totalMatches: allMatches.length,
          hasMore: false,
          isLoadingMore: false,
        });
        
      } else if (filters.selectedConference) {
        // Search for ALL teams in the conference
        const conferenceTeams = getTeamsByConference(filters.selectedConference.id);
        
        // Search for each team in parallel (limited batch)
        const teamBatches: MappedTeam[][] = [];
        for (let i = 0; i < conferenceTeams.length; i += 5) {
          teamBatches.push(conferenceTeams.slice(i, i + 5));
        }
        
        const matchSet = new Map<number, MatchEvent>(); // Dedupe by match ID
        
        for (const batch of teamBatches) {
          const batchResults = await Promise.all(
            batch.map(async team => {
              try {
                const response = await api.getOtherMatches({
                  startDate: `${filters.startDate}T00:00:00.000`,
                  endDate: `${filters.endDate}T23:59:00.000`,
                  matchType: 'match',
                  page: 1,
                  size: 30,
                  searchTerm: team.name,
                });
                return response.content;
              } catch {
                return [];
              }
            })
          );
          
          for (const matches of batchResults) {
            for (const match of matches) {
              matchSet.set(match.id, match);
            }
          }
        }
        
        allMatches = Array.from(matchSet.values());
        
        // Sort by date (newest first)
        allMatches.sort((a, b) => new Date(b.matchDate).getTime() - new Date(a.matchDate).getTime());
        
        setPagination({
          currentPage: 1,
          totalPages: 1,
          totalMatches: allMatches.length,
          hasMore: false, // All loaded at once for conference search
          isLoadingMore: false,
        });
      }
      
      // Convert to MatchWithContent
      const matchesWithContent: MatchWithContent[] = allMatches.map(match => ({
        ...match,
        contentStatus: { video: 'unknown', dvw: 'unknown', scoresheet: 'coming_soon' },
      }));
      
      setMatches(matchesWithContent);
      setFocusArea('results');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search matches');
    } finally {
      setLoading(false);
    }
  }, [api, filters, canSearch]);
  
  // Load more matches (for team-specific searches with pagination)
  const loadMoreMatches = useCallback(async () => {
    if (!filters.selectedTeam || pagination.isLoadingMore || !pagination.hasMore) return;
    
    setPagination(prev => ({ ...prev, isLoadingMore: true }));
    
    try {
      const nextPage = pagination.currentPage + 1;
      const response = await api.getOtherMatches({
        startDate: `${filters.startDate}T00:00:00.000`,
        endDate: `${filters.endDate}T23:59:00.000`,
        searchTerm: filters.selectedTeam.name,
        matchType: 'match',
        page: nextPage,
        size: 50,
      });
      
      const newMatches: MatchWithContent[] = response.content.map(match => ({
        ...match,
        contentStatus: { video: 'unknown', dvw: 'unknown', scoresheet: 'coming_soon' },
      }));
      
      setMatches(prevMatches => [...prevMatches, ...newMatches]);
      setPagination(prev => ({
        currentPage: nextPage,
        totalPages: response.totalPages,
        totalMatches: response.totalElements,
        hasMore: !response.last,
        isLoadingMore: false,
      }));
      
    } catch (err) {
      console.error('Failed to load more matches:', err);
      setPagination(prev => ({ ...prev, isLoadingMore: false }));
    }
  }, [api, filters, pagination]);
  
  // Select conference
  const selectConference = useCallback((conference: Conference | null) => {
    setFilters(prev => ({
      ...prev,
      selectedConference: conference,
      conferenceSearchQuery: '',
      // Clear team when conference changes
      selectedTeam: null,
      teamSearchQuery: '',
    }));
    setShowConferenceDropdown(false);
    setHasSearched(false);
    setMatches([]);
  }, []);
  
  // Select team
  const selectTeam = useCallback((team: MappedTeam | null) => {
    setFilters(prev => ({
      ...prev,
      selectedTeam: team,
      teamSearchQuery: '',
    }));
    setShowTeamDropdown(false);
    setHasSearched(false);
    setMatches([]);
  }, []);
  
  // Toggle section expansion
  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  
  // Handle bulk download with content type selection
  const handleBulkDownload = useCallback(async (
    contentTypes: Set<BulkContentType>,
    customFolder: string | null
  ) => {
    if (selectedMatches.size === 0 || isBatchDownloading) return;
    
    setIsBatchDownloading(true);
    setShowContentTypeSelector(false);
    
    const items: BulkDownloadItem[] = [];
    
    for (const matchId of selectedMatches) {
      const match = matches.find(m => m.id === matchId);
      if (!match || !match.contentAvailability) continue;
      
      items.push({
        match,
        availability: match.contentAvailability,
        selectedTypes: contentTypes,
      });
    }
    
    try {
      const summary = await bulkDownload(
        items,
        api,
        authData,
        {
          customFolder: customFolder || undefined,
          organizeByType: true,
        }
      );
      
      // Update download cache
      const [videos, dvws] = await Promise.all([
        getDownloadedMatches('video'),
        getDownloadedDVWs(),
      ]);
      setDownloadedVideos(videos);
      setDownloadedDVWs(dvws);
      
      const parts: string[] = [];
      if (summary.downloaded > 0) parts.push(`${summary.downloaded} downloaded`);
      if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
      if (summary.failed > 0) parts.push(`${summary.failed} failed`);
      setNotification(`Bulk complete: ${parts.join(', ')}`);
      setTimeout(() => setNotification(null), 5000);
      
      setSelectedMatches(new Set());
      
    } catch (err) {
      setNotification(`Bulk download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setIsBatchDownloading(false);
    }
  }, [selectedMatches, matches, isBatchDownloading, api, authData]);
  
  // ============================================
  // Keyboard Handler
  // ============================================
  
  useInput((input, key) => {
    // Skip if content type selector is shown
    if (showContentTypeSelector) return;
    
    // Tab to switch focus areas
    if (key.tab && hasSearched) {
      setFocusArea(prev => {
        if (prev === 'filters') return 'results';
        if (prev === 'results') return selectedMatches.size > 0 ? 'selection' : 'filters';
        return 'filters';
      });
      return;
    }
    
    // Back
    if (key.escape) {
      if (showConferenceDropdown) {
        setShowConferenceDropdown(false);
        return;
      }
      if (showTeamDropdown) {
        setShowTeamDropdown(false);
        return;
      }
      onBack();
      return;
    }
    
    // ----------------
    // Filter Panel
    // ----------------
    if (focusArea === 'filters') {
      const filterFields: FilterField[] = ['conference', 'team', 'startDate', 'endDate'];
      
      // Navigate fields (when not showing dropdowns)
      if (!showConferenceDropdown && !showTeamDropdown) {
        if (key.upArrow) {
          const idx = filterFields.indexOf(filterField);
          if (idx > 0) setFilterField(filterFields[idx - 1]!);
        }
        if (key.downArrow) {
          const idx = filterFields.indexOf(filterField);
          if (idx < filterFields.length - 1) setFilterField(filterFields[idx + 1]!);
        }
      }
      
      // Conference field
      if (filterField === 'conference') {
        if (showConferenceDropdown) {
          if (key.upArrow) {
            setConferenceResultIdx(prev => Math.max(0, prev - 1));
            return;
          }
          if (key.downArrow) {
            setConferenceResultIdx(prev => Math.min(conferenceResults.length - 1, prev + 1));
            return;
          }
          if (key.return) {
            const selected = conferenceResults[conferenceResultIdx];
            selectConference(selected || null);
            return;
          }
          // Type to filter
          if (/^[a-zA-Z0-9 ]$/.test(input)) {
            setFilters(prev => ({ ...prev, conferenceSearchQuery: prev.conferenceSearchQuery + input }));
            return;
          }
          if (key.backspace || key.delete) {
            setFilters(prev => ({ ...prev, conferenceSearchQuery: prev.conferenceSearchQuery.slice(0, -1) }));
            return;
          }
        } else {
          if (key.return || input === ' ') {
            setShowConferenceDropdown(true);
            setConferenceResults(conferences.slice(0, 10));
            return;
          }
          // Clear with 'c'
          if (input === 'c' && filters.selectedConference) {
            selectConference(null);
            return;
          }
        }
      }
      
      // Team field
      if (filterField === 'team') {
        if (!filters.selectedConference) {
          // Can't select team without conference
          return;
        }
        
        if (showTeamDropdown) {
          if (key.upArrow) {
            setTeamResultIdx(prev => Math.max(-1, prev - 1)); // -1 = "All Teams"
            return;
          }
          if (key.downArrow) {
            setTeamResultIdx(prev => Math.min(teamResults.length - 1, prev + 1));
            return;
          }
          if (key.return) {
            if (teamResultIdx === -1) {
              selectTeam(null); // "All Teams"
            } else {
              const selected = teamResults[teamResultIdx];
              selectTeam(selected || null);
            }
            return;
          }
          // Type to filter
          if (/^[a-zA-Z0-9 ]$/.test(input)) {
            setFilters(prev => ({ ...prev, teamSearchQuery: prev.teamSearchQuery + input }));
            return;
          }
          if (key.backspace || key.delete) {
            setFilters(prev => ({ ...prev, teamSearchQuery: prev.teamSearchQuery.slice(0, -1) }));
            return;
          }
        } else {
          if (key.return || input === ' ') {
            setShowTeamDropdown(true);
            setTeamResults(teamsInConference.slice(0, 10));
            setTeamResultIdx(-1); // Default to "All Teams"
            return;
          }
          // Clear with 'c'
          if (input === 'c' && filters.selectedTeam) {
            selectTeam(null);
            return;
          }
        }
      }
      
      // Date fields
      if (filterField === 'startDate') {
        if (/^[\d-]$/.test(input)) {
          setFilters(prev => ({ ...prev, startDate: prev.startDate + input }));
        }
        if (key.backspace || key.delete) {
          setFilters(prev => ({ ...prev, startDate: prev.startDate.slice(0, -1) }));
        }
      }
      
      if (filterField === 'endDate') {
        if (/^[\d-]$/.test(input)) {
          setFilters(prev => ({ ...prev, endDate: prev.endDate + input }));
        }
        if (key.backspace || key.delete) {
          setFilters(prev => ({ ...prev, endDate: prev.endDate.slice(0, -1) }));
        }
      }
      
      // Execute search with Enter (if valid and not in dropdown)
      if (key.return && canSearch && !showConferenceDropdown && !showTeamDropdown) {
        executeSearch();
      }
    }
    
    // ----------------
    // Results Panel
    // ----------------
    if (focusArea === 'results') {
      // Navigate
      if (key.upArrow || input === 'k') {
        setResultIndex(prev => Math.max(0, prev - 1));
      }
      if (key.downArrow || input === 'j') {
        setResultIndex(prev => Math.min(flatList.length - 1, prev + 1));
      }
      
      // Expand/collapse section
      if (key.return) {
        const item = flatList[resultIndex];
        if (item?.type === 'section') {
          toggleSection(item.key);
        }
      }
      
      // Space bar - toggle selection
      if (input === ' ') {
        const item = flatList[resultIndex];
        if (item?.type === 'match') {
          const match = item.match;
          const isFuture = isMatchInFuture(match.matchDate);
          
          if (!isFuture && !isBatchDownloading) {
            if (match.contentStatus.video === 'unknown') {
              checkContentForMatch(match);
            }
            
            setSelectedMatches(prev => {
              const next = new Set(prev);
              if (next.has(match.id)) {
                next.delete(match.id);
              } else {
                next.add(match.id);
              }
              return next;
            });
          } else if (isFuture) {
            setNotification('Cannot select future matches');
            setTimeout(() => setNotification(null), 2000);
          }
        }
        return;
      }
      
      // Manual content check
      if (input === 'v') {
        const item = flatList[resultIndex];
        if (item?.type === 'match') {
          contentCache.current.delete(item.match.id);
          setMatches(prev => prev.map(m => 
            m.id === item.match.id 
              ? { ...m, contentStatus: { video: 'unknown', dvw: 'unknown', scoresheet: 'coming_soon' } }
              : m
          ));
          checkContentForMatch({ ...item.match, contentStatus: { video: 'unknown', dvw: 'unknown', scoresheet: 'coming_soon' } });
        }
      }
      
      // Clear selection
      if (input === 'c' && selectedMatches.size > 0 && !isBatchDownloading) {
        setSelectedMatches(new Set());
        setNotification('Selection cleared');
        setTimeout(() => setNotification(null), 1500);
      }
    }
    
    // ----------------
    // Selection Panel
    // ----------------
    if (focusArea === 'selection') {
      if (input === 'c' && selectedMatches.size > 0 && !isBatchDownloading) {
        setSelectedMatches(new Set());
        setFocusArea('results');
        setNotification('Selection cleared');
        setTimeout(() => setNotification(null), 1500);
      }
    }
    
    // ----------------
    // Global: Batch Download (D key - uppercase)
    // ----------------
    if (input === 'D' && selectedMatches.size > 0 && !isBatchDownloading) {
      const allChecked = Array.from(selectedMatches).every(id => {
        const match = matches.find(m => m.id === id);
        return match?.contentAvailability !== undefined;
      });
      
      if (!allChecked) {
        setNotification('Checking content availability...');
        Promise.all(
          Array.from(selectedMatches).map(async id => {
            const match = matches.find(m => m.id === id);
            if (match && !match.contentAvailability) {
              await checkContentForMatch(match);
            }
          })
        ).then(() => {
          setNotification(null);
          setShowContentTypeSelector(true);
        });
      } else {
        setShowContentTypeSelector(true);
      }
    }
    
    // Open download folder
    if (input === 'p') {
      openDownloadDir().catch(err => {
        setNotification('Could not open folder: ' + err.message);
        setTimeout(() => setNotification(null), 3000);
      });
    }
  });
  
  // ============================================
  // Render
  // ============================================
  
  const getStatusIndicator = (status: ContentCheckStatus['video'] | ContentCheckStatus['scoresheet']): { char: string | React.ReactNode; color: string } => {
    switch (status) {
      case 'unknown': return { char: '?', color: theme.textDim };
      case 'checking': return { char: <Spinner type="dots" />, color: theme.warning };
      case 'available': return { char: 'Y', color: theme.success };
      case 'unavailable': return { char: 'X', color: theme.error };
      case 'downloaded': return { char: 'D', color: theme.primary };
      case 'coming_soon': return { char: '-', color: theme.textDim };
      default: return { char: '?', color: theme.textDim };
    }
  };
  
  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <Box paddingX={1} marginBottom={1}>
        <Text color={theme.primary} bold>Search All Content</Text>
        {filters.selectedConference && (
          <>
            <Text color={theme.textDim}> - </Text>
            <Text color={theme.info}>{filters.selectedConference.name}</Text>
          </>
        )}
        {filters.selectedTeam && (
          <>
            <Text color={theme.textDim}> / </Text>
            <Text color={theme.accent}>{filters.selectedTeam.name}</Text>
          </>
        )}
        {!filters.selectedTeam && filters.selectedConference && (
          <>
            <Text color={theme.textDim}> / </Text>
            <Text color={theme.success}>All Teams</Text>
          </>
        )}
        {hasSearched && (
          <>
            <Text color={theme.textDim}> - </Text>
            <Text color={theme.text}>{pagination.totalMatches} matches</Text>
          </>
        )}
        {loading && (
          <Text color={theme.warning}> <Spinner type="dots" /></Text>
        )}
      </Box>
      
      {/* Main content */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Top: Filters and Results horizontal */}
        <Box flexDirection="row" flexGrow={1}>
          {/* Left: Filters */}
          <Box
            flexDirection="column"
            width={40}
            borderStyle={borderStyle}
            borderColor={focusArea === 'filters' ? theme.primary : theme.border}
            paddingX={1}
            paddingY={1}
            marginRight={1}
          >
          <Text color={theme.accent} bold>Search Filters</Text>
          
          {/* Conference Filter - Autocomplete */}
          <Box marginTop={1} flexDirection="column">
            <Text color={filterField === 'conference' && focusArea === 'filters' ? theme.primary : theme.text}>
              Conference: <Text color={theme.textDim}>(required)</Text>
            </Text>
            
            {filters.selectedConference ? (
              <Box>
                <Text color={theme.success}>OK </Text>
                <Text color={theme.info}>{filters.selectedConference.name}</Text>
                {focusArea === 'filters' && filterField === 'conference' && (
                  <Text color={theme.textDim}> ('c' clear)</Text>
                )}
              </Box>
            ) : (
              <Box flexDirection="column">
                {showConferenceDropdown ? (
                  <>
                    <Box>
                      <Text color={theme.accent}>{filters.conferenceSearchQuery}</Text>
                      <Text color={theme.primary}>_</Text>
                    </Box>
                    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                      {conferenceResults.slice(0, 8).map((conf, idx) => (
                        <Box key={conf.id}>
                          <Text
                            backgroundColor={idx === conferenceResultIdx ? theme.backgroundElement : undefined}
                            color={idx === conferenceResultIdx ? theme.primary : theme.text}
                          >
                            {idx === conferenceResultIdx ? '> ' : '  '}{conf.name}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  </>
                ) : (
                  <Text color={theme.textMuted}>
                    {focusArea === 'filters' && filterField === 'conference' 
                      ? 'Press Enter to select...' 
                      : 'Not selected'}
                  </Text>
                )}
              </Box>
            )}
          </Box>
          
          {/* Team Filter - Autocomplete */}
          <Box marginTop={1} flexDirection="column">
            <Text color={filterField === 'team' && focusArea === 'filters' ? theme.primary : theme.text}>
              Team: <Text color={theme.textDim}>(optional - defaults to all)</Text>
            </Text>
            
            {!filters.selectedConference ? (
              <Text color={theme.textDim}>Select conference first</Text>
            ) : filters.selectedTeam ? (
              <Box>
                <Text color={theme.success}>OK </Text>
                <Text color={theme.accent}>{filters.selectedTeam.abbreviation}</Text>
                <Text color={theme.textMuted}> - {filters.selectedTeam.name}</Text>
                {focusArea === 'filters' && filterField === 'team' && (
                  <Text color={theme.textDim}> ('c' clear)</Text>
                )}
              </Box>
            ) : (
              <Box flexDirection="column">
                {showTeamDropdown ? (
                  <>
                    <Box>
                      <Text color={theme.accent}>{filters.teamSearchQuery}</Text>
                      <Text color={theme.primary}>_</Text>
                    </Box>
                    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                      {/* "All Teams" option */}
                      <Box>
                        <Text
                          backgroundColor={teamResultIdx === -1 ? theme.backgroundElement : undefined}
                          color={teamResultIdx === -1 ? theme.success : theme.text}
                          bold={teamResultIdx === -1}
                        >
                          {teamResultIdx === -1 ? '> ' : '  '}All Teams ({teamsInConference.length})
                        </Text>
                      </Box>
                      {teamResults.slice(0, 7).map((team, idx) => (
                        <Box key={team.id}>
                          <Text
                            backgroundColor={idx === teamResultIdx ? theme.backgroundElement : undefined}
                            color={idx === teamResultIdx ? theme.primary : theme.text}
                          >
                            {idx === teamResultIdx ? '> ' : '  '}{team.abbreviation} - {team.name}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  </>
                ) : (
                  <Box>
                    <Text color={theme.success}>All Teams</Text>
                    <Text color={theme.textDim}> ({teamsInConference.length} teams)</Text>
                    {focusArea === 'filters' && filterField === 'team' && (
                      <Text color={theme.textDim}> (Enter to change)</Text>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Box>
          
          {/* Date Range */}
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.text}>Date Range:</Text>
            
            <Box marginTop={1}>
              <Text color={filterField === 'startDate' && focusArea === 'filters' ? theme.primary : theme.textMuted}>
                From:{' '}
              </Text>
              <Text color={isValidDate(filters.startDate) ? theme.accent : theme.error}>
                {filters.startDate || 'YYYY-MM-DD'}
              </Text>
              {focusArea === 'filters' && filterField === 'startDate' && (
                <Text color={theme.primary}>_</Text>
              )}
            </Box>
            
            <Box>
              <Text color={filterField === 'endDate' && focusArea === 'filters' ? theme.primary : theme.textMuted}>
                To:{' '}
              </Text>
              <Text color={isValidDate(filters.endDate) ? theme.accent : theme.error}>
                {filters.endDate || 'YYYY-MM-DD'}
              </Text>
              {focusArea === 'filters' && filterField === 'endDate' && (
                <Text color={theme.primary}>_</Text>
              )}
            </Box>
          </Box>
          
          {/* Search button hint */}
          <Box marginTop={2} flexDirection="column">
            {canSearch ? (
              <Text color={theme.success}>Press Enter to search</Text>
            ) : (
              <Text color={theme.textDim}>
                {!filters.selectedConference ? 'Select a conference first' : 'Enter valid dates'}
              </Text>
            )}
          </Box>
          
          {/* Error */}
          {error && (
            <Box marginTop={1}>
              <Text color={theme.error}>{error}</Text>
            </Box>
          )}
        </Box>
        
        {/* Right: Results */}
        <Box 
          flexDirection="column" 
          flexGrow={1}
          borderStyle={borderStyle}
          borderColor={focusArea === 'results' ? theme.primary : theme.border}
          paddingX={1}
        >
          <Text color={theme.accent} bold>Results</Text>
          
          {/* Legend */}
          {hasSearched && (
            <Box marginTop={1}>
              <Text color={theme.textDim}>
                [<Text color={theme.success}>V</Text>ideo] [<Text color={theme.success}>D</Text>VW] [<Text color={theme.textDim}>S</Text>coresheet]
              </Text>
            </Box>
          )}
          
          {/* Empty state */}
          {!hasSearched && (
            <Box flexDirection="column" marginTop={2} alignItems="center">
              <Text color={theme.textMuted}>Select a conference to search</Text>
              <Text color={theme.textMuted}>for all matches in that conference</Text>
            </Box>
          )}
          
          {/* Loading state */}
          {loading && (
            <Box marginTop={2} alignItems="center">
              <Text color={theme.warning}><Spinner type="dots" /></Text>
              <Text color={theme.text}> Searching...</Text>
            </Box>
          )}
          
          {/* Results list */}
          {hasSearched && !loading && (
            <Box flexDirection="column" marginTop={1}>
              {flatList.length === 0 ? (
                <Text color={theme.textMuted}>No matches found</Text>
              ) : (
                <>
                  {flatList.map((item, index) => {
                    const useWindowing = flatList.length >= 40;
                    if (useWindowing && (index < resultIndex - 30 || index > resultIndex + 50)) {
                      return null;
                    }
                    
                    const isFocused = focusArea === 'results' && index === resultIndex;
                    
                    if (item.type === 'section') {
                      const isExpanded = expandedSections.has(item.key);
                      const count = groupedMatches.get(item.key)?.length || 0;
                      
                      return (
                        <Box key={`section-${item.key}`}>
                          <Text backgroundColor={isFocused ? theme.backgroundElement : undefined}>
                            <Text color={theme.accent}>{isExpanded ? 'v' : '>'}</Text>
                            <Text color={isFocused ? theme.primary : theme.text} bold> {item.key}</Text>
                            <Text color={theme.textMuted}> ({count})</Text>
                          </Text>
                        </Box>
                      );
                    }
                    
                    const match = item.match;
                    const isFutureMatch = isMatchInFuture(match.matchDate);
                    
                    const videoStatus = getStatusIndicator(isFutureMatch ? 'unknown' : match.contentStatus.video);
                    const dvwStatus = getStatusIndicator(isFutureMatch ? 'unknown' : match.contentStatus.dvw);
                    const scoresheetStatus = getStatusIndicator('coming_soon');
                    
                    const dateStr = formatMatchDate(match.matchDate, 'short');
                    const homeConf = getTeamConferenceName(match.homeTeam.name, match.homeTeam.abbreviation, formatConferenceDisplay(match.homeTeam.conference));
                    const awayConf = getTeamConferenceName(match.awayTeam.name, match.awayTeam.abbreviation, formatConferenceDisplay(match.awayTeam.conference));
                    const confDisplay = homeConf === awayConf ? `[${homeConf}]` : `[${awayConf}|${homeConf}]`;
                    
                    const isSelected = selectedMatches.has(match.id);
                    const canSelect = !isFutureMatch;
                    const checkboxChar = isSelected ? 'x' : ' ';
                    const checkboxColor = !canSelect ? theme.textDim : isSelected ? theme.success : theme.textMuted;
                    
                    return (
                      <Box key={`match-${match.id}`} paddingLeft={2}>
                        <Text backgroundColor={isFocused ? theme.backgroundElement : undefined}>
                          <Text color={checkboxColor}>[{checkboxChar}]</Text>
                          <Text color={videoStatus.color}>[{videoStatus.char}]</Text>
                          <Text color={dvwStatus.color}>[{dvwStatus.char}]</Text>
                          <Text color={scoresheetStatus.color}>[{scoresheetStatus.char}]</Text>
                          <Text color={isFocused ? theme.primary : theme.text}> {dateStr}</Text>
                          <Text color={theme.textMuted}> - </Text>
                          <Text color={theme.accent}>{match.awayTeam.abbreviation}</Text>
                          <Text color={theme.textMuted}> @ </Text>
                          <Text color={theme.accent}>{match.homeTeam.abbreviation}</Text>
                          <Text color={theme.info}> {confDisplay}</Text>
                          {isFutureMatch && <Text color={theme.textDim}> (future)</Text>}
                        </Text>
                      </Box>
                    );
                  })}
                  
                  {pagination.isLoadingMore && (
                    <Box paddingLeft={2}>
                      <Text color={theme.warning}><Spinner type="dots" /></Text>
                      <Text color={theme.textMuted}> Loading more...</Text>
                    </Box>
                  )}
                  
                  {flatList.length > 20 && (
                    <Box marginTop={1}>
                      <Text color={theme.textDim}>
                        Showing {resultIndex + 1} of {flatList.length} items
                        {pagination.hasMore && ` (${pagination.totalMatches} total)`}
                      </Text>
                    </Box>
                  )}
                </>
              )}
            </Box>
          )}
        </Box>
        </Box>

        {/* Bottom: Selection Panel */}
        {hasSearched && (
          <Box
            flexDirection="column"
            width="100%"
            borderStyle={borderStyle}
            borderColor={focusArea === 'selection' ? theme.primary : theme.border}
            paddingX={1}
            paddingY={1}
            marginTop={1}
          >
            <Text color={theme.accent} bold>Selection</Text>
            
            {selectedMatches.size === 0 ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.textMuted}>No items selected</Text>
                <Text color={theme.textDim}>Press Space to select</Text>
              </Box>
            ) : (
              <>
                <Box marginTop={1}>
                  <Text color={theme.primary} bold>{selectedMatches.size}</Text>
                  <Text color={theme.text}> match{selectedMatches.size !== 1 ? 'es' : ''}</Text>
                </Box>
                
                <Box flexDirection="column" marginTop={1}>
                  {(() => {
                    const selectedList = matches.filter(m => selectedMatches.has(m.id));
                    const videoCount = selectedList.filter(m => 
                      m.contentStatus.video === 'available' || m.contentStatus.video === 'downloaded'
                    ).length;
                    const dvwCount = selectedList.filter(m => 
                      m.contentStatus.dvw === 'available' || m.contentStatus.dvw === 'downloaded'
                    ).length;
                    
                    return (
                      <>
                        <Text color={theme.textMuted}>
                          Videos: <Text color={videoCount > 0 ? theme.success : theme.textDim}>{videoCount}</Text>
                        </Text>
                        <Text color={theme.textMuted}>
                          DVW: <Text color={dvwCount > 0 ? theme.success : theme.textDim}>{dvwCount}</Text>
                        </Text>
                      </>
                    );
                  })()}
                </Box>
                
                <Box marginTop={1} flexDirection="column">
                  {!isBatchDownloading ? (
                    <>
                      <Text color={theme.success}>D = download</Text>
                      <Text color={theme.textDim}>c = clear</Text>
                    </>
                  ) : (
                    <Box>
                      <Text color={theme.warning}><Spinner type="dots" /> </Text>
                      <Text color={theme.warning}>Downloading...</Text>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </Box>
        )}
      </Box>
      
      {/* Notification */}
      {notification && (
        <Box borderStyle={borderStyle} borderColor={theme.success} paddingX={2} marginTop={1}>
          <Text color={theme.success}>{notification}</Text>
        </Box>
      )}
      
      {/* Footer */}
      <Box 
        borderStyle={borderStyle}
        borderColor={theme.borderSubtle}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        paddingTop={1}
        marginTop={1}
      >
        <Text color={theme.textDim}>
          {hasSearched && <><Text color={theme.textMuted}>Tab</Text> switch  </>}
          <Text color={theme.textMuted}>j/k</Text> nav  
          <Text color={theme.textMuted}> Enter</Text> {focusArea === 'filters' ? 'search/select' : 'expand'}  
          {focusArea === 'results' && (
            <>
              <Text color={theme.primary}> Space</Text> select  
              <Text color={theme.textMuted}>v</Text> check  
            </>
          )}
          {selectedMatches.size > 0 && (
            <>
              <Text color={theme.success}> D</Text> dl({selectedMatches.size})  
              <Text color={theme.textMuted}>c</Text> clear  
            </>
          )}
          <Text color={theme.textMuted}> p</Text> folder  
          <Text color={theme.textMuted}> Esc</Text> back
        </Text>
      </Box>
      
      {/* Download location display */}
      <Box
        borderStyle={borderStyle}
        borderColor={theme.borderSubtle}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        marginTop={0}
      >
        <Text color={theme.textDim}>
          <Text color={theme.textMuted}>Downloads: </Text>
          <Text color={theme.accent}>{getDisplayPath()}</Text>
        </Text>
      </Box>
      
      {/* Content Type Selector Modal */}
      {showContentTypeSelector && (
        <Box position="absolute" marginTop={5} marginLeft={10}>
          <ContentTypeSelector
            selectedMatches={Array.from(selectedMatches).map(id => {
              const match = matches.find(m => m.id === id);
              return {
                matchId: id,
                availability: match?.contentAvailability || {
                  matchId: id,
                  video: { available: false, url: '', filename: '', matchId: id, checked: true },
                  dvw: { available: false, matchId: id, filename: '', checked: true },
                  scoresheet: { available: false, matchId: id, filename: '', checked: true },
                  checkedAt: Date.now(),
                },
              };
            })}
            onConfirm={handleBulkDownload}
            onCancel={() => setShowContentTypeSelector(false)}
            teamAbbrev={filters.selectedTeam?.abbreviation || filters.selectedConference?.name}
          />
        </Box>
      )}
    </Box>
  );
}
