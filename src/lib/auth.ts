/**
 * Hudl Authentication via Browser
 * Opens a Puppeteer browser for user to login, extracts JWT from localStorage
 */

import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// URLs
const PORTAL_URL = 'https://portal.volleymetrics.hudl.com/';
const LOGIN_HOST = 'identity.hudl.com';

// Dashboard URL patterns to check (user lands here after login)
const DASHBOARD_PATTERNS = [
  '#/portal/dashboard',
  '/portal/dashboard',
  '#/dashboard',
];

// Timeout for user to complete login (3 minutes)
const LOGIN_TIMEOUT = 180_000;

// Debug directory for screenshots
const DEBUG_DIR = path.join(os.homedir(), '.vm-tui', 'debug');

export interface HudlAuthData {
  access_token: string;
  activeAccountId: number;
  auth0_token?: string;
}

export interface AuthResult {
  success: boolean;
  data?: HudlAuthData;
  error?: string;
}

/**
 * Status callback for UI updates
 */
export type AuthStatusCallback = (status: 'opening' | 'detecting' | 'waiting' | 'extracting' | 'closing') => void;

/**
 * Logger for auth flow debugging
 */
function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1]?.slice(0, 12) || '';
  if (data !== undefined) {
    console.log(`[Auth ${timestamp}] ${message}`, data);
  } else {
    console.log(`[Auth ${timestamp}] ${message}`);
  }
}

/**
 * Check if URL is a dashboard URL (user is authenticated)
 */
function isDashboardUrl(url: string): boolean {
  return DASHBOARD_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * Check if URL is a login page
 */
function isLoginUrl(url: string): boolean {
  return url.includes(LOGIN_HOST);
}

/**
 * Save debug screenshot
 */
async function saveDebugScreenshot(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  name: string
): Promise<string | null> {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const filepath = path.join(DEBUG_DIR, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    log(`Screenshot saved: ${filepath}`);
    return filepath;
  } catch (err) {
    log('Failed to save screenshot:', err);
    return null;
  }
}

/**
 * Check if user has valid auth token in localStorage
 */
async function hasValidToken(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>): Promise<boolean> {
  const vmPortalUser = await page.evaluate(() => {
    return localStorage.getItem('vmPortalUser');
  });
  
  if (!vmPortalUser) return false;
  
  try {
    const data = JSON.parse(vmPortalUser);
    return !!data.access_token;
  } catch {
    return false;
  }
}

/**
 * Wait for authentication state to be determined
 * Returns: 'authenticated' | 'login_required' | 'dashboard_loaded'
 */
async function waitForAuthState(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  timeout: number
): Promise<'authenticated' | 'login_required' | 'dashboard_loaded'> {
  const startTime = Date.now();
  const pollInterval = 500;
  
  while (Date.now() - startTime < timeout) {
    const currentUrl = page.url();
    log('Checking auth state, current URL:', currentUrl);
    
    // Check if we're on the login page
    if (isLoginUrl(currentUrl)) {
      log('Detected login page');
      return 'login_required';
    }
    
    // Check if we're on the dashboard
    if (isDashboardUrl(currentUrl)) {
      // Check if we have a valid token in localStorage
      const hasToken = await hasValidToken(page);
      if (hasToken) {
        log('Dashboard with valid token detected');
        return 'authenticated';
      }
      log('Dashboard URL but no token yet');
      return 'dashboard_loaded';
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  // Timeout reached - check final state
  const finalUrl = page.url();
  log('Auth state timeout reached, final URL:', finalUrl);
  
  if (isLoginUrl(finalUrl)) {
    return 'login_required';
  }
  
  if (isDashboardUrl(finalUrl)) {
    const hasToken = await hasValidToken(page);
    return hasToken ? 'authenticated' : 'dashboard_loaded';
  }
  
  // Default to login_required if we can't determine state
  return 'login_required';
}

/**
 * Opens browser for Hudl login and extracts auth token from localStorage
 */
export async function authenticateWithHudl(
  onStatus?: AuthStatusCallback
): Promise<AuthResult> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    log('Starting authentication flow...');
    
    // Status: Opening browser
    onStatus?.('opening');

    log('Launching browser...');
    
    // Launch visible browser with anti-detection measures
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
      ],
    });

    log('Browser launched successfully');

    // Use existing default page instead of creating a new one (fixes two-tabs issue)
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0]! : await browser.newPage();
    
    log('Using browser page');
    
    // Anti-detection: Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Anti-detection: Remove webdriver flag
    await page.evaluateOnNewDocument(() => {
      // @ts-ignore - Puppeteer's global types
      (globalThis as any).Object.defineProperty((globalThis as any).navigator, 'webdriver', {
        get: () => false,
      });
    });

    log('Page configured with anti-detection measures');

    // Navigate to Hudl portal
    log(`Navigating to ${PORTAL_URL}...`);
    
    await page.goto(PORTAL_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    log('Initial navigation complete');
    log('Current URL:', page.url());

    // Status: Detecting auth state
    onStatus?.('detecting');
    log('Waiting for authentication state to resolve (up to 30 seconds)...');

    // Wait for auth state to be determined (checks localStorage + URL)
    const authState = await waitForAuthState(page, 30000);
    log('Auth state detected:', authState);

    // Handle auth state result
    if (authState === 'authenticated') {
      // Already has valid token - skip waiting, go straight to dashboard
      log('Found existing valid session - skipping login wait');
      
    } else if (authState === 'login_required') {
      // On login page - wait for user to complete login
      log('Login page detected - waiting for user to complete login...');
      log('Please login in the browser window.');
      
      // Status: Waiting for user to login
      onStatus?.('waiting');
      
      // Save screenshot of login page for debugging
      await saveDebugScreenshot(page, 'login-page');
      
      // Wait for login to complete (token to appear)
      log('Waiting for login completion (timeout: 3 minutes)...');
      
      try {
        await page.waitForFunction(
          () => {
            const vmPortalUser = localStorage.getItem('vmPortalUser');
            if (!vmPortalUser) return false;
            
            try {
              const data = JSON.parse(vmPortalUser);
              return !!data.access_token;
            } catch {
              return false;
            }
          },
          { 
            timeout: LOGIN_TIMEOUT,
            polling: 1000,
          }
        );
        
        log('Login successful - token found');
        
      } catch (waitError) {
        log('Wait for login failed:', waitError);
        await saveDebugScreenshot(page, 'login-timeout');
        throw new Error('Login timed out or navigation failed. Please try again.');
      }
      
    } else if (authState === 'dashboard_loaded') {
      // Dashboard loaded but no token yet
      log('Dashboard URL loaded but no token yet - waiting...');
      onStatus?.('waiting');
      
      // Wait for localStorage to populate with token
      try {
        log('Waiting for localStorage to populate with token (timeout: 15 seconds)...');
        
        await page.waitForFunction(
          () => {
            const vmPortalUser = localStorage.getItem('vmPortalUser');
            return vmPortalUser !== null;
          },
          { 
            timeout: 15000,
            polling: 500,
          }
        );
        
        log('Token found in localStorage');
        
      } catch (waitError) {
        log('Token wait failed:', waitError);
        await saveDebugScreenshot(page, 'no-token-after-login');
        throw new Error('Login completed but token not found. Please try again.');
      }
      
    } else {
      // Shouldn't reach here but handle it
      log('Unexpected auth state detected');
      throw new Error('Could not determine authentication state. Please try again.');
    }

    // Wait a small delay for everything to settle
    log('Final check - waiting for stable state...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get final URL for logging
    const finalUrl = page.url();
    log('Final URL:', finalUrl);

    // Wait for localStorage to be populated
    log('Waiting for localStorage to populate...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Status: Extracting token
    onStatus?.('extracting');
    log('Extracting authentication data from localStorage...');

    // Extract token from localStorage
    const vmPortalUser = await page.evaluate(() => {
      return localStorage.getItem('vmPortalUser');
    });

    if (!vmPortalUser) {
      log('localStorage vmPortalUser is null');
      await saveDebugScreenshot(page, 'no-localstorage');
      
      // Try to get all localStorage keys for debugging
      const allKeys = await page.evaluate(() => {
        return Object.keys(localStorage);
      });
      log('Available localStorage keys:', allKeys);
      
      throw new Error('Authentication data not found in localStorage. Please ensure you completed the login process.');
    }

    log('Found vmPortalUser in localStorage');

    // Parse auth data
    let authData: HudlAuthData;
    try {
      authData = JSON.parse(vmPortalUser);
      log('Parsed auth data successfully');
      log('Active account ID:', authData.activeAccountId);
    } catch (parseError) {
      log('Failed to parse vmPortalUser:', parseError);
      throw new Error('Failed to parse authentication data');
    }

    if (!authData.access_token) {
      log('No access_token in auth data');
      throw new Error('Access token not found in authentication data');
    }

    log('Access token extracted successfully');
    log('Token length:', authData.access_token.length);

    // Status: Closing browser
    onStatus?.('closing');
    log('Closing browser...');

    // Close browser
    await browser.close();
    browser = null;

    log('Authentication completed successfully!');

    return {
      success: true,
      data: authData,
    };
  } catch (error) {
    log('Authentication error:', error);
    
    // Try to save error screenshot
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0 && pages[0]) {
          await saveDebugScreenshot(pages[0], 'error-final');
        }
      } catch {
        // Ignore screenshot errors
      }
      
      // Clean up browser
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }

    // Handle specific error types
    if (error instanceof Error) {
      log('Error message:', error.message);
      
      if (error.message.includes('Navigation timeout')) {
        return {
          success: false,
          error: 'Could not load Hudl portal. Please check your internet connection.',
        };
      }
      if (error.message.includes('timeout') || error.message.includes('timed out')) {
        return {
          success: false,
          error: 'Login timed out. Please try again and complete the login process within 3 minutes.',
        };
      }
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: 'An unknown error occurred during authentication',
    };
  }
}

/**
 * Decode JWT token to extract user info (without verification)
 */
export function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    if (!payload) return null;

    // Base64 decode (handle URL-safe base64)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Check if JWT token is expired
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJWT(token);
  if (!payload || typeof payload.exp !== 'number') {
    return true; // Assume expired if we can't decode
  }

  // exp is in seconds, Date.now() is in milliseconds
  const expiryDate = new Date(payload.exp * 1000);
  const now = new Date();

  // Add 5-minute buffer before actual expiry
  const bufferMs = 5 * 60 * 1000;
  return now.getTime() > (expiryDate.getTime() - bufferMs);
}

/**
 * Extract user identity from JWT token
 */
export function extractUserFromToken(token: string): {
  userId: number;
  name: string;
  email: string;
  teamId: number;
  role: string;
} | null {
  const payload = decodeJWT(token);
  if (!payload) return null;

  const identity = payload.identity as {
    userId?: number;
    name?: string;
    email?: string;
    activeAccount?: {
      teamId?: number;
      role?: string;
    };
  } | undefined;

  if (!identity) return null;

  return {
    userId: identity.userId ?? 0,
    name: identity.name ?? 'Unknown',
    email: identity.email ?? '',
    teamId: identity.activeAccount?.teamId ?? 0,
    role: identity.activeAccount?.role ?? 'USER',
  };
}
