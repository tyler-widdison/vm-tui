// Auth
export {
  authenticateWithHudl,
  decodeJWT,
  isTokenExpired,
  extractUserFromToken,
  type HudlAuthData,
  type AuthResult,
  type AuthStatusCallback,
} from './auth.js';

// Storage
export {
  saveAuthData,
  loadAuthData,
  clearAuthData,
  hasValidAuth,
  getStoredUser,
  getConfigDir,
  getAuthFilePath,
  type StoredAuth,
  type StoredUser,
} from './storage.js';

// API
export {
  HudlAPI,
  APIError,
  testAPIConnection,
  VIDEO_CDN_BASE_URL,
  type AccountsResponse,
  type Account,
  type Team,
  type Video,
  type Schedule,
  type DVWFile,
  // Match/Event types
  type MatchEvent,
  type MatchesResponse,
  type GetMatchesParams,
  type VideoInfo,
  type MatchAnalysis,
  type TeamInfo,
  type ConferenceInfo,
  type VenueInfo,
  type PageableInfo,
  // Team directory
  type LeagueTeam,
} from './api.js';

// Date utilities
export {
  getCurrentSeasonRange,
  getLastMonthsRange,
  formatDateForAPI,
  parseMatchDate,
  formatMatchDate,
  formatMatchTime,
  getMonthKey,
  groupMatchesByMonth,
  getSortedMonthKeys,
  isFutureMatch,
  isToday,
  getRelativeTime,
  type DateRange,
} from './dateUtils.js';

// Download utilities
export {
  downloadVideo,
  generateVideoFilename,
  getDownloadDir,
  formatBytes,
  formatSpeed,
  type DownloadProgress,
  type DownloadProgressCallback,
  type DownloadResult,
} from './download.js';

// Download tracker (persistence)
export {
  markAsDownloaded,
  getDownloadRecord,
  isDownloaded,
  getDownloadedMatches,
  removeDownloadRecord,
  getDownloadedFilepath,
  type DownloadRecord,
} from './downloadTracker.js';

// Download context (global download state)
export {
  downloadManager,
  type ActiveDownload,
  type CompletedDownload,
  type DownloadManagerListener,
  type DownloadManagerState,
} from './downloadContext.js';

// Utilities
export { throttle, debounce } from './throttle.js';

// Conference utilities
export {
  discoverConferences,
  updateConferenceMappingsFromMatches,
  getConferenceMappings,
  getConferenceName,
  getConferenceNameSync,
  formatConferenceDisplay,
  formatConferenceWithId,
  setConferenceName,
  getConferenceTeams,
  getAllConferenceIds,
  type ConferenceMapping,
} from './conferenceUtils.js';

// Team search utilities
export {
  searchTeams,
  formatTeamDisplay,
  formatTeamCompact,
  getCachedTeams,
  setCachedTeams,
  clearTeamCache,
  type TeamSearchResult,
} from './teamSearch.js';
