/**
 * OtherMatchesPage - Team-focused match search
 * 
 * Features:
 * - Team autocomplete search (required)
 * - Date range input (required)
 * - Lazy loading pagination for large result sets
 * - Video checking and downloading
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
  searchTeams,
  formatTeamDisplay,
  setCachedTeams,
  getCachedTeams,
  type HudlAuthData,
  type MatchEvent,
  type VideoInfo,
  type DownloadProgress,
  type DownloadRecord,
  type LeagueTeam,
  type TeamSearchResult,
} from '../lib/index.js';

// ============================================
// Types
// ============================================

interface OtherMatchesPageProps {
  authData: HudlAuthData;
  onBack: () => void;
}

interface FilterState {
  // Team search
  teamSearchQuery: string;
  selectedTeam: LeagueTeam | null;
  
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

type VideoStatus = 'unknown' | 'checking' | 'available' | 'unavailable';
type DownloadStatus = 'none' | 'downloading' | 'completed' | 'error' | 'previously_downloaded';

interface MatchWithVideo extends MatchEvent {
  videoStatus: VideoStatus;
  videoInfo?: VideoInfo;
  downloadStatus: DownloadStatus;
  downloadProgress?: DownloadProgress;
  downloadRecord?: DownloadRecord;
}

type FocusArea = 'filters' | 'results';
type FilterField = 'teamSearch' | 'startDate' | 'endDate';

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

/** Check if match involves the specified team */
function matchInvolvesTeam(match: MatchEvent, teamId: number): boolean {
  return match.homeTeam.id === teamId || match.awayTeam.id === teamId;
}

// ============================================
// Component
// ============================================

export function OtherMatchesPage({ authData, onBack }: OtherMatchesPageProps) {
  // Filter state
  const defaultDates = useMemo(() => getDefaultDateRange(), []);
  const [filters, setFilters] = useState<FilterState>({
    teamSearchQuery: '',
    selectedTeam: null,
    startDate: defaultDates.start,
    endDate: defaultDates.end,
  });
  
  // Team list
  const [allTeams, setAllTeams] = useState<LeagueTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  
  // Team search results (autocomplete)
  const [searchResults, setSearchResults] = useState<TeamSearchResult[]>([]);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  
  // Match state
  const [matches, setMatches] = useState<MatchWithVideo[]>([]);
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
  const [filterField, setFilterField] = useState<FilterField>('teamSearch');
  const [resultIndex, setResultIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  
  // Video/download state
  const [videoCache] = useState<Map<number, VideoInfo>>(new Map());
  const [downloadedCache, setDownloadedCache] = useState<Map<number, DownloadRecord>>(new Map());
  const [notification, setNotification] = useState<string | null>(null);
  
  // API client
  const api = useMemo(() => new HudlAPI(authData), [authData]);
  
  // Grouped matches for display
  const groupedMatches = useMemo(() => groupMatchesByMonth(matches), [matches]);
  const monthKeys = useMemo(() => getSortedMonthKeys(groupedMatches), [groupedMatches]);
  
  // Build flat list for navigation
  const flatList = useMemo(() => {
    const items: Array<{ type: 'section'; key: string } | { type: 'match'; match: MatchWithVideo }> = [];
    
    for (const monthKey of monthKeys) {
      items.push({ type: 'section', key: monthKey });
      
      if (expandedSections.has(monthKey)) {
        const monthMatches = groupedMatches.get(monthKey) || [];
        for (const match of monthMatches) {
          items.push({ type: 'match', match: match as MatchWithVideo });
        }
      }
    }
    
    return items;
  }, [monthKeys, expandedSections, groupedMatches]);
  
  // Check if search can be executed
  const canSearch = filters.selectedTeam !== null && 
    isValidDate(filters.startDate) && 
    isValidDate(filters.endDate);
  
  // ============================================
  // Effects
  // ============================================
  
  // Load team list on mount
  useEffect(() => {
    async function loadTeams() {
      // Check cache first
      const cached = getCachedTeams();
      if (cached) {
        setAllTeams(cached);
        setTeamsLoading(false);
        return;
      }
      
      try {
        setTeamsLoading(true);
        const teams = await api.getTeamsByLeague();
        setAllTeams(teams);
        setCachedTeams(teams);
      } catch (err) {
        setTeamsError(err instanceof Error ? err.message : 'Failed to load teams');
      } finally {
        setTeamsLoading(false);
      }
    }
    loadTeams();
  }, [api]);
  
  // Update search results when query changes
  useEffect(() => {
    if (filters.teamSearchQuery.length >= 2 && allTeams.length > 0) {
      const results = searchTeams(allTeams, filters.teamSearchQuery, 5);
      setSearchResults(results);
      setSelectedResultIndex(0);
    } else {
      setSearchResults([]);
    }
  }, [filters.teamSearchQuery, allTeams]);
  
  // Load downloaded matches on mount
  useEffect(() => {
    async function loadDownloadedStatus() {
      try {
        const downloaded = await getDownloadedMatches();
        setDownloadedCache(downloaded);
      } catch (err) {
        console.error('Failed to load download status:', err);
      }
    }
    loadDownloadedStatus();
  }, []);
  
  // Update matches with download status
  useEffect(() => {
    if (matches.length > 0 && downloadedCache.size > 0) {
      setMatches(prev => prev.map(m => {
        const record = downloadedCache.get(m.id);
        if (record && m.downloadStatus === 'none') {
          return { ...m, downloadStatus: 'previously_downloaded' as DownloadStatus, downloadRecord: record };
        }
        return m;
      }));
    }
  }, [matches.length, downloadedCache]);
  
  // Auto-expand first section when results change
  useEffect(() => {
    if (monthKeys.length > 0 && expandedSections.size === 0) {
      setExpandedSections(new Set([monthKeys[0]!]));
    }
  }, [monthKeys]);
  
  // Lazy load more when scrolling near bottom
  useEffect(() => {
    if (focusArea !== 'results') return;
    if (!pagination.hasMore || pagination.isLoadingMore) return;
    
    // Check if we're near the bottom (within 10 items)
    if (resultIndex >= flatList.length - 10) {
      loadMoreMatches();
    }
  }, [resultIndex, flatList.length, pagination.hasMore, pagination.isLoadingMore]);
  
  // ============================================
  // Actions
  // ============================================
  
  // Execute search
  const executeSearch = useCallback(async () => {
    if (!canSearch || !filters.selectedTeam) return;
    
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setMatches([]);
    setExpandedSections(new Set());
    setResultIndex(0);
    
    const teamId = filters.selectedTeam.id;
    
    try {
      // Fetch larger batch since we're filtering client-side
      const response = await api.getOtherMatches({
        startDate: `${filters.startDate}T00:00:00.000`,
        endDate: `${filters.endDate}T23:59:00.000`,
        matchType: 'match',
        page: 1,
        size: 200, // Larger batch for client-side filtering
      });
      
      // Filter to only matches involving the selected team
      const filteredContent = response.content.filter(match => 
        matchInvolvesTeam(match, teamId)
      );
      
      // Convert to MatchWithVideo
      const matchesWithVideo: MatchWithVideo[] = filteredContent.map(match => ({
        ...match,
        videoStatus: 'unknown' as VideoStatus,
        downloadStatus: 'none' as DownloadStatus,
      }));
      
      setMatches(matchesWithVideo);
      setPagination({
        currentPage: 1,
        totalPages: response.totalPages,
        totalMatches: filteredContent.length, // Use filtered count
        hasMore: !response.last,
        isLoadingMore: false,
      });
      
      // Check for large date range and show warning if needed
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      const monthDiff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      if (monthDiff > 6) {
        setError('Date range is large - results may be slow. Try narrowing to 6 months or less.');
      }
      
      // Switch to results view
      setFocusArea('results');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search matches');
    } finally {
      setLoading(false);
    }
  }, [api, filters, canSearch]);
  
  // Load more matches (pagination)
  const loadMoreMatches = useCallback(async () => {
    const selectedTeam = filters.selectedTeam;
    if (!selectedTeam || pagination.isLoadingMore || !pagination.hasMore) return;
    
    setPagination(prev => ({ ...prev, isLoadingMore: true }));
    
    try {
      const nextPage = pagination.currentPage + 1;
      const response = await api.getOtherMatches({
        startDate: `${filters.startDate}T00:00:00.000`,
        endDate: `${filters.endDate}T23:59:00.000`,
        teamId: selectedTeam.id,
        matchType: 'match',
        page: nextPage,
        size: 50,
      });
      
      // Append new matches
      const newMatches: MatchWithVideo[] = response.content.map(match => ({
        ...match,
        videoStatus: 'unknown' as VideoStatus,
        downloadStatus: 'none' as DownloadStatus,
      }));
      
      // Filter to only matches involving selected team
      const filteredNewMatches = newMatches.filter(match => 
        matchInvolvesTeam(match, selectedTeam.id)
      );
      
      setMatches(matches => [...matches, ...filteredNewMatches]);
      setPagination({
        currentPage: nextPage,
        totalPages: response.totalPages,
        totalMatches: matches.length + filteredNewMatches.length,
        hasMore: !response.last,
        isLoadingMore: false,
      });
      
    } catch (err) {
      console.error('Failed to load more matches:', err);
      setPagination(prev => ({ ...prev, isLoadingMore: false }));
    }
  }, [api, filters, pagination]);
  
  // Select team from autocomplete
  const selectTeam = useCallback((team: LeagueTeam) => {
    setFilters(prev => ({
      ...prev,
      selectedTeam: team,
      teamSearchQuery: '',
    }));
    setSearchResults([]);
  }, []);
  
  // Clear selected team
  const clearTeam = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      selectedTeam: null,
      teamSearchQuery: '',
    }));
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
  
  // Check video for a match
  const checkVideoForMatch = useCallback(async (match: MatchWithVideo) => {
    if (videoCache.has(match.id)) {
      const cached = videoCache.get(match.id)!;
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, videoStatus: cached.available ? 'available' : 'unavailable', videoInfo: cached }
          : m
      ));
      return;
    }
    
    setMatches(prev => prev.map(m => 
      m.id === match.id ? { ...m, videoStatus: 'checking' as VideoStatus } : m
    ));
    
    try {
      const videoInfo = await api.findVideoUrl(match);
      videoCache.set(match.id, videoInfo);
      
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, videoStatus: videoInfo.available ? 'available' : 'unavailable', videoInfo }
          : m
      ));
    } catch {
      setMatches(prev => prev.map(m => 
        m.id === match.id ? { ...m, videoStatus: 'unavailable' as VideoStatus } : m
      ));
    }
  }, [api, videoCache]);
  
  // Download video
  const downloadMatchVideo = useCallback(async (match: MatchWithVideo) => {
    if (isMatchInFuture(match.matchDate)) {
      setNotification('Cannot download - match is in the future');
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    if (match.videoStatus !== 'available' || !match.videoInfo) return;
    if (match.downloadStatus === 'downloading' || downloadManager.isDownloading(match.id)) return;
    
    setMatches(prev => prev.map(m => 
      m.id === match.id ? { ...m, downloadStatus: 'downloading' as DownloadStatus } : m
    ));
    
    const result = await downloadManager.startDownload(match, match.videoInfo);
    
    if (result.success && result.filepath) {
      const filename = generateVideoFilename(match);
      const newRecord: DownloadRecord = {
        matchId: match.id,
        filepath: result.filepath,
        filename,
        downloadedAt: new Date().toISOString(),
      };
      setDownloadedCache(prev => new Map(prev).set(match.id, newRecord));
      
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, downloadStatus: 'completed' as DownloadStatus, downloadRecord: newRecord }
          : m
      ));
    } else {
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, downloadStatus: 'error' as DownloadStatus }
          : m
      ));
    }
  }, []);
  
  // ============================================
  // Keyboard Handler
  // ============================================
  
  useInput((input, key) => {
    // Tab to switch focus areas (only if we have results)
    if (key.tab && hasSearched) {
      setFocusArea(prev => prev === 'filters' ? 'results' : 'filters');
      return;
    }
    
    // Back
    if (key.escape) {
      onBack();
      return;
    }
    
    // ----------------
    // Filter Panel
    // ----------------
    if (focusArea === 'filters') {
      const filterFields: FilterField[] = ['teamSearch', 'startDate', 'endDate'];
      
      // Navigate fields (only when not showing autocomplete)
      if (searchResults.length === 0) {
        if (key.upArrow) {
          const idx = filterFields.indexOf(filterField);
          if (idx > 0) setFilterField(filterFields[idx - 1]!);
        }
        if (key.downArrow) {
          const idx = filterFields.indexOf(filterField);
          if (idx < filterFields.length - 1) setFilterField(filterFields[idx + 1]!);
        }
      }
      
      // Team search field
      if (filterField === 'teamSearch') {
        // Navigate autocomplete
        if (searchResults.length > 0) {
          if (key.upArrow) {
            setSelectedResultIndex(prev => Math.max(0, prev - 1));
            return;
          }
          if (key.downArrow) {
            setSelectedResultIndex(prev => Math.min(searchResults.length - 1, prev + 1));
            return;
          }
          // Select team
          if (key.return) {
            const result = searchResults[selectedResultIndex];
            if (result) selectTeam(result.team);
            return;
          }
        }
        
        // Type in search
        if (/^[a-zA-Z0-9 ]$/.test(input)) {
          setFilters(prev => ({ ...prev, teamSearchQuery: prev.teamSearchQuery + input }));
        }
        if (key.backspace || key.delete) {
          if (filters.teamSearchQuery.length > 0) {
            setFilters(prev => ({ ...prev, teamSearchQuery: prev.teamSearchQuery.slice(0, -1) }));
          } else if (filters.selectedTeam) {
            clearTeam();
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
      
      // Clear team with 'c'
      if (input === 'c' && filters.selectedTeam) {
        clearTeam();
      }
      
      // Execute search with Enter (if valid)
      if (key.return && canSearch && searchResults.length === 0) {
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
      
      // Check video
      if (input === 'v') {
        const item = flatList[resultIndex];
        if (item?.type === 'match') {
          videoCache.delete(item.match.id);
          checkVideoForMatch({ ...item.match, videoStatus: 'unknown' });
        }
      }
      
      // Download
      if (input === 'd') {
        const item = flatList[resultIndex];
        if (item?.type === 'match') {
          downloadMatchVideo(item.match);
        }
      }
    }
  });
  
  // ============================================
  // Render
  // ============================================
  
  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <Box paddingX={1} marginBottom={1}>
        <Text color={theme.primary} bold>Other Matches</Text>
        {filters.selectedTeam && (
          <>
            <Text color={theme.textDim}> - </Text>
            <Text color={theme.accent}>{filters.selectedTeam.name}</Text>
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
      <Box flexDirection="row" flexGrow={1}>
        {/* Left: Filters */}
        <Box 
          flexDirection="column" 
          width={35}
          borderStyle={borderStyle}
          borderColor={focusArea === 'filters' ? theme.primary : theme.border}
          paddingX={1}
          paddingY={1}
          marginRight={1}
        >
          <Text color={theme.accent} bold>Search</Text>
          
          {/* Teams loading indicator */}
          {teamsLoading && (
            <Box marginTop={1}>
              <Text color={theme.warning}><Spinner type="dots" /></Text>
              <Text color={theme.textMuted}> Loading teams...</Text>
            </Box>
          )}
          
          {teamsError && (
            <Box marginTop={1}>
              <Text color={theme.error}>{teamsError}</Text>
            </Box>
          )}
          
          {/* Team Search */}
          {!teamsLoading && !teamsError && (
            <Box marginTop={1} flexDirection="column">
              <Text color={filterField === 'teamSearch' && focusArea === 'filters' ? theme.primary : theme.text}>
                Team: <Text color={theme.textDim}>(required)</Text>
              </Text>
              
              {/* Selected team display */}
              {filters.selectedTeam ? (
                <Box>
                  <Text color={theme.success}>✓ </Text>
                  <Text color={theme.accent}>{filters.selectedTeam.abbreviation}</Text>
                  <Text color={theme.textMuted}> - {filters.selectedTeam.name}</Text>
                  {focusArea === 'filters' && (
                    <Text color={theme.textDim}> ('c' to clear)</Text>
                  )}
                </Box>
              ) : (
                <Box flexDirection="column">
                  {/* Search input */}
                  <Box>
                    <Text color={theme.accent}>
                      {filters.teamSearchQuery}
                    </Text>
                    {focusArea === 'filters' && filterField === 'teamSearch' && (
                      <Text color={theme.primary}>_</Text>
                    )}
                  </Box>
                  
                  {/* Autocomplete results */}
                  {searchResults.length > 0 && focusArea === 'filters' && (
                    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                      {searchResults.map((result, idx) => (
                        <Box key={result.team.id}>
                          <Text 
                            backgroundColor={idx === selectedResultIndex ? theme.backgroundElement : undefined}
                            color={idx === selectedResultIndex ? theme.primary : theme.text}
                          >
                            {idx === selectedResultIndex ? '> ' : '  '}
                            {formatTeamDisplay(result.team)}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  )}
                  
                  {/* Hint */}
                  {filters.teamSearchQuery.length === 0 && focusArea === 'filters' && filterField === 'teamSearch' && (
                    <Text color={theme.textDim}>Type to search...</Text>
                  )}
                  {filters.teamSearchQuery.length === 1 && (
                    <Text color={theme.textDim}>Type 2+ characters</Text>
                  )}
                </Box>
              )}
            </Box>
          )}
          
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
                {!filters.selectedTeam ? 'Select a team first' : 'Enter valid dates'}
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
          
          {/* Found match count message */}
          {hasSearched && filters.selectedTeam && (
            <Text color={theme.textDim}> Found {pagination.totalMatches} matches for <Text color={theme.accent}>{filters.selectedTeam.name}</Text></Text>
          )}
          
          {/* Empty state - no search yet */}
          {!hasSearched && (
            <Box flexDirection="column" marginTop={2} alignItems="center">
              <Text color={theme.textMuted}>Select a team and date range</Text>
              <Text color={theme.textMuted}>to search for matches</Text>
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
                    // Windowed rendering - only show items near the current index
                    if (index < resultIndex - 10 || index > resultIndex + 15) {
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
                    
                    // Status indicator
                    let statusIndicator: React.ReactNode;
                    let statusColor: string;
                    let statusText: string | null = null;
                    
                    if (match.downloadStatus === 'downloading') {
                      statusIndicator = <Spinner type="dots" />;
                      statusColor = theme.warning;
                      if (match.downloadProgress) {
                        const { percent, bytesDownloaded, totalBytes } = match.downloadProgress;
                        statusText = totalBytes > 0 
                          ? ` ${percent}% (${formatBytes(bytesDownloaded)}/${formatBytes(totalBytes)})`
                          : ` ${formatBytes(bytesDownloaded)}`;
                      }
                    } else if (match.downloadStatus === 'completed') {
                      statusIndicator = 'D';
                      statusColor = theme.success;
                      statusText = ' Downloaded';
                    } else if (match.downloadStatus === 'previously_downloaded') {
                      statusIndicator = 'D';
                      statusColor = theme.primary;
                      if (isFocused && match.downloadRecord) {
                        statusText = ` ${match.downloadRecord.filename}`;
                      }
                    } else if (match.downloadStatus === 'error') {
                      statusIndicator = '!';
                      statusColor = theme.error;
                    } else if (isFutureMatch) {
                      statusIndicator = 'F';
                      statusColor = theme.textDim;
                    } else if (match.videoStatus === 'available') {
                      statusIndicator = 'V';
                      statusColor = theme.success;
                      if (isFocused) statusText = ' [d]';
                    } else if (match.videoStatus === 'checking') {
                      statusIndicator = <Spinner type="dots" />;
                      statusColor = theme.warning;
                    } else if (match.videoStatus === 'unavailable') {
                      statusIndicator = 'X';
                      statusColor = theme.error;
                    } else {
                      statusIndicator = '?';
                      statusColor = theme.textDim;
                    }
                    
                    const dateStr = formatMatchDate(match.matchDate, 'short');
                    const homeConf = formatConferenceDisplay(match.homeTeam.conference);
                    const awayConf = formatConferenceDisplay(match.awayTeam.conference);
                    const confDisplay = homeConf === awayConf ? `[${homeConf}]` : `[${awayConf}|${homeConf}]`;
                    
                    return (
                      <Box key={`match-${match.id}`} paddingLeft={2}>
                        <Text backgroundColor={isFocused ? theme.backgroundElement : undefined}>
                          <Text color={statusColor}>[{statusIndicator}]</Text>
                          <Text color={isFocused ? theme.primary : theme.text}> {dateStr}</Text>
                          <Text color={theme.textMuted}> - </Text>
                          <Text color={theme.accent}>{match.awayTeam.abbreviation}</Text>
                          <Text color={theme.textMuted}> @ </Text>
                          <Text color={theme.accent}>{match.homeTeam.abbreviation}</Text>
                          <Text color={theme.info}> {confDisplay}</Text>
                          {statusText && <Text color={theme.textMuted}>{statusText}</Text>}
                        </Text>
                      </Box>
                    );
                  })}
                  
                  {/* Loading more indicator */}
                  {pagination.isLoadingMore && (
                    <Box paddingLeft={2}>
                      <Text color={theme.warning}><Spinner type="dots" /></Text>
                      <Text color={theme.textMuted}> Loading more...</Text>
                    </Box>
                  )}
                  
                  {/* Show position if there are many matches */}
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
          <Text color={theme.textMuted}>j/k</Text> navigate  
          <Text color={theme.textMuted}> Enter</Text> {focusArea === 'filters' ? 'search/select' : 'expand'}  
          {focusArea === 'results' && (
            <>
              <Text color={theme.success}> d</Text> download  
              <Text color={theme.textMuted}> v</Text> check  
            </>
          )}
          <Text color={theme.textMuted}> Esc</Text> back
        </Text>
      </Box>
    </Box>
  );
}
