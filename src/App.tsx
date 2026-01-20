import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { FullScreen } from './components/FullScreen.js';
import { LandingPage } from './components/LandingPage.js';
import { AuthenticatingPage } from './components/AuthenticatingPage.tsx';
import { ErrorPage } from './components/ErrorPage.js';
import { DashboardPage } from './components/DashboardPage.js';
import { theme } from './theme.js';
import {
  authenticateWithHudl,
  loadAuthData,
  saveAuthData,
  testAPIConnection,
  isTokenExpired,
  extractUserFromToken,
  type HudlAuthData,
} from './lib/index.js';
import type { Screen } from './types.js';

interface UserInfo {
  name: string;
  email: string;
  teams: { id: number; name: string }[];
}

export function App() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [authStatus, setAuthStatus] = useState<'opening' | 'detecting' | 'waiting' | 'extracting' | 'closing'>('opening');
  const [errorInfo, setErrorInfo] = useState({ title: '', message: '' });
  const [authData, setAuthData] = useState<HudlAuthData | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check for existing auth on startup
  useEffect(() => {
    async function checkExistingAuth() {
      try {
        const existingAuth = await loadAuthData();
        if (existingAuth) {
          // Quick local check: is the token expired?
          if (isTokenExpired(existingAuth.access_token)) {
            // Token expired, need to re-login
            setIsCheckingAuth(false);
            return;
          }
          
          // Try to extract user info from JWT first (instant, no network)
          const jwtUser = extractUserFromToken(existingAuth.access_token);
          if (jwtUser) {
            // We have valid token and can extract user info locally
            // Set auth data immediately for fast startup
            setAuthData(existingAuth);
            setUserInfo({
              name: jwtUser.name,
              email: jwtUser.email,
              teams: [{ id: jwtUser.teamId, name: 'Loading...' }], // Placeholder
            });
            setScreen('dashboard');
            setIsCheckingAuth(false);
            
            // Fetch full team info in background (non-blocking)
            testAPIConnection(existingAuth).then(testResult => {
              if (testResult.success && testResult.user && testResult.teams) {
                setUserInfo({
                  name: testResult.user.name,
                  email: testResult.user.email,
                  teams: testResult.teams,
                });
              }
            }).catch(() => {
              // Ignore background fetch errors - we're already logged in
            });
            return;
          }
          
          // Fallback: JWT extraction failed, do full API check
          const testResult = await testAPIConnection(existingAuth);
          if (testResult.success && testResult.user && testResult.teams) {
            setAuthData(existingAuth);
            setUserInfo({
              name: testResult.user.name,
              email: testResult.user.email,
              teams: testResult.teams,
            });
            setScreen('dashboard');
          }
        }
      } catch {
        // Ignore errors, just show login
      } finally {
        setIsCheckingAuth(false);
      }
    }
    checkExistingAuth();
  }, []);

  // Handle login initiation
  const handleLogin = useCallback(async () => {
    setScreen('authenticating');
    setAuthStatus('opening');

    try {
      // Authenticate using Puppeteer browser
      const result = await authenticateWithHudl((status) => {
        setAuthStatus(status);
      });

      if (!result.success || !result.data) {
        setErrorInfo({
          title: 'Authentication Failed',
          message: result.error || 'Could not authenticate with Hudl',
        });
        setScreen('error');
        return;
      }

      // Save auth data for future sessions
      await saveAuthData(result.data);
      setAuthData(result.data);

      // Test API connection and get user info
      const testResult = await testAPIConnection(result.data);
      if (testResult.success && testResult.user && testResult.teams) {
        setUserInfo({
          name: testResult.user.name,
          email: testResult.user.email,
          teams: testResult.teams,
        });
        setScreen('dashboard');
      } else {
        setErrorInfo({
          title: 'Connection Error',
          message: testResult.error || 'Could not connect to Hudl API',
        });
        setScreen('error');
      }
    } catch (err) {
      setErrorInfo({
        title: 'Authentication Failed',
        message: err instanceof Error ? err.message : 'An unknown error occurred',
      });
      setScreen('error');
    }
  }, []);

  // Handle auth cancellation
  const handleCancelAuth = useCallback(() => {
    setScreen('landing');
  }, []);

  // Handle retry
  const handleRetry = useCallback(() => {
    handleLogin();
  }, [handleLogin]);

  // Handle back from error
  const handleBack = useCallback(() => {
    setScreen('landing');
  }, []);

  // Handle logout
  const handleLogout = useCallback(async () => {
    setAuthData(null);
    setUserInfo(null);
    setScreen('landing');
  }, []);

  // Show loading screen while checking auth
  if (isCheckingAuth) {
    return (
      <FullScreen>
        <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
          <Text color={theme.primary}>
            <Spinner type="dots" />
            <Text> Loading...</Text>
          </Text>
        </Box>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      {screen === 'landing' && (
        <LandingPage onLogin={handleLogin} />
      )}
      
      {screen === 'authenticating' && (
        <AuthenticatingPage 
          status={authStatus}
          onCancel={handleCancelAuth}
        />
      )}
      
      {screen === 'error' && (
        <ErrorPage
          title={errorInfo.title}
          message={errorInfo.message}
          onRetry={handleRetry}
          onBack={handleBack}
        />
      )}
      
      {screen === 'dashboard' && authData && userInfo && (
        <DashboardPage
          authData={authData}
          userInfo={userInfo}
          onLogout={handleLogout}
        />
      )}
    </FullScreen>
  );
}
