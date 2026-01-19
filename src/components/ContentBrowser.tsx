/**
 * ContentBrowser - Video content browser with monthly grouping
 * Displays matches organized by month with collapsible sections
 * Supports video downloads with progress tracking
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { theme, borderStyle } from '../theme.js';
import {
  HudlAPI,
  getCurrentSeasonRange,
  groupMatchesByMonth,
  getSortedMonthKeys,
  formatMatchDate,
  formatMatchTime,
  downloadManager,
  formatBytes,
  generateVideoFilename,
  getDownloadedMatches,
  type HudlAuthData,
  type MatchEvent,
  type VideoInfo,
  type DownloadProgress,
  type DownloadRecord,
} from '../lib/index.js';

// ============================================
// Types
// ============================================

interface ContentBrowserProps {
  authData: HudlAuthData;
  onBack: () => void;
}

type VideoStatus = 'unknown' | 'checking' | 'available' | 'unavailable';
type DownloadStatus = 'none' | 'downloading' | 'completed' | 'error' | 'previously_downloaded';

interface MatchWithVideo extends MatchEvent {
  videoStatus: VideoStatus;
  videoInfo?: VideoInfo;
  downloadStatus: DownloadStatus;
  downloadProgress?: DownloadProgress;
  downloadRecord?: DownloadRecord; // For previously downloaded files
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

export function ContentBrowser({ authData, onBack }: ContentBrowserProps) {
  // Season options
  const seasonOptions = useMemo(() => getSeasonOptions(), []);
  
  // State
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState(0); // 0 = current season
  const [matches, setMatches] = useState<MatchWithVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [videoCache] = useState<Map<number, VideoInfo>>(new Map());
  const [notification, setNotification] = useState<string | null>(null);
  const [downloadedCache, setDownloadedCache] = useState<Map<number, DownloadRecord>>(new Map());
  
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
    const items: Array<{ type: 'section'; key: string } | { type: 'match'; match: MatchWithVideo; monthKey: string }> = [];
    
    for (const monthKey of monthKeys) {
      items.push({ type: 'section', key: monthKey });
      
      if (expandedSections.has(monthKey)) {
        const monthMatches = groupedMatches.get(monthKey) || [];
        for (const match of monthMatches) {
          items.push({ type: 'match', match: match as MatchWithVideo, monthKey });
        }
      }
    }
    
    return items;
  }, [monthKeys, expandedSections, groupedMatches]);
  
  // Load matches when season changes
  useEffect(() => {
    loadMatches();
  }, [selectedSeasonIndex]);
  
  // Load downloaded matches on mount and update match status
  useEffect(() => {
    async function loadDownloadedStatus() {
      try {
        const downloaded = await getDownloadedMatches();
        setDownloadedCache(downloaded);
        
        // Update matches with previously downloaded status
        if (downloaded.size > 0) {
          setMatches(prev => prev.map(m => {
            const record = downloaded.get(m.id);
            if (record) {
              return {
                ...m,
                downloadStatus: 'previously_downloaded' as DownloadStatus,
                downloadRecord: record,
              };
            }
            return m;
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
    if (matches.length > 0 && downloadedCache.size > 0) {
      // Check if any matches need their download status updated
      const needsUpdate = matches.some(m => 
        downloadedCache.has(m.id) && m.downloadStatus === 'none'
      );
      
      if (needsUpdate) {
        setMatches(prev => prev.map(m => {
          const record = downloadedCache.get(m.id);
          if (record && m.downloadStatus === 'none') {
            return {
              ...m,
              downloadStatus: 'previously_downloaded' as DownloadStatus,
              downloadRecord: record,
            };
          }
          return m;
        }));
      }
    }
  }, [matches.length, downloadedCache]);
  
  // Auto-expand first section with matches
  useEffect(() => {
    if (monthKeys.length > 0 && expandedSections.size === 0) {
      setExpandedSections(new Set([monthKeys[0]!]));
    }
  }, [monthKeys]);
  
  // Lazy load video info for visible matches
  useEffect(() => {
    if (flatList.length === 0) return;
    
    // Check videos for matches near the focused item
    const PREFETCH_RANGE = 5;
    const startIdx = Math.max(0, focusedIndex - PREFETCH_RANGE);
    const endIdx = Math.min(flatList.length - 1, focusedIndex + PREFETCH_RANGE);
    
    for (let i = startIdx; i <= endIdx; i++) {
      const item = flatList[i];
      if (item?.type === 'match' && item.match.videoStatus === 'unknown') {
        // Inline the check logic here to avoid dependency issues
        const match = item.match;
        if (videoCache.has(match.id)) {
          const cached = videoCache.get(match.id)!;
          setMatches(prev => prev.map(m => 
            m.id === match.id 
              ? { ...m, videoStatus: cached.available ? 'available' : 'unavailable', videoInfo: cached }
              : m
          ));
        } else {
          // Mark as checking and fetch
          setMatches(prev => prev.map(m => 
            m.id === match.id ? { ...m, videoStatus: 'checking' as VideoStatus } : m
          ));
          
          api.findVideoUrl(match).then(videoInfo => {
            videoCache.set(match.id, videoInfo);
            setMatches(prev => prev.map(m => 
              m.id === match.id 
                ? { ...m, videoStatus: videoInfo.available ? 'available' : 'unavailable', videoInfo }
                : m
            ));
          }).catch(() => {
            setMatches(prev => prev.map(m => 
              m.id === match.id ? { ...m, videoStatus: 'unavailable' as VideoStatus } : m
            ));
          });
        }
      }
    }
  }, [focusedIndex, flatList, api, videoCache]);
  
  // Load matches from API
  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMatches([]); // Clear existing matches
    setExpandedSections(new Set()); // Reset expanded sections
    setFocusedIndex(0); // Reset focus
    
    try {
      const dateRange = getSeasonDateRange(currentSeason.startYear);
      const response = await api.getMatches({
        ...dateRange,
        matchType: 'match',
        size: 50,
      });
      
      // Convert to MatchWithVideo with unknown video status
      const matchesWithVideo: MatchWithVideo[] = response.content.map(match => ({
        ...match,
        videoStatus: 'unknown' as VideoStatus,
        downloadStatus: 'none' as DownloadStatus,
      }));
      
      setMatches(matchesWithVideo);
      
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
            videoStatus: 'unknown' as VideoStatus,
            downloadStatus: 'none' as DownloadStatus,
          })),
        ]);
      } catch (err) {
        console.error(`Failed to load page ${page}:`, err);
      }
    }
  }, [api]);
  
  // Check video availability for a match
  const checkVideoForMatch = useCallback(async (match: MatchWithVideo, forceRecheck: boolean = false) => {
    // Skip if already checking (unless force recheck)
    if (!forceRecheck && match.videoStatus === 'checking') return;
    
    // Skip if already checked (unless force recheck)
    if (!forceRecheck && match.videoStatus !== 'unknown') return;
    
    // Use cache if available and not forcing recheck
    if (!forceRecheck && videoCache.has(match.id)) {
      const cached = videoCache.get(match.id)!;
      setMatches(prev => prev.map(m => 
        m.id === match.id 
          ? { ...m, videoStatus: cached.available ? 'available' : 'unavailable', videoInfo: cached }
          : m
      ));
      return;
    }
    
    // Mark as checking
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
  
  // Download video for a match using global download manager
  const downloadMatchVideo = useCallback(async (match: MatchWithVideo) => {
    // Skip if video not available or already downloading
    if (match.videoStatus !== 'available' || !match.videoInfo) {
      return;
    }
    if (match.downloadStatus === 'downloading' || downloadManager.isDownloading(match.id)) {
      return;
    }
    
    // Mark as downloading locally (will be updated by manager)
    setMatches(prev => prev.map(m => 
      m.id === match.id ? { ...m, downloadStatus: 'downloading' as DownloadStatus } : m
    ));
    
    // Use global download manager
    const result = await downloadManager.startDownload(match, match.videoInfo);
    
    if (result.success && result.filepath) {
      // Update local state
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
    if (key.upArrow || input === 'k') {
      setFocusedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setFocusedIndex(prev => Math.min(flatList.length - 1, prev + 1));
    }
    
    // Expand/collapse section or trigger action
    if (key.return) {
      const item = flatList[focusedIndex];
      if (item?.type === 'section') {
        toggleSection(item.key);
      }
    }
    
    // Download video
    if (input === 'd') {
      const item = flatList[focusedIndex];
      if (item?.type === 'match') {
        downloadMatchVideo(item.match);
      }
    }
    
    // Manual video check
    if (input === 'v') {
      const item = flatList[focusedIndex];
      if (item?.type === 'match') {
        // Clear cache and force recheck
        videoCache.delete(item.match.id);
        checkVideoForMatch(item.match, true);
      }
    }
    
    // Refresh
    if (input === 'r') {
      loadMatches();
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
          <Text color={theme.primary} bold>Videos</Text>
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
            <MatchItem
              key={`match-${item.match.id}-${index}`}
              match={item.match}
              isFocused={isFocused}
            />
          );
        })}
      </Box>
      
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
          <Text color={theme.textMuted}>j/k</Text> navigate  
          <Text color={theme.textMuted}> {'<>'}</Text> season  
          <Text color={theme.textMuted}> Enter</Text> expand  
          <Text color={theme.success}> d</Text> download  
          <Text color={theme.textMuted}> v</Text> check  
          <Text color={theme.textMuted}> r</Text> refresh  
          <Text color={theme.textMuted}> Esc</Text> back
        </Text>
      </Box>
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
  const arrow = isExpanded ? '>' : '>';
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

interface MatchItemProps {
  match: MatchWithVideo;
  isFocused: boolean;
}

function MatchItem({ match, isFocused }: MatchItemProps) {
  const bgColor = isFocused ? theme.backgroundElement : undefined;
  
  // Video/download status indicator
  let statusIndicator: React.ReactNode;
  let statusColor: string;
  let statusText: string | null = null;
  
  // Download status takes precedence over video status
  if (match.downloadStatus === 'downloading') {
    statusIndicator = <Spinner type="dots" />;
    statusColor = theme.warning;
    if (match.downloadProgress) {
      const { percent, bytesDownloaded, totalBytes } = match.downloadProgress;
      if (totalBytes > 0) {
        statusText = ` ${percent}% (${formatBytes(bytesDownloaded)}/${formatBytes(totalBytes)})`;
      } else {
        statusText = ` ${formatBytes(bytesDownloaded)}`;
      }
    }
  } else if (match.downloadStatus === 'completed') {
    // Just downloaded this session - green D
    statusIndicator = 'D';
    statusColor = theme.success;
    statusText = ' Downloaded';
  } else if (match.downloadStatus === 'previously_downloaded') {
    // Previously downloaded (persisted) - blue D
    statusIndicator = 'D';
    statusColor = theme.primary; // Blue!
    if (isFocused && match.downloadRecord) {
      statusText = ` ${match.downloadRecord.filename}`;
    }
  } else if (match.downloadStatus === 'error') {
    statusIndicator = '!';
    statusColor = theme.error;
    statusText = match.downloadProgress?.error ? ` ${match.downloadProgress.error}` : ' Error';
  } else {
    // Show video status
    switch (match.videoStatus) {
      case 'available':
        statusIndicator = 'V';
        statusColor = theme.success;
        if (isFocused) statusText = ' [d to download]';
        break;
      case 'unavailable':
        statusIndicator = 'X';
        statusColor = theme.error;
        break;
      case 'checking':
        statusIndicator = <Spinner type="dots" />;
        statusColor = theme.warning;
        break;
      default:
        statusIndicator = '?';
        statusColor = theme.textDim;
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
        <Text color={statusColor}>[{statusIndicator}]</Text>
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
