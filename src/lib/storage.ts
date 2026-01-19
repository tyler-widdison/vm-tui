/**
 * Persistent storage for auth tokens and settings
 * Stores data in ~/.vm-tui/
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { HudlAuthData } from './auth.js';
import { isTokenExpired, extractUserFromToken } from './auth.js';

// Config directory
const CONFIG_DIR = path.join(os.homedir(), '.vm-tui');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

export interface StoredAuth {
  access_token: string;
  activeAccountId: number;
  auth0_token?: string;
  savedAt: string;
  expiresAt?: string;
}

export interface StoredUser {
  userId: number;
  name: string;
  email: string;
  teamId: number;
  role: string;
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Save authentication data to disk
 */
export async function saveAuthData(authData: HudlAuthData): Promise<void> {
  await ensureConfigDir();

  const storedAuth: StoredAuth = {
    access_token: authData.access_token,
    activeAccountId: authData.activeAccountId,
    auth0_token: authData.auth0_token,
    savedAt: new Date().toISOString(),
  };

  await fs.writeFile(AUTH_FILE, JSON.stringify(storedAuth, null, 2), 'utf-8');
}

/**
 * Load authentication data from disk
 * Returns null if not found or expired
 */
export async function loadAuthData(): Promise<HudlAuthData | null> {
  try {
    const content = await fs.readFile(AUTH_FILE, 'utf-8');
    const storedAuth: StoredAuth = JSON.parse(content);

    if (!storedAuth.access_token) {
      return null;
    }

    // Check if token is expired
    if (isTokenExpired(storedAuth.access_token)) {
      // Token expired, delete the file
      await clearAuthData();
      return null;
    }

    return {
      access_token: storedAuth.access_token,
      activeAccountId: storedAuth.activeAccountId,
      auth0_token: storedAuth.auth0_token,
    };
  } catch (error) {
    // File doesn't exist or is invalid
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    // Invalid JSON or other error - clear the file
    await clearAuthData();
    return null;
  }
}

/**
 * Clear stored authentication data
 */
export async function clearAuthData(): Promise<void> {
  try {
    await fs.unlink(AUTH_FILE);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Check if valid auth data exists (without loading full data)
 */
export async function hasValidAuth(): Promise<boolean> {
  const authData = await loadAuthData();
  return authData !== null;
}

/**
 * Get stored user info from token
 */
export async function getStoredUser(): Promise<StoredUser | null> {
  const authData = await loadAuthData();
  if (!authData) return null;

  return extractUserFromToken(authData.access_token);
}

/**
 * Get config directory path (for display purposes)
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get auth file path (for display purposes)
 */
export function getAuthFilePath(): string {
  return AUTH_FILE;
}
