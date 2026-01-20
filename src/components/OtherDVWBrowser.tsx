/**
 * OtherDVWBrowser - DVW file browser for other teams' matches
 * 
 * Features:
 * - Team autocomplete search (required)
 * - Date range input (required)
 * - Shows both DVW and Video availability
 * - Lazy loading pagination for large result sets
 * - DVW downloading with progress tracking
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { theme, borderStyle } from '../theme.js';
import {
  HudlAPI,
  groupMatchesByMonth,
  getSortedMonthKeys,
  formatMatchDate,
  formatMatchTime,
  formatConferenceDisplay,
  downloadManager,
  formatBytes,
  getDownloadedDVWs,
  getDownloadedVideos,
  searchTeams,
  formatTeamDisplay,
  setCachedTeams,
  getCachedTeams,
  debounce,
  getDisplayPath,
  openDownloadDir,
  type DownloadOptions,
  type HudlAuthData,
  type MatchEvent,
  type DVWInfo,
  type VideoInfo,
  type ContentAvailability,
  type DownloadProgress,
  type DownloadRecord,
  type LeagueTeam,
  type TeamSearchResult,
} from '../lib/index.js';

import { FolderPrompt } from './FolderPrompt.js';

// ============================================
// Types
// ============================================

interface OtherDVWBrowserProps {
  authData: HudlAuthData;
  onBack: () => void;
}

interface FilterState {
  teamSearchQuery: string;
  selectedTeam: LeagueTeam | null;
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

type ContentStatus = 'unknown' | 'checking' | 'available' | 'unavailable';
type DownloadStatus = 'none' | 'downloading' | 'completed' | 'error' | 'previously_downloaded';

interface MatchWithContent extends MatchEvent {
  dvwStatus: ContentStatus;
  dvwInfo?: DVWInfo;
  videoStatus: ContentStatus;
  videoInfo?: VideoInfo;
  dvwDownloadStatus: DownloadStatus;
  dvwDownloadProgress?: DownloadProgress;
  dvwDownloadRecord?: DownloadRecord;
  videoDownloadRecord?: DownloadRecord;
}

type FocusArea = 'filters' | 'results' | 'selection';
type FilterField = 'teamSearch' | 'startDate' | 'endDate';

interface BatchProgress {
  current: number;
  total: number;
  currentMatchId?: number;
}

// ============================================
// Helper Functions
// ============================================

function isMatchInFuture(matchDate: string): boolean {
  return new Date(matchDate) > new Date();
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  
  return {
    start: formatDateYYYYMMDD(threeMonthsAgo),
    end: formatDateYYYYMMDD(now),
  };
}

// ============================================
// Component
// ============================================

export function OtherDVWBrowser({ authData, onBack }: OtherDVWBrowserProps) {
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
  const [showResults, setShowResults] = useState(false);
  
  // Match results
  const [matches, setMatches] = useState<MatchWithContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    currentPage: 0,
    totalPages: 0,
    totalMatches: 0,
    hasMore: false,
    isLoadingMore: false,
  });
  
  // Content cache
  const [contentCache] = useState<Map<number, ContentAvailability>>(new Map());
  const [dvwDownloadedCache, setDvwDownloadedCache] = useState<Map<number, DownloadRecord>>(new Map());
  const [videoDownloadedCache, setVideoDownloadedCache] = useState<Map<number, DownloadRecord>>(new Map());
  
  // UI state
  const [focusArea, setFocusArea] = useState<FocusArea>('filters');
  const [focusedField, setFocusedField] = useState<FilterField>('teamSearch');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<string | null>(null);
  
  // Selection state
  const [selectedMatches, setSelectedMatches] = useState<Set<number>>(new Set());
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ current: 0, total: 0 });
  
  // Folder prompt
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  
  // API client
  const api = useMemo(() => new HudlAPI(authData), [authData]);
  
  // Group matches by month
  const groupedMatches = useMemo(() => {
    return groupMatchesByMonth(matches);
  }, [matches]);
  
  // Sorted month keys
  const monthKeys = useMemo(() => {
    return getSortedMonthKeys(groupedMatches);
  }, [groupedMatches]);
  
  // Build flat list for navigation
  const flatList = useMemo(() => {
    const items: Array<{ type: 'section'; key: string } | { type: 'match'; match: MatchWithContent; monthKey: string }> = [];
    
    for (const monthKey of monthKeys) {
      items.push({ type: 'section', key: monthKey });
      
      if (expandedSections.has(monthKey)) {
        const monthMatches = groupedMatches.get(monthKey) || [];
        for (const match of monthMatches) {
          items.push({ type: 'match', match: match as MatchWithContent, monthKey });
        }
      }
    }
    
    return items;
  }, [monthKeys, expandedSections, groupedMatches]);
  
  // Load teams on mount
  useEffect(() => {
    loadTeams();
  }, []);
  
  // Load downloaded status on mount
  useEffect(() => {
    async function loadDownloadedStatus() {
      try {
        const [dvwDownloaded, videoDownloaded] = await Promise.all([
          getDownloadedDVWs(),
          getDownloadedVideos(),
        ]);
        setDvwDownloadedCache(dvwDownloaded);
        setVideoDownloadedCache(videoDownloaded);
      } catch (err) {
        console.error('Failed to load download status:', err);
      }
    }
    loadDownloadedStatus();
  }, []);
  
  // Update download status when matches change
  useEffect(() => {
    if (matches.length > 0 && (dvwDownloadedCache.size > 0 || videoDownloadedCache.size > 0)) {
      const needsUpdate = matches.some(m => 
        (dvwDownloadedCache.has(m.id) && m.dvwDownloadStatus === 'none') ||
        (videoDownloadedCache.has(m.id) && !m.videoDownloadRecord)
      );
      
      if (needsUpdate) {
        setMatches(prev => prev.map(m => {
          const dvwRecord = dvwDownloadedCache.get(m.id);
          const videoRecord = videoDownloadedCache.get(m.id);
          
          if ((dvwRecord && m.dvwDownloadStatus === 'none') || (videoRecord && !m.videoDownloadRecord)) {
            return {
              ...m,
              dvwDownloadStatus: dvwRecord ? 'previously_downloaded' as DownloadStatus : m.dvwDownloadStatus,
              dvwDownloadRecord: dvwRecord || m.dvwDownloadRecord,
              videoDownloadRecord: videoRecord || m.videoDownloadRecord,
            };
          }
          return m;
        }));
      }
    }
  }, [matches.length, dvwDownloadedCache, videoDownloadedCache]);
  
  // Auto-expand first section
  useEffect(() => {
    if (monthKeys.length > 0 && expandedSections.size === 0) {
      setExpandedSections(new Set([monthKeys[0]!]));
    }
  }, [monthKeys]);
  
  // Debounced team search
  const debouncedSearch = useMemo(
    () => debounce((query: string, teams: LeagueTeam[]) => {
      if (query.length >= 2) {
        const results = searchTeams(teams, query);
        setSearchResults(results);
        setShowResults(results.length > 0);
        setSelectedResultIndex(0);
      } else {
        setSearchResults([]);
        setShowResults(false);
      }
    }, 150),
    []
  );
  
  // Run search when query changes
  useEffect(() => {
    if (filters.teamSearchQuery && allTeams.length > 0) {
      debouncedSearch(filters.teamSearchQuery, allTeams);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  }, [filters.teamSearchQuery, allTeams, debouncedSearch]);
  
  // Lazy load content availability
  useEffect(() => {
    if (flatList.length === 0 || focusArea !== 'results') return;
    
    const PREFETCH_RANGE = 5;
    const startIdx = Math.max(0, focusedIndex - PREFETCH_RANGE);
    const endIdx = Math.min(flatList.length - 1, focusedIndex + PREFETCH_RANGE);
    
    for (let i = startIdx; i <= endIdx; i++) {
      const item = flatList[i];
      if (item?.type === 'match' && item.match.dvwStatus === 'unknown') {
        const match = item.match;
        if (contentCache.has(match.id)) {
          const cached = contentCache.get(match.id)!;
          setMatches(prev => prev.map(m => 
            m.id === match.id 
              ? { 
                  ...m, 
                  dvwStatus: cached.dvw.available ? 'available' : 'unavailable',
                  dvwInfo: cached.dvw,
                  videoStatus: cached.video.available ? 'available' : 'unavailable',
                  videoInfo: cached.video,
                }
              : m
          ));
        } else {
          setMatches(prev => prev.map(m => 
            m.id === match.id ? { ...m, dvwStatus: 'checking' as ContentStatus, videoStatus: 'checking' as ContentStatus } : m
          ));
          
          api.checkContentAvailability(match).then(availability => {
            contentCache.set(match.id, availability);
            setMatches(prev => prev.map(m => 
              m.id === match.id 
                ? { 
                    ...m, 
                    dvwStatus: availability.dvw.available ? 'available' : 'unavailable',
                    dvwInfo: availability.dvw,
                    videoStatus: availability.video.available ? 'available' : 'unavailable',
                    videoInfo: availability.video,
                  }
                : m
            ));
          }).catch(() => {
            setMatches(prev => prev.map(m => 
              m.id === match.id 
                ? { ...m, dvwStatus: 'unavailable' as ContentStatus, videoStatus: 'unavailable' as ContentStatus } 
                : m
            ));
          });
        }
      }
    }
  }, [focusedIndex, flatList, api, contentCache, focusArea]);
  
  // Load teams
  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    setTeamsError(null);
    
    // Check cache first
    const cached = getCachedTeams();
    if (cached && cached.length > 0) {
      setAllTeams(cached);
      setTeamsLoading(false);
      return;
    }
    
    try {
      const teams = await api.getTeamsByLeague();
      setAllTeams(teams);
      setCachedTeams(teams);
    } catch (err) {
      setTeamsError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setTeamsLoading(false);
    }
  }, [api]);
  
  // Search matches
  const searchMatches = useCallback(async () => {
    if (!filters.selectedTeam) {
      setError('Please select a team');
      return;
    }
    
    if (!isValidDate(filters.startDate) || !isValidDate(filters.endDate)) {
      setError('Invalid date format (use YYYY-MM-DD)');
      return;
    }
    
    console.log(`[OtherDVW Search] Team selected: ${filters.selectedTeam.name} (ID: ${filters.selectedTeam.id})`);
    console.log(`[OtherDVW Search] Date range: ${filters.startDate} to ${filters.endDate}`);
    
    setLoading(true);
    setError(null);
    setMatches([]);
    setExpandedSections(new Set());
    setPagination({
      currentPage: 0,
      totalPages: 0,
      totalMatches: 0,
      hasMore: false,
      isLoadingMore: false,
    });
    
    try {
      const startDate = `${filters.startDate}T00:00:00.000`;
      const endDate = `${filters.endDate}T23:59:59.000`;
      const teamName = filters.selectedTeam.name;
      const teamId = filters.selectedTeam.id;
      
      // Primary approach: Use searchTerm with team name (matches VolleyMetrics web portal)
      const params = {
        startDate,
        endDate,
        matchType: 'match' as const,
        searchTerm: teamName,
        page: 1,
        size: 50,
      };
      
      console.log(`[OtherDVW Search] API params (primary):`, params);
      
      const response = await api.getOtherMatches(params);
      
      let finalResponse = response;
      
      // If searchTerm returns no results, fallback to teamId
      if (response.content.length === 0) {
        console.log(`[OtherDVW Search] No results with searchTerm, trying teamId fallback...`);
        const fallbackParams = {
          startDate,
          endDate,
          matchType: 'match' as const,
          teamId: teamId,
          page: 1,
          size: 50,
        };
        
        const fallbackResponse = await api.getOtherMatches(fallbackParams);
        finalResponse = fallbackResponse;
        console.log(`[OtherDVW Search] Fallback response: ${fallbackResponse.content.length} matches found`);
      } else {
        console.log(`[OtherDVW Search] Response: ${response.content.length} matches found (total: ${response.totalElements})`);
        if (response.content.length > 0) {
          console.log(`[OtherDVW Search] First 3 matches:`, response.content.slice(0, 3).map(m => ({
            id: m.id,
            date: m.matchDate,
            home: m.homeTeam.name,
            away: m.awayTeam.name,
          })));
        }
      }
      
      const matchesWithContent: MatchWithContent[] = finalResponse.content.map(match => ({
        ...match,
        dvwStatus: 'unknown' as ContentStatus,
        videoStatus: 'unknown' as ContentStatus,
        dvwDownloadStatus: 'none' as DownloadStatus,
      }));
      
      setMatches(matchesWithContent);
      setPagination({
        currentPage: finalResponse.number,
        totalPages: finalResponse.totalPages,
        totalMatches: finalResponse.totalElements,
        hasMore: !finalResponse.last,
        isLoadingMore: false,
      });
      
      // Focus on results after search
      if (matchesWithContent.length > 0) {
        setFocusArea('results');
        setFocusedIndex(0);
      }
    } catch (err) {
      console.error(`[OtherDVW Search] Error:`, err);
      setError(err instanceof Error ? err.message : 'Failed to search matches');
    } finally {
      setLoading(false);
    }
  }, [api, filters]);
  
  // Load more matches
  const loadMoreMatches = useCallback(async () => {
    if (!filters.selectedTeam || !pagination.hasMore || pagination.isLoadingMore) return;
    
    setPagination(prev => ({ ...prev, isLoadingMore: true }));
    
    try {
      const startDate = `${filters.startDate}T00:00:00.000`;
      const endDate = `${filters.endDate}T23:59:59.000`;
      
      const response = await api.getOtherMatches({
        startDate,
        endDate,
        matchType: 'match',
        searchTerm: filters.selectedTeam.name,
        page: pagination.currentPage + 2,
        size: 50,
      });
      
      const newMatches: MatchWithContent[] = response.content.map(match => ({
        ...match,
        dvwStatus: 'unknown' as ContentStatus,
        videoStatus: 'unknown' as ContentStatus,
        dvwDownloadStatus: 'none' as DownloadStatus,
      }));
      
      setMatches(prev => [...prev, ...newMatches]);
      setPagination({
        currentPage: response.number,
        totalPages: response.totalPages,
        totalMatches: response.totalElements,
        hasMore: !response.last,
        isLoadingMore: false,
      });
    } catch (err) {
      console.error('Failed to load more matches:', err);
      setPagination(prev => ({ ...prev, isLoadingMore: false }));
    }
  }, [api, filters, pagination]);
  
  // Toggle section
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
  
  // Download DVW
  const downloadMatchDVW = useCallback(async (match: MatchWithContent) => {
    if (match.dvwStatus !== 'available' || !match.dvwInfo) return;
    if (match.dvwDownloadStatus === 'downloading' || downloadManager.isDownloadingContent(match.id, 'dvw')) return;
    
    setMatches(prev => prev.map(m => 
      m.id === match.id ? { ...m, dvwDownloadStatus: 'downloading' as DownloadStatus } : m
    ));
    
    const result = await downloadManager.startDVWDownload(match, match.dvwInfo, authData);
    
    if (result.success && result.filepath) {
      const filename = match.dvwInfo.filename;
      const newRecord: DownloadRecord = {
        matchId: match.id,
        filepath: result.filepath,
        filename,
        downloadedAt: new Date().toISOString(),
        contentType: 'dvw',
      };
      setDvwDownloadedCache(prev => new Map(prev).set(match.id, newRecord));
      
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, dvwDownloadStatus: 'completed' as DownloadStatus, dvwDownloadRecord: newRecord }
          : m
      ));
    } else {
      setMatches(prev => prev.map(m => 
        m.id === match.id ? { ...m, dvwDownloadStatus: 'error' as DownloadStatus } : m
      ));
    }
  }, [authData]);
  
  // Batch download
  const downloadSelectedDVWs = useCallback(async (customFolder: string | null = null) => {
    if (selectedMatches.size === 0 || isBatchDownloading) return;
    
    setIsBatchDownloading(true);
    const matchesToDownload = matches.filter(m => selectedMatches.has(m.id));
    setBatchProgress({ current: 0, total: matchesToDownload.length });
    downloadManager.setBatchProgress({ current: 0, total: matchesToDownload.length });
    
    const downloadOptions: DownloadOptions | undefined = customFolder ? { customFolder } : undefined;
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < matchesToDownload.length; i++) {
      const match = matchesToDownload[i]!;
      const progress = { current: i + 1, total: matchesToDownload.length, currentMatchId: match.id };
      setBatchProgress(progress);
      downloadManager.setBatchProgress(progress);
      
      if (match.dvwDownloadStatus === 'previously_downloaded' || match.dvwDownloadStatus === 'completed') {
        console.log(`[Other DVW Batch] Skipping match ${match.id}: already downloaded`);
        skipCount++;
        continue;
      }
      
      if (isMatchInFuture(match.matchDate)) {
        console.log(`[Other DVW Batch] Skipping match ${match.id}: future match`);
        skipCount++;
        continue;
      }
      
      setMatches(prev => prev.map(m => 
        m.id === match.id ? { ...m, dvwStatus: 'checking' as ContentStatus } : m
      ));
      
      try {
        let dvwInfo = match.dvwInfo;
        
        if (!dvwInfo || !match.dvwInfo?.checked) {
          console.log(`[Other DVW Batch] Checking availability for match ${match.id}...`);
          const availability = await api.checkContentAvailability(match);
          contentCache.set(match.id, availability);
          dvwInfo = availability.dvw;
          console.log(`[Other DVW Batch] Match ${match.id} DVW available: ${availability.dvw.available}`);
          
          setMatches(prev => prev.map(m => 
            m.id === match.id 
              ? { 
                  ...m, 
                  dvwStatus: availability.dvw.available ? 'available' : 'unavailable',
                  dvwInfo: availability.dvw,
                  videoStatus: availability.video.available ? 'available' : 'unavailable',
                  videoInfo: availability.video,
                }
              : m
          ));
        }
        
        if (dvwInfo.available) {
          console.log(`[Other DVW Batch] Starting download for match ${match.id}...`);
          setMatches(prev => prev.map(m => 
            m.id === match.id ? { ...m, dvwDownloadStatus: 'downloading' as DownloadStatus } : m
          ));
          
          const result = await downloadManager.startDVWDownload(match, dvwInfo, authData, downloadOptions);
          
          if (result.success && result.filepath) {
            successCount++;
            const filename = dvwInfo.filename;
            const newRecord: DownloadRecord = {
              matchId: match.id,
              filepath: result.filepath,
              filename,
              downloadedAt: new Date().toISOString(),
              contentType: 'dvw',
            };
            setDvwDownloadedCache(prev => new Map(prev).set(match.id, newRecord));
            
            setMatches(prev => prev.map(m => 
              m.id === match.id 
                ? { ...m, dvwDownloadStatus: 'completed' as DownloadStatus, dvwDownloadRecord: newRecord }
                : m
            ));
          } else {
            errorCount++;
            setMatches(prev => prev.map(m => 
              m.id === match.id ? { ...m, dvwDownloadStatus: 'error' as DownloadStatus } : m
            ));
          }
        } else {
          console.log(`[Other DVW Batch] Skipping match ${match.id}: DVW not available`);
          skipCount++;
        }
      } catch (err) {
        console.error(`[Other DVW Batch] Error for match ${match.id}:`, err);
        errorCount++;
        setMatches(prev => prev.map(m => 
          m.id === match.id ? { ...m, dvwStatus: 'unavailable' as ContentStatus } : m
        ));
      }
    }
    
    setSelectedMatches(new Set());
    setIsBatchDownloading(false);
    setBatchProgress({ current: 0, total: 0 });
    downloadManager.setBatchProgress(null);
    
    const parts: string[] = [];
    if (successCount > 0) parts.push(`${successCount} downloaded`);
    if (skipCount > 0) parts.push(`${skipCount} skipped`);
    if (errorCount > 0) parts.push(`${errorCount} failed`);
    setNotification(`Batch complete: ${parts.join(', ')}`);
    setTimeout(() => setNotification(null), 5000);
  }, [selectedMatches, matches, isBatchDownloading, api, contentCache, authData]);
  
  // Keyboard input
  useInput((input, key) => {
    // Folder prompt takes priority
    if (showFolderPrompt) return;
    
    // Back
    if (key.escape) {
      if (focusArea === 'results' && matches.length > 0) {
        setFocusArea('filters');
      } else if (showResults) {
        setShowResults(false);
      } else {
        onBack();
      }
      return;
    }
    
    if (input === 'q' && focusArea !== 'filters') {
      onBack();
      return;
    }
    
    // Tab to switch focus areas
    if (key.tab) {
      if (focusArea === 'filters') {
        if (matches.length > 0) {
          setFocusArea('results');
          setFocusedIndex(0);
        }
      } else {
        setFocusArea('filters');
      }
      return;
    }
    
    // Handle filters area
    if (focusArea === 'filters') {
      // Navigate filter fields
      if (key.downArrow) {
        if (showResults) {
          setSelectedResultIndex(prev => Math.min(searchResults.length - 1, prev + 1));
        } else {
          const fields: FilterField[] = ['teamSearch', 'startDate', 'endDate'];
          const idx = fields.indexOf(focusedField);
          if (idx < fields.length - 1) {
            const nextField = fields[idx + 1]!;
            setFocusedField(nextField);
            if (nextField === 'startDate') {
              setFilters(prev => ({ ...prev, startDate: '' }));
            } else if (nextField === 'endDate') {
              setFilters(prev => ({ ...prev, endDate: '' }));
            }
          }
        }
        return;
      }
      
      if (key.upArrow) {
        if (showResults) {
          setSelectedResultIndex(prev => Math.max(0, prev - 1));
        } else {
          const fields: FilterField[] = ['teamSearch', 'startDate', 'endDate'];
          const idx = fields.indexOf(focusedField);
          if (idx > 0) {
            const prevField = fields[idx - 1]!;
            setFocusedField(prevField);
            if (prevField === 'startDate') {
              setFilters(prev => ({ ...prev, startDate: '' }));
            } else if (prevField === 'endDate') {
              setFilters(prev => ({ ...prev, endDate: '' }));
            }
          }
        }
        return;
      }
      
      // Select team from results or trigger search
      if (key.return) {
        if (showResults && searchResults.length > 0) {
          const selected = searchResults[selectedResultIndex];
          if (selected) {
            setFilters(prev => ({
              ...prev,
              selectedTeam: selected.team,
              teamSearchQuery: selected.team.name,
            }));
            setShowResults(false);
            // Move focus to start date after selecting team
            setFocusedField('startDate');
          }
        } else if (filters.selectedTeam && isValidDate(filters.startDate) && isValidDate(filters.endDate)) {
          // Trigger search when Enter is pressed with valid filters
          searchMatches();
        }
        return;
      }
      
      // Text input for focused field
      if (focusedField === 'teamSearch') {
        if (key.backspace || key.delete) {
          setFilters(prev => ({
            ...prev,
            teamSearchQuery: prev.teamSearchQuery.slice(0, -1),
            selectedTeam: null,
          }));
        } else if (input && input.length === 1) {
          setFilters(prev => ({
            ...prev,
            teamSearchQuery: prev.teamSearchQuery + input,
            selectedTeam: null,
          }));
        }
        return;
      }
      
      if (focusedField === 'startDate') {
        if (key.backspace || key.delete) {
          setFilters(prev => ({ ...prev, startDate: prev.startDate.slice(0, -1) }));
        } else if (input && /[\d-]/.test(input)) {
          setFilters(prev => ({ ...prev, startDate: prev.startDate + input }));
        }
        return;
      }
      
      if (focusedField === 'endDate') {
        if (key.backspace || key.delete) {
          setFilters(prev => ({ ...prev, endDate: prev.endDate.slice(0, -1) }));
        } else if (input && /[\d-]/.test(input)) {
          setFilters(prev => ({ ...prev, endDate: prev.endDate + input }));
        }
        return;
      }
    }
    
    // Handle results area
    if (focusArea === 'results') {
      // Navigation
      if (key.upArrow || input === 'k') {
        setFocusedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      
      if (key.downArrow || input === 'j') {
        setFocusedIndex(prev => {
          const newIndex = Math.min(flatList.length - 1, prev + 1);
          // Load more when near end
          if (newIndex >= flatList.length - 5 && pagination.hasMore && !pagination.isLoadingMore) {
            loadMoreMatches();
          }
          return newIndex;
        });
        return;
      }
      
      // Expand/collapse section
      if (key.return) {
        const item = flatList[focusedIndex];
        if (item?.type === 'section') {
          toggleSection(item.key);
        }
        return;
      }
      
      // Toggle selection
      if (input === ' ') {
        const item = flatList[focusedIndex];
        if (item?.type === 'match') {
          const match = item.match;
          const isFuture = isMatchInFuture(match.matchDate);
          const isDownloading = match.dvwDownloadStatus === 'downloading';
          
          if (!isFuture && !isDownloading && !isBatchDownloading) {
            setSelectedMatches(prev => {
              const next = new Set(prev);
              if (next.has(match.id)) {
                next.delete(match.id);
              } else {
                next.add(match.id);
              }
              return next;
            });
          }
        }
        return;
      }
      
      // Download single DVW
      if (input === 'd' && !isBatchDownloading) {
        const item = flatList[focusedIndex];
        if (item?.type === 'match') {
          downloadMatchDVW(item.match);
        }
        return;
      }
      
      // Clear selection
      if (input === 'c' && selectedMatches.size > 0 && !isBatchDownloading) {
        setSelectedMatches(new Set());
        setNotification('Selection cleared');
        setTimeout(() => setNotification(null), 1500);
        return;
      }
      
      // Manual content check
      if (input === 'v') {
        const item = flatList[focusedIndex];
        if (item?.type === 'match') {
          contentCache.delete(item.match.id);
          setMatches(prev => prev.map(m => 
            m.id === item.match.id 
              ? { ...m, dvwStatus: 'checking' as ContentStatus, videoStatus: 'checking' as ContentStatus } 
              : m
          ));
          
          api.checkContentAvailability(item.match).then(availability => {
            contentCache.set(item.match.id, availability);
            setMatches(prev => prev.map(m => 
              m.id === item.match.id 
                ? { 
                    ...m, 
                    dvwStatus: availability.dvw.available ? 'available' : 'unavailable',
                    dvwInfo: availability.dvw,
                    videoStatus: availability.video.available ? 'available' : 'unavailable',
                    videoInfo: availability.video,
                  }
                : m
            ));
          });
        }
        return;
      }
      
      // Batch download
      if (input === 'D' && selectedMatches.size > 0 && !isBatchDownloading) {
        setShowFolderPrompt(true);
        return;
      }
      
      // Open download folder
      if (input === 'p') {
        openDownloadDir().catch(err => {
          setNotification('Could not open folder: ' + err.message);
          setTimeout(() => setNotification(null), 3000);
        });
        return;
      }
    }
  });
  
  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box
        borderStyle={borderStyle}
        borderColor={theme.border}
        borderBottom={true}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        marginBottom={1}
        justifyContent="space-between"
      >
        <Box>
          <Text color={theme.primary} bold>Other Teams' DVW Files</Text>
          {filters.selectedTeam && (
            <>
              <Text color={theme.textDim}> - </Text>
              <Text color={theme.accent}>{filters.selectedTeam.name}</Text>
            </>
          )}
        </Box>
        <Box>
          {matches.length > 0 && (
            <Text color={theme.text}>{matches.length}/{pagination.totalMatches} matches</Text>
          )}
        </Box>
      </Box>
      
      {/* Filter Section */}
      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Text color={focusArea === 'filters' ? theme.primary : theme.textDim} bold>
          Search Filters {focusArea === 'filters' ? '(active)' : ''}
        </Text>
        
        {/* Team Search */}
        <Box marginTop={1}>
          <Text color={focusedField === 'teamSearch' && focusArea === 'filters' ? theme.primary : theme.textMuted}>
            Team: 
          </Text>
          <Text color={theme.text}>
            {filters.teamSearchQuery || (teamsLoading ? 'Loading teams...' : 'Type to search...')}
          </Text>
          {focusedField === 'teamSearch' && focusArea === 'filters' && <Text color={theme.textDim}>|</Text>}
        </Box>
        
        {/* Autocomplete Results */}
        {showResults && focusArea === 'filters' && (
          <Box flexDirection="column" marginLeft={2} borderStyle="single" borderColor={theme.border}>
            {searchResults.slice(0, 8).map((result, idx) => (
              <Text 
                key={result.team.id}
                color={idx === selectedResultIndex ? theme.primary : theme.text}
                backgroundColor={idx === selectedResultIndex ? theme.backgroundElement : undefined}
              >
                {formatTeamDisplay(result.team)}
              </Text>
            ))}
          </Box>
        )}
        
        {/* Date Range */}
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={focusedField === 'startDate' && focusArea === 'filters' ? theme.primary : theme.textMuted}>
              Start: 
            </Text>
            <Text color={theme.text}>
              {filters.startDate}
              {focusedField === 'startDate' && focusArea === 'filters' && <Text color={theme.textDim}>|</Text>}
            </Text>
          </Box>
          <Box>
            <Text color={focusedField === 'endDate' && focusArea === 'filters' ? theme.primary : theme.textMuted}>
              End: 
            </Text>
            <Text color={theme.text}>
              {filters.endDate}
              {focusedField === 'endDate' && focusArea === 'filters' && <Text color={theme.textDim}>|</Text>}
            </Text>
          </Box>
        </Box>
        
        {/* Search Button Hint */}
        {focusArea === 'filters' && filters.selectedTeam && isValidDate(filters.startDate) && isValidDate(filters.endDate) && (
          <Box marginTop={1}>
            <Text color={theme.success}>Press Enter to search</Text>
          </Box>
        )}
        
        {/* Invalid Date Warning */}
        {focusArea === 'filters' && filters.selectedTeam && (!isValidDate(filters.startDate) || !isValidDate(filters.endDate)) && (
          <Box marginTop={1}>
            <Text color={theme.error}>Invalid date format (use YYYY-MM-DD)</Text>
          </Box>
        )}
      </Box>
      
      {/* Loading State */}
      {loading && (
        <Box paddingX={1}>
          <Text color={theme.primary}><Spinner type="dots" /></Text>
          <Text color={theme.text}> Searching matches...</Text>
        </Box>
      )}
      
      {/* Error State */}
      {error && (
        <Box paddingX={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      )}
      
      {/* Results */}
      {!loading && matches.length > 0 && (
        <>
          {/* Legend */}
          <Box paddingX={1} marginBottom={1}>
            <Text color={theme.textMuted}>Status: </Text>
            <Text color={theme.textDim}>[DVW]</Text>
            <Text color={theme.textDim}>[Video] </Text>
            <Text color={theme.success}>D</Text>
            <Text color={theme.textMuted}>=available </Text>
            <Text color={theme.error}>X</Text>
            <Text color={theme.textMuted}>=unavailable </Text>
            <Text color={theme.primary}>*</Text>
            <Text color={theme.textMuted}>=downloaded</Text>
          </Box>
          
          {/* Match List */}
          <Box flexDirection="column" paddingX={1}>
            {flatList.map((item, index) => {
              const isFocused = focusArea === 'results' && index === focusedIndex;
              
              if (item.type === 'section') {
                const monthMatches = groupedMatches.get(item.key) || [];
                const isExpanded = expandedSections.has(item.key);
                
                return (
                  <Box key={`section-${item.key}`} paddingY={0}>
                    <Text backgroundColor={isFocused ? theme.backgroundElement : undefined}>
                      <Text color={theme.accent}>{isExpanded ? 'v' : '>'}</Text>
                      <Text color={isFocused ? theme.primary : theme.text} bold> {item.key}</Text>
                      <Text color={theme.textMuted}> ({monthMatches.length} matches)</Text>
                    </Text>
                  </Box>
                );
              }
              
              return (
                <DVWMatchItem
                  key={`match-${item.match.id}`}
                  match={item.match}
                  isFocused={isFocused}
                  isSelected={selectedMatches.has(item.match.id)}
                />
              );
            })}
          </Box>
          
          {/* Loading More */}
          {pagination.isLoadingMore && (
            <Box paddingX={1} marginTop={1}>
              <Text color={theme.primary}><Spinner type="dots" /></Text>
              <Text color={theme.textMuted}> Loading more...</Text>
            </Box>
          )}
        </>
      )}
      
      {/* Empty State */}
      {!loading && matches.length === 0 && filters.selectedTeam && (
        <Box paddingX={1}>
          <Text color={theme.warning}>No matches found. Try adjusting the date range.</Text>
        </Box>
      )}
      
      {/* Selection Panel */}
      {selectedMatches.size > 0 && (
        <Box 
          borderStyle={borderStyle}
          borderColor={theme.border}
          paddingX={1}
          paddingY={1}
          marginX={1}
          marginTop={1}
        >
          <Box flexDirection="column">
            <Text color={theme.accent} bold>Selection: </Text>
            <Box>
              <Text color={theme.primary} bold>{selectedMatches.size}</Text>
              <Text color={theme.text}> DVW file{selectedMatches.size !== 1 ? 's' : ''} selected</Text>
            </Box>
            {!isBatchDownloading ? (
              <Box marginTop={1}>
                <Text color={theme.success}>shift + d</Text>
                <Text color={theme.textMuted}> = download all  </Text>
                <Text color={theme.textDim}>c</Text>
                <Text color={theme.textMuted}> = clear</Text>
              </Box>
            ) : (
              <Box marginTop={1}>
                <Text color={theme.warning}><Spinner type="dots" /> </Text>
                <Text color={theme.warning}>Downloading {batchProgress.current}/{batchProgress.total}</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
      
      {/* Notification */}
      {notification && (
        <Box
          borderStyle={borderStyle}
          borderColor={theme.success}
          paddingX={2}
          paddingY={0}
          marginX={1}
          marginTop={1}
        >
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
          <Text color={theme.textMuted}>Tab</Text> switch  
          <Text color={theme.textMuted}> - Enter</Text> select/expand  
          <Text color={theme.primary}> - Space</Text> select  
          <Text color={theme.textMuted}> - d</Text> dl-one  
          {selectedMatches.size > 0 && (
            <>
              <Text color={theme.success}> - D</Text> dl-all  
            </>
          )}
          <Text color={theme.textMuted}> - v</Text> check  
          <Text color={theme.textMuted}> - Esc</Text> back
        </Text>
      </Box>
      
      {/* Download Location */}
      <Box
        borderStyle={borderStyle}
        borderColor={theme.borderSubtle}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        paddingTop={1}
        marginTop={0}
      >
        <Text color={theme.textDim}>
          <Text color={theme.textMuted}>Downloads: </Text>
          <Text color={theme.accent}>{getDisplayPath()}</Text>
          <Text color={theme.textMuted}> (press </Text>
          <Text color={theme.primary}>p</Text>
          <Text color={theme.textMuted}> to open)</Text>
        </Text>
      </Box>
      
      {/* Folder Prompt */}
      {showFolderPrompt && (
        <FolderPrompt
          teamAbbrev={filters.selectedTeam?.abbreviation || 'OTHER'}
          teamName={`DVW-${filters.selectedTeam?.abbreviation || 'Other'}`}
          onConfirm={(folderName) => {
            setShowFolderPrompt(false);
            downloadSelectedDVWs(folderName);
          }}
          onCancel={() => setShowFolderPrompt(false)}
        />
      )}
    </Box>
  );
}

// ============================================
// Sub-components
// ============================================

interface DVWMatchItemProps {
  match: MatchWithContent;
  isFocused: boolean;
  isSelected: boolean;
}

function DVWMatchItem({ match, isFocused, isSelected }: DVWMatchItemProps) {
  const bgColor = isFocused ? theme.backgroundElement : undefined;
  const isFutureMatch = isMatchInFuture(match.matchDate);
  const canSelect = !isFutureMatch && match.dvwDownloadStatus !== 'downloading';
  const checkboxChar = isSelected ? 'x' : ' ';
  const checkboxColor = !canSelect ? theme.textDim : isSelected ? theme.success : theme.textMuted;
  
  // DVW status
  let dvwIndicator: React.ReactNode;
  let dvwColor: string;
  
  if (match.dvwDownloadStatus === 'downloading') {
    dvwIndicator = <Spinner type="dots" />;
    dvwColor = theme.warning;
  } else if (match.dvwDownloadStatus === 'completed') {
    dvwIndicator = '*';
    dvwColor = theme.success;
  } else if (match.dvwDownloadStatus === 'previously_downloaded') {
    dvwIndicator = '*';
    dvwColor = theme.primary;
  } else if (match.dvwDownloadStatus === 'error') {
    dvwIndicator = '!';
    dvwColor = theme.error;
  } else {
    switch (match.dvwStatus) {
      case 'available':
        dvwIndicator = 'D';
        dvwColor = theme.success;
        break;
      case 'unavailable':
        dvwIndicator = 'X';
        dvwColor = theme.error;
        break;
      case 'checking':
        dvwIndicator = <Spinner type="dots" />;
        dvwColor = theme.warning;
        break;
      default:
        dvwIndicator = '?';
        dvwColor = theme.textDim;
    }
  }
  
  // Video status
  let videoIndicator: React.ReactNode;
  let videoColor: string;
  
  if (match.videoDownloadRecord) {
    videoIndicator = '*';
    videoColor = theme.primary;
  } else {
    switch (match.videoStatus) {
      case 'available':
        videoIndicator = 'V';
        videoColor = theme.success;
        break;
      case 'unavailable':
        videoIndicator = 'X';
        videoColor = theme.error;
        break;
      case 'checking':
        videoIndicator = <Spinner type="dots" />;
        videoColor = theme.warning;
        break;
      default:
        videoIndicator = '?';
        videoColor = theme.textDim;
    }
  }
  
  // Status text
  let statusText: string | null = null;
  if (isFocused) {
    if (match.dvwDownloadStatus === 'completed' || match.dvwDownloadStatus === 'previously_downloaded') {
      statusText = match.dvwDownloadRecord?.filename || ' Downloaded';
    } else if (match.dvwDownloadStatus === 'error') {
      statusText = match.dvwDownloadProgress?.error || ' Error';
    } else if (match.dvwStatus === 'available') {
      statusText = ' [d to download DVW]';
    }
  }
  
  const dateStr = formatMatchDate(match.matchDate, 'short');
  const timeStr = formatMatchTime(match.matchDate);
  const homeAbbr = match.homeTeam.abbreviation;
  const awayAbbr = match.awayTeam.abbreviation;
  const isConference = match.isConferenceGame;
  
  return (
    <Box paddingLeft={2} flexDirection="column">
      <Text backgroundColor={bgColor}>
        <Text color={checkboxColor}>[{checkboxChar}]</Text>
        <Text color={dvwColor}>[{dvwIndicator}]</Text>
        <Text color={videoColor}>[{videoIndicator}]</Text>
        <Text color={isFocused ? theme.primary : theme.text}> {dateStr}</Text>
        <Text color={theme.textDim}> {timeStr}</Text>
        <Text color={theme.textMuted}> - </Text>
        <Text color={theme.accent}>{awayAbbr}</Text>
        <Text color={theme.textMuted}> vs </Text>
        <Text color={theme.accent}>{homeAbbr}</Text>
        {isConference && <Text color={theme.info}> [Conf]</Text>}
        {statusText && <Text color={theme.textMuted}>{statusText}</Text>}
      </Text>
    </Box>
  );
}
