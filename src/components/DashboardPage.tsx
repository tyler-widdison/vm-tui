import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { theme, borderStyle, app } from '../theme.js';
import { UnifiedSearchPage } from './UnifiedSearchPage.js';
import { Logo } from './Logo.js';
import { downloadManager, formatBytes, type DownloadManagerState } from '../lib/index.js';
import type { HudlAuthData } from '../lib/index.js';

interface UserInfo {
  name: string;
  email: string;
  teams: { id: number; name: string }[];
}

interface DashboardPageProps {
  authData: HudlAuthData;
  userInfo: UserInfo;
  onLogout: () => void;
}

type DashboardView = 'overview' | 'unified-search';

// Global status bar showing downloads and notifications
const GlobalStatusBar = React.memo(function GlobalStatusBar({ state }: { state: DownloadManagerState }) {
  const activeDownloads = Array.from(state.activeDownloads.values());
  const hasActiveDownloads = activeDownloads.length > 0;
  const hasNotifications = state.notifications.length > 0;
  const hasBatchProgress = state.batchProgress !== null && state.batchProgress.total > 0;
  
  if (!hasActiveDownloads && !hasNotifications && !hasBatchProgress) {
    return null;
  }
  
  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Batch progress indicator */}
      {hasBatchProgress && (
        <Box paddingX={1}>
          <Text color={theme.primary}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.accent}> Batch: </Text>
          <Text color={theme.text}>{state.batchProgress!.current}/{state.batchProgress!.total}</Text>
          <Text color={theme.textMuted}> items</Text>
        </Box>
      )}
      
      {/* Active downloads */}
      {activeDownloads.map(download => {
        const { progress } = download;
        const teamAbbrs = `${download.match.awayTeam.abbreviation} @ ${download.match.homeTeam.abbreviation}`;
        
        return (
          <Box key={download.matchId} paddingX={1}>
            <Text color={theme.warning}>
              <Spinner type="dots" />
            </Text>
            <Text color={theme.text}> Downloading {teamAbbrs}</Text>
            <Text color={theme.textMuted}>
              {' '}{progress.percent}% ({formatBytes(progress.bytesDownloaded)}
              {progress.totalBytes > 0 && `/${formatBytes(progress.totalBytes)}`})
            </Text>
          </Box>
        );
      })}
      
      {/* Notifications */}
      {state.notifications.map((notification, idx) => (
        <Box key={idx} paddingX={1}>
          <Text color={theme.success}>{notification}</Text>
        </Box>
      ))}
    </Box>
  );
}, (prevProps, nextProps) => {
  const prevState = prevProps.state;
  const nextState = nextProps.state;
  
  const prevDownloads = Array.from(prevState.activeDownloads.values());
  const nextDownloads = Array.from(nextState.activeDownloads.values());
  
  if (prevDownloads.length !== nextDownloads.length) {
    return false;
  }
  
  for (let i = 0; i < prevDownloads.length; i++) {
    const prev = prevDownloads[i];
    const next = nextDownloads[i];
    
    if (!prev || !next) {
      return false;
    }
    
    if (
      prev.matchId !== next.matchId ||
      prev.progress.bytesDownloaded !== next.progress.bytesDownloaded ||
      prev.progress.totalBytes !== next.progress.totalBytes ||
      prev.progress.percent !== next.progress.percent ||
      prev.progress.status !== next.progress.status
    ) {
      return false;
    }
  }
  
  if (prevState.notifications.length !== nextState.notifications.length) {
    return false;
  }
  
  for (let i = 0; i < prevState.notifications.length; i++) {
    if (prevState.notifications[i] !== nextState.notifications[i]) {
      return false;
    }
  }
  
  const prevBatch = prevState.batchProgress;
  const nextBatch = nextState.batchProgress;
  
  if (prevBatch === null && nextBatch === null) {
    return true;
  }
  
  if (prevBatch === null || nextBatch === null) {
    return false;
  }
  
  if (prevBatch.current !== nextBatch.current || prevBatch.total !== nextBatch.total) {
    return false;
  }
  
  return true;
});

export function DashboardPage({ authData, userInfo, onLogout }: DashboardPageProps) {
  const { exit } = useApp();
  const [view, setView] = useState<DashboardView>('overview');
  const [downloadState, setDownloadState] = useState<DownloadManagerState>(() => downloadManager.getState());
  
  // Subscribe to download manager state changes
  useEffect(() => {
    return downloadManager.subscribe(setDownloadState);
  }, []);

  useInput((input, key) => {
    // Only handle input when in overview mode
    if (view !== 'overview') return;
    
    if (input === 'q') {
      exit();
    }
    if (input === 'l') {
      onLogout();
    }
    
    // Search hotkey
    if (input === 's' || key.return) {
      setView('unified-search');
    }
  });

  const activeTeam = userInfo.teams.find(
    t => t.id === (authData.activeAccountId ? undefined : t.id)
  ) || userInfo.teams[0];

  // Render unified search view
  if (view === 'unified-search') {
    return (
      <Box
        flexDirection="column"
        width="100%"
        height="100%"
      >
        <Box
          flexDirection="column"
          borderStyle={borderStyle}
          borderColor={theme.border}
          paddingX={2}
          paddingY={1}
          flexGrow={1}
        >
          {/* Header bar */}
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>{app.name}</Text>
            <Text color={theme.textDim}> - </Text>
            <Text color={theme.text}>{userInfo.name}</Text>
            {activeTeam && (
              <>
                <Text color={theme.textDim}> | </Text>
                <Text color={theme.accent}>{activeTeam.name}</Text>
              </>
            )}
          </Box>
          
          {/* Unified search page */}
          <UnifiedSearchPage
            authData={authData}
            onBack={() => setView('overview')}
          />
        </Box>
        
        {/* Global status bar */}
        <GlobalStatusBar state={downloadState} />
      </Box>
    );
  }

  // Render overview (default) view
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      {/* Logo outside the box */}
      <Box marginBottom={1}>
        <Logo />
      </Box>

      {/* Main container with border */}
      <Box
        flexDirection="column"
        borderStyle={borderStyle}
        borderColor={theme.border}
        paddingX={3}
        paddingY={1}
        minWidth={50}
      >
        {/* Header */}
        <Box
          borderStyle={borderStyle}
          borderColor={theme.borderSubtle}
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          paddingBottom={1}
          marginBottom={1}
        >
          <Box flexGrow={1}>
            <Text color={theme.text}>{userInfo.name}</Text>
          </Box>
        </Box>

        {/* Welcome message */}
        <Box marginBottom={1}>
          <Text color={theme.success}>Authentication successful!</Text>
        </Box>

        {/* User info */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.textMuted}>
            Logged in as: <Text color={theme.text}>{userInfo.email}</Text>
          </Text>
          {activeTeam && (
            <Text color={theme.textMuted}>
              Team: <Text color={theme.accent}>{activeTeam.name}</Text>
            </Text>
          )}
        </Box>

        {/* Teams list */}
        {userInfo.teams.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={theme.textMuted} underline>Your Teams:</Text>
            {userInfo.teams.map((team, index) => (
              <Text key={team.id} color={theme.text}>
                {index + 1}. {team.name}
              </Text>
            ))}
          </Box>
        )}

        {/* Quick actions menu */}
        <Box
          flexDirection="column"
          borderStyle={borderStyle}
          borderColor={theme.borderSubtle}
          paddingBottom={1}
          paddingX={1}
          marginY={1}
        >
          <Text color={theme.text} bold>Quick Actions</Text>
          <Text color={theme.textDim}>Press Enter or 's' to start</Text>
          <Box marginTop={1}>
            <Text color={theme.primary} bold>
              {'>'} <Text color={theme.success}>[s]</Text> Search All Content
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              Search for matches by team and date, then download videos, DVW files, and scoresheets.
              Filter by conference to narrow results.
            </Text>
          </Box>
        </Box>

        {/* Feature highlights */}
        <Box flexDirection="column" marginY={1}>
          <Text color={theme.accent} bold>Features:</Text>
          <Text color={theme.text}>
            <Text color={theme.info}>[1]</Text> Conference filtering (optional)
          </Text>
          <Text color={theme.text}>
            <Text color={theme.info}>[2]</Text> Team search with autocomplete
          </Text>
          <Text color={theme.text}>
            <Text color={theme.info}>[3]</Text> View Video, DVW, Scoresheet availability
          </Text>
          <Text color={theme.text}>
            <Text color={theme.info}>[4]</Text> Bulk download with organized folders
          </Text>
        </Box>

        {/* Footer */}
        <Box
          borderStyle={borderStyle}
          borderColor={theme.borderSubtle}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          paddingTop={1}
          marginTop={1}
        >
          <Text color={theme.textDim}>
            <Text color={theme.success}>'s'/Enter</Text> search  
            <Text color={theme.textMuted}> 'l'</Text> logout  
            <Text color={theme.textMuted}> 'q'</Text> quit
          </Text>
        </Box>
        
        {/* Global status bar */}
        <GlobalStatusBar state={downloadState} />
      </Box>
    </Box>
  );
}
