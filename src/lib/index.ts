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
  DVW_GENERATE_URL,
  generateDVWFilename,
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
  type DVWInfo,
  type ContentAvailability,
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
  downloadDVW,
  generateVideoFilename,
  getDownloadDir,
  formatBytes,
  formatSpeed,
  openDownloadDir,
  getDisplayPath,
  generateBulkFolderName,
  sanitizeFolderName,
  type DownloadProgress,
  type DownloadProgressCallback,
  type DownloadResult,
  type DownloadOptions,
} from './download.js';

// Download tracker (persistence)
export {
  markAsDownloaded,
  markDVWAsDownloaded,
  getDownloadRecord,
  isDownloaded,
  isDVWDownloaded,
  isVideoDownloaded,
  getDownloadedMatches,
  getDownloadedDVWs,
  getDownloadedVideos,
  removeDownloadRecord,
  getDownloadedFilepath,
  type DownloadRecord,
  type ContentType,
} from './downloadTracker.js';

// Download context (global download state)
export {
  downloadManager,
  type ActiveDownload,
  type CompletedDownload,
  type DownloadManagerListener,
  type DownloadManagerState,
  type BatchProgress,
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

// Team mapping utilities (conference data from team_mapping.json)
export {
  loadTeamMapping,
  buildConferenceList,
  getTeamById,
  getTeamByName,
  getTeamsByConference,
  getTeamsByConferenceName,
  getConferences,
  getConferenceById,
  getConferenceByName,
  getTeamConference,
  isTeamInConference,
  searchTeamsWithConference,
  getConferenceDisplayName,
  clearTeamMappingCache,
  type MappedTeam,
  type Conference,
} from './teamMapping.js';

// Content checker utilities
export {
  checkAllContentAvailability,
  checkScoresheetAvailability,
  generateScoresheetFilename,
  createUnknownContentStatus,
  createCheckingContentStatus,
  availabilityToStatus,
  getStatusChar,
  getStatusColor,
  type ContentTypeKey,
  type ScoresheetInfo,
  type UnifiedContentAvailability,
  type ContentCheckStatus,
} from './contentChecker.js';

// Bulk downloader utilities
export {
  bulkDownload,
  createDownloadDirectories,
  getSelectedContentTypes,
  countTotalDownloads,
  formatBulkSummary,
  type BulkContentType,
  type BulkDownloadItem,
  type BulkDownloadOptions,
  type BulkDownloadProgress,
  type BulkDownloadResult,
  type BulkDownloadSummary,
  type BulkProgressCallback,
} from './bulkDownloader.js';
