import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { theme, borderStyle, app } from '../theme.js';
import { ContentBrowser } from './ContentBrowser.js';
import { OtherMatchesPage } from './OtherMatchesPage.js';
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

type DashboardView = 'overview' | 'my-videos' | 'other-videos';

// Global status bar showing downloads and notifications
function GlobalStatusBar({ state }: { state: DownloadManagerState }) {
  const activeDownloads = Array.from(state.activeDownloads.values());
  const hasActiveDownloads = activeDownloads.length > 0;
  const hasNotifications = state.notifications.length > 0;
  
  if (!hasActiveDownloads && !hasNotifications) {
    return null;
  }
  
  return (
    <Box flexDirection="column" marginTop={1}>
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
}

type MenuItem = 'team-matches' | 'other-matches' | 'dvw' | 'scoresheets';
const MENU_ITEMS: MenuItem[] = ['team-matches', 'other-matches', 'dvw', 'scoresheets'];
const ENABLED_ITEMS: MenuItem[] = ['team-matches', 'other-matches'];

export function DashboardPage({ authData, userInfo, onLogout }: DashboardPageProps) {
  const { exit } = useApp();
  const [view, setView] = useState<DashboardView>('overview');
  const [selectedItem, setSelectedItem] = useState<MenuItem>('team-matches');
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
    
    // Hotkeys still work
    if (input === 'v') {
      setView('my-videos');
    }
    if (input === 'o') {
      setView('other-videos');
    }
    
    // Arrow key navigation
    if (key.upArrow || input === 'k') {
      const idx = MENU_ITEMS.indexOf(selectedItem);
      if (idx > 0) {
        setSelectedItem(MENU_ITEMS[idx - 1]!);
      }
    }
    if (key.downArrow || input === 'j') {
      const idx = MENU_ITEMS.indexOf(selectedItem);
      if (idx < MENU_ITEMS.length - 1) {
        setSelectedItem(MENU_ITEMS[idx + 1]!);
      }
    }
    
    // Enter to select
    if (key.return) {
      if (selectedItem === 'team-matches') {
        setView('my-videos');
      } else if (selectedItem === 'other-matches') {
        setView('other-videos');
      }
      // dvw and scoresheets are disabled
    }
  });

  const activeTeam = userInfo.teams.find(
    t => t.id === (authData.activeAccountId ? undefined : t.id)
  ) || userInfo.teams[0];

  // Render my videos browser view
  if (view === 'my-videos') {
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
          
          {/* Content browser */}
          <ContentBrowser
            authData={authData}
            onBack={() => setView('overview')}
          />
        </Box>
        
        {/* Global status bar */}
        <GlobalStatusBar state={downloadState} />
      </Box>
    );
  }

  // Render other videos browser view
  if (view === 'other-videos') {
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
          
          {/* Other matches browser */}
          <OtherMatchesPage
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
            <Text color={theme.primary} bold>{app.name}</Text>
            <Text color={theme.textDim}> - </Text>
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
          <Text color={theme.text} bold>Navigation</Text>
          <Text color={theme.textDim}>Use arrows or hotkeys, Enter to select</Text>
          <Box marginTop={1}>
            <Text 
              backgroundColor={selectedItem === 'team-matches' ? theme.backgroundElement : undefined}
              color={selectedItem === 'team-matches' ? theme.primary : theme.text}
            >
              {selectedItem === 'team-matches' ? '>' : ' '}
              <Text color={theme.primary}>[v]</Text> {activeTeam?.name || 'My'} Matches
            </Text>
          </Box>
          <Box>
            <Text 
              backgroundColor={selectedItem === 'other-matches' ? theme.backgroundElement : undefined}
              color={selectedItem === 'other-matches' ? theme.primary : theme.text}
            >
              {selectedItem === 'other-matches' ? '>' : ' '}
              <Text color={theme.primary}>[o]</Text> Other Matches
            </Text>
          </Box>
          <Box>
            <Text 
              backgroundColor={selectedItem === 'dvw' ? theme.backgroundElement : undefined}
              color={theme.textDim}
            >
              {selectedItem === 'dvw' ? '>' : ' '}
              <Text color={theme.textDim}>[d]</Text> DVW Files (coming soon)
            </Text>
          </Box>
          <Box>
            <Text 
              backgroundColor={selectedItem === 'scoresheets' ? theme.backgroundElement : undefined}
              color={theme.textDim}
            >
              {selectedItem === 'scoresheets' ? '>' : ' '}
              <Text color={theme.textDim}>[s]</Text> Scoresheets (coming soon)
            </Text>
          </Box>
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
            <Text color={theme.textMuted}>'v'</Text> team matches  
            <Text color={theme.textMuted}> 'o'</Text> other matches  
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
