/**
 * TeamDVWBrowser - DVW file browser with monthly grouping
 * Displays matches organized by month with collapsible sections
 * Shows both DVW and Video availability for each match
 * Supports DVW downloads with progress tracking
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
  downloadManager,
  formatBytes,
  getDownloadedDVWs,
  getDownloadedVideos,
  getDisplayPath,
  openDownloadDir,
  getStoredUser,
  generateDVWFilename,
  type DownloadOptions,
  type HudlAuthData,
  type MatchEvent,
  type DVWInfo,
  type VideoInfo,
  type ContentAvailability,
  type DownloadProgress,
  type DownloadRecord,
} from '../lib/index.js';

import { FolderPrompt } from './FolderPrompt.js';

// ============================================
// Types
// ============================================

interface TeamDVWBrowserProps {
  authData: HudlAuthData;
  onBack: () => void;
}

interface Account {
  id: number;
  accountType: { accountClass: string; sport: string };
  role: string;
  teamId: number;
  team: {
    id: number;
    name: string;
    abbreviation: string;
  };
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
  videoDownloadRecord?: DownloadRecord; // For showing video download status
}

interface BatchProgress {
  current: number;
  total: number;
  currentMatchId?: number;
}

/** Check if a match date is in the future */
function isMatchInFuture(matchDate: string): boolean {
  return new Date(matchDate) > new Date();
}

// Season helper - generate season years (e.g., "2025-26" for Aug 2025 - May 2026)
function getSeasonOptions(): { label: string; startYear: number }[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  // If before August, current season started last year
  const currentSeasonStart = currentMonth < 7 ? currentYear - 1 : currentYear;
  
  // Show seasons back to 2017-18
  const EARLIEST_SEASON_START = 2017;
  const numberOfSeasons = currentSeasonStart - EARLIEST_SEASON_START + 1;
  
  const seasons: { label: string; startYear: number }[] = [];
  for (let i = 0; i < numberOfSeasons; i++) {
    const startYear = currentSeasonStart - i;
    
    // Stop at earliest season (2017-18)
    if (startYear < EARLIEST_SEASON_START) break;
    
    const endYear = startYear + 1;
    seasons.push({
      label: `${startYear}-${String(endYear).slice(2)}`,
      startYear,
    });
  }
  return seasons;
}

function getSeasonDateRange(startYear: number): { startDate: string; endDate: string } {
  return {
    startDate: `${startYear}-08-01T00:00:00.000`,
    endDate: `${startYear + 1}-05-31T23:59:00.000`,
  };
}

// ============================================
// Component
// ============================================

export function TeamDVWBrowser({ authData, onBack }: TeamDVWBrowserProps) {
  // Season options
  const seasonOptions = useMemo(() => getSeasonOptions(), []);
  
  // State
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState(0); // 0 = current season
  const [matches, setMatches] = useState<MatchWithContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [contentCache] = useState<Map<number, ContentAvailability>>(new Map());
  const [notification, setNotification] = useState<string | null>(null);
  const [dvwDownloadedCache, setDvwDownloadedCache] = useState<Map<number, DownloadRecord>>(new Map());
  const [videoDownloadedCache, setVideoDownloadedCache] = useState<Map<number, DownloadRecord>>(new Map());
  
  // Selection state for batch downloads
  const [selectedMatches, setSelectedMatches] = useState<Set<number>>(new Set());
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ current: 0, total: 0 });
  
  // Folder prompt state
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  
  // User accounts state
  const [userTeamAbbr, setUserTeamAbbr] = useState<string>('');
  
  // Get current season
  const currentSeason = seasonOptions[selectedSeasonIndex]!;
  
  // API client
  const api = useMemo(() => new HudlAPI(authData), [authData]);
  
  // Group matches by month
  const groupedMatches = useMemo(() => {
    return groupMatchesByMonth(matches);
  }, [matches]);
  
  // Sorted month keys (newest first)
  const monthKeys = useMemo(() => {
    return getSortedMonthKeys(groupedMatches);
  }, [groupedMatches]);
  
  // Build flat list for navigation (sections + matches)
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
  
  // Load matches when season changes
  useEffect(() => {
    loadMatches();
  }, [selectedSeasonIndex]);
  
  // Load user accounts to get team abbreviation
  useEffect(() => {
    async function loadAccounts() {
      try {
        const user = await getStoredUser();
        if (user) {
          const accountsResponse = await api.getAccounts();
          
          const activeAccount = accountsResponse.accounts.find(acc => acc.teamId === user.teamId);
          if (activeAccount) {
            setUserTeamAbbr(activeAccount.team.abbreviation);
          }
        }
      } catch (err) {
        console.error('Failed to load accounts:', err);
      }
    }
    loadAccounts();
  }, [api]);
  
  // Load downloaded DVW and video records on mount
  useEffect(() => {
    async function loadDownloadedStatus() {
      try {
        const [dvwDownloaded, videoDownloaded] = await Promise.all([
          getDownloadedDVWs(),
          getDownloadedVideos(),
        ]);
        setDvwDownloadedCache(dvwDownloaded);
        setVideoDownloadedCache(videoDownloaded);
        
        // Update matches with previously downloaded status
        if (dvwDownloaded.size > 0 || videoDownloaded.size > 0) {
          setMatches(prev => prev.map(m => {
            const dvwRecord = dvwDownloaded.get(m.id);
            const videoRecord = videoDownloaded.get(m.id);
            return {
              ...m,
              dvwDownloadStatus: dvwRecord ? 'previously_downloaded' as DownloadStatus : m.dvwDownloadStatus,
              dvwDownloadRecord: dvwRecord,
              videoDownloadRecord: videoRecord,
            };
          }));
        }
      } catch (err) {
        console.error('Failed to load download status:', err);
      }
    }
    
    loadDownloadedStatus();
  }, []);
  
  // Update download status when matches change (after initial load)
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
  
  // Auto-expand first section with matches
  useEffect(() => {
    if (monthKeys.length > 0 && expandedSections.size === 0) {
      setExpandedSections(new Set([monthKeys[0]!]));
    }
  }, [monthKeys]);
  
  // Lazy load content availability for visible matches
  useEffect(() => {
    if (flatList.length === 0) return;
    
    // Check content for matches near the focused item
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
          // Mark as checking and fetch
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
  }, [focusedIndex, flatList, api, contentCache]);
  
  // Load matches from API
  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMatches([]);
    setExpandedSections(new Set());
    setFocusedIndex(0);
    
    try {
      const dateRange = getSeasonDateRange(currentSeason.startYear);
      const response = await api.getMatches({
        ...dateRange,
        matchType: 'match',
        size: 50,
      });
      
      // Convert to MatchWithContent with unknown status
      const matchesWithContent: MatchWithContent[] = response.content.map(match => ({
        ...match,
        dvwStatus: 'unknown' as ContentStatus,
        videoStatus: 'unknown' as ContentStatus,
        dvwDownloadStatus: 'none' as DownloadStatus,
      }));
      
      setMatches(matchesWithContent);
      
      // Load more pages if needed
      if (!response.last) {
        loadRemainingMatches(response.totalPages, dateRange);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [api, currentSeason]);
  
  // Load remaining pages in background
  const loadRemainingMatches = useCallback(async (
    totalPages: number,
    dateRange: { startDate: string; endDate: string }
  ) => {
    for (let page = 2; page <= totalPages; page++) {
      try {
        const response = await api.getMatches({
          ...dateRange,
          matchType: 'match',
          page,
          size: 50,
        });
        
        setMatches(prev => [
          ...prev,
          ...response.content.map(match => ({
            ...match,
            dvwStatus: 'unknown' as ContentStatus,
            videoStatus: 'unknown' as ContentStatus,
            dvwDownloadStatus: 'none' as DownloadStatus,
          })),
        ]);
      } catch (err) {
        console.error(`Failed to load page ${page}:`, err);
      }
    }
  }, [api]);
  
  // Check content availability for a match
  const checkContentForMatch = useCallback(async (match: MatchWithContent, forceRecheck: boolean = false) => {
    if (!forceRecheck && match.dvwStatus === 'checking') return;
    if (!forceRecheck && match.dvwStatus !== 'unknown') return;
    
    if (!forceRecheck && contentCache.has(match.id)) {
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
      return;
    }
    
    setMatches(prev => prev.map(m => 
      m.id === match.id ? { ...m, dvwStatus: 'checking' as ContentStatus, videoStatus: 'checking' as ContentStatus } : m
    ));
    
    try {
      const availability = await api.checkContentAvailability(match);
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
    } catch {
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, dvwStatus: 'unavailable' as ContentStatus, videoStatus: 'unavailable' as ContentStatus } 
          : m
      ));
    }
  }, [api, contentCache]);
  
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
  
  // Download DVW for a match
  const downloadMatchDVW = useCallback(async (match: MatchWithContent) => {
    if (match.dvwStatus !== 'available' || !match.dvwInfo) {
      return;
    }
    if (match.dvwDownloadStatus === 'downloading' || downloadManager.isDownloadingContent(match.id, 'dvw')) {
      return;
    }
    
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
        m.id === match.id 
          ? { ...m, dvwDownloadStatus: 'error' as DownloadStatus }
          : m
      ));
    }
  }, [authData]);
  
  // Batch download selected DVW files
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
      
      // Skip if already downloaded
      if (match.dvwDownloadStatus === 'previously_downloaded' || 
          match.dvwDownloadStatus === 'completed') {
        console.log(`[DVW Batch] Skipping match ${match.id}: already downloaded`);
        skipCount++;
        continue;
      }
      
      // Skip future matches
      if (isMatchInFuture(match.matchDate)) {
        console.log(`[DVW Batch] Skipping match ${match.id}: future match`);
        skipCount++;
        continue;
      }
      
      // Check content availability first
      setMatches(prev => prev.map(m => 
        m.id === match.id ? { ...m, dvwStatus: 'checking' as ContentStatus } : m
      ));
      
      try {
        let dvwInfo = match.dvwInfo;
        
        // If no DVW info cached, fetch it
        if (!dvwInfo || !match.dvwInfo?.checked) {
          console.log(`[DVW Batch] Checking availability for match ${match.id}...`);
          const availability = await api.checkContentAvailability(match);
          contentCache.set(match.id, availability);
          dvwInfo = availability.dvw;
          console.log(`[DVW Batch] Match ${match.id} DVW available: ${availability.dvw.available}`);
          
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
        
        // If available, download it
        if (dvwInfo.available) {
          console.log(`[DVW Batch] Starting download for match ${match.id}...`);
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
          // DVW not available, skip it
          console.log(`[DVW Batch] Skipping match ${match.id}: DVW not available`);
          skipCount++;
        }
        
      } catch (err) {
        errorCount++;
        setMatches(prev => prev.map(m => 
          m.id === match.id ? { ...m, dvwStatus: 'unavailable' as ContentStatus } : m
        ));
      }
    }
    
    // Clear selection after batch download
    setSelectedMatches(new Set());
    setIsBatchDownloading(false);
    setBatchProgress({ current: 0, total: 0 });
    downloadManager.setBatchProgress(null);
    
    // Show summary notification
    const parts: string[] = [];
    if (successCount > 0) parts.push(`${successCount} downloaded`);
    if (skipCount > 0) parts.push(`${skipCount} skipped`);
    if (errorCount > 0) parts.push(`${errorCount} failed`);
    setNotification(`Batch complete: ${parts.join(', ')}`);
    setTimeout(() => setNotification(null), 5000);
    
  }, [selectedMatches, matches, isBatchDownloading, api, contentCache, authData]);
  
  // Keyboard input handler
  useInput((input, key) => {
    // Season navigation with left/right arrows
    if (key.leftArrow) {
      setSelectedSeasonIndex(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setSelectedSeasonIndex(prev => Math.min(seasonOptions.length - 1, prev + 1));
      return;
    }
    
    // List navigation
    if (!showFolderPrompt) {
      if (key.upArrow || input === 'k') {
        setFocusedIndex(prev => Math.max(0, prev - 1));
      }
      if (key.downArrow || input === 'j') {
        setFocusedIndex(prev => Math.min(flatList.length - 1, prev + 1));
      }
    }
    
    // Expand/collapse section or trigger action
    if (!showFolderPrompt) {
      if (key.return) {
        const item = flatList[focusedIndex];
        if (item?.type === 'section') {
          toggleSection(item.key);
        }
      }
      
      // Space bar - toggle selection
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
            
            // Show notification if already downloaded
            const alreadyDownloaded = match.dvwDownloadStatus === 'previously_downloaded' || 
                                       match.dvwDownloadStatus === 'completed';
            if (alreadyDownloaded && !selectedMatches.has(match.id)) {
              setNotification('DVW already downloaded - will skip in batch');
              setTimeout(() => setNotification(null), 2000);
            }
          } else if (isFuture) {
            setNotification('Cannot select future matches');
            setTimeout(() => setNotification(null), 2000);
          }
        }
        return;
      }
      
      // Download single DVW (lowercase d)
      if (input === 'd' && !isBatchDownloading) {
        const item = flatList[focusedIndex];
        if (item?.type === 'match') {
          downloadMatchDVW(item.match);
        }
      }
      
      // Clear selection (c key)
      if (input === 'c' && selectedMatches.size > 0 && !isBatchDownloading) {
        setSelectedMatches(new Set());
        setNotification('Selection cleared');
        setTimeout(() => setNotification(null), 1500);
      }
      
      // Manual content check
      if (input === 'v') {
        const item = flatList[focusedIndex];
        if (item?.type === 'match') {
          contentCache.delete(item.match.id);
          checkContentForMatch(item.match, true);
        }
      }
      
      // Refresh
      if (input === 'r' && !isBatchDownloading) {
        loadMatches();
      }
    }
    
    // Batch download (uppercase D) - show folder prompt
    if (input === 'D' && selectedMatches.size > 0 && !isBatchDownloading && !showFolderPrompt) {
      setShowFolderPrompt(true);
    }
    
    // Open download folder (p key)
    if (input === 'p' && !showFolderPrompt) {
      openDownloadDir().catch(err => {
        setNotification('Could not open folder: ' + err.message);
        setTimeout(() => setNotification(null), 3000);
      });
    }
    
    // Back
    if (key.escape || input === 'q') {
      onBack();
    }
  });
  
  // Render loading state
  if (loading && matches.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box>
          <Text color={theme.primary}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.text}> Loading matches...</Text>
        </Box>
      </Box>
    );
  }
  
  // Render error state
  if (error && matches.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.error}>Error: {error}</Text>
        <Text color={theme.textDim}>Press 'r' to retry or 'q' to go back</Text>
      </Box>
    );
  }
  
  // Render empty state
  if (matches.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.warning}>No matches found for {currentSeason.label} season</Text>
        <Text color={theme.textDim}>Use left/right arrows to change season, 'r' to refresh, Esc to go back</Text>
      </Box>
    );
  }
  
  return (
    <Box flexDirection="column" width="100%">
      {/* Header with season selector */}
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
          <Text color={theme.primary} bold>DVW Files</Text>
          <Text color={theme.textDim}> - </Text>
          <Text color={theme.text}>{matches.length} matches</Text>
          {loading && (
            <Text color={theme.textMuted}> (loading more...)</Text>
          )}
        </Box>
        
        {/* Season selector */}
        <Box>
          <Text color={theme.textMuted}>Season: </Text>
          {selectedSeasonIndex > 0 && <Text color={theme.textDim}>{'<'} </Text>}
          <Text color={theme.accent} bold>{currentSeason.label}</Text>
          {selectedSeasonIndex < seasonOptions.length - 1 && <Text color={theme.textDim}> {'>'}</Text>}
        </Box>
      </Box>
      
      {/* Legend for dual status */}
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
      
      {/* Content list */}
      <Box flexDirection="column" paddingX={1}>
        {flatList.map((item, index) => {
          const isFocused = index === focusedIndex;
          
          if (item.type === 'section') {
            const monthMatches = groupedMatches.get(item.key) || [];
            const isExpanded = expandedSections.has(item.key);
            
            return (
              <SectionHeader
                key={`section-${item.key}-${index}`}
                title={item.key}
                count={monthMatches.length}
                isExpanded={isExpanded}
                isFocused={isFocused}
              />
            );
          }
          
          return (
            <DVWMatchItem
              key={`match-${item.match.id}-${index}`}
              match={item.match}
              isFocused={isFocused}
              isSelected={selectedMatches.has(item.match.id)}
            />
          );
        })}
      </Box>
      
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
          <Text color={theme.textMuted}> {'< >'}</Text> season  
          <Text color={theme.textMuted}> - Enter</Text> expand  
          <Text color={theme.primary}> - Space</Text> select  
          <Text color={theme.textMuted}> - d</Text> dl-one  
          {selectedMatches.size > 0 && (
            <>
              <Text color={theme.success}> - D</Text> dl-all({selectedMatches.size})  
              <Text color={theme.textDim}> - c</Text> clear  
            </>
          )}
          <Text color={theme.textMuted}> - v</Text> check  
          <Text color={theme.textMuted}> - r</Text> refresh  
          <Text color={theme.textMuted}> - Esc</Text> back
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
      
      {/* Folder Prompt Modal */}
      {showFolderPrompt && (
        <FolderPrompt
          teamAbbrev={userTeamAbbr}
          teamName={`DVW-${userTeamAbbr}-${currentSeason.label}`}
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

interface SectionHeaderProps {
  title: string;
  count: number;
  isExpanded: boolean;
  isFocused: boolean;
}

function SectionHeader({ title, count, isExpanded, isFocused }: SectionHeaderProps) {
  const bgColor = isFocused ? theme.backgroundElement : undefined;
  const textColor = isFocused ? theme.primary : theme.text;
  
  return (
    <Box paddingY={0}>
      <Text backgroundColor={bgColor}>
        <Text color={theme.accent}>{isExpanded ? 'v' : '>'}</Text>
        <Text color={textColor} bold> {title}</Text>
        <Text color={theme.textMuted}> ({count} matches)</Text>
        {isFocused && <Text color={theme.textDim}> [Enter to {isExpanded ? 'collapse' : 'expand'}]</Text>}
      </Text>
    </Box>
  );
}

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
  
  // DVW status indicator
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
  
  // Video status indicator
  let videoIndicator: React.ReactNode;
  let videoColor: string;
  
  if (match.videoDownloadRecord) {
    // Video was previously downloaded
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
  
  // Status text for focused item
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
  
  // Format match info
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
