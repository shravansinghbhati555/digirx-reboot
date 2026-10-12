/**
 * Public surface of the frontend offline layer. Screens and `api.ts` import
 * from here; nothing outside this folder should reach into its internals.
 *
 * Mirrors `backend/src/modules/offline/` — see the README in either folder
 * for the boundary, and `docs/offline-first-implementation-plan.md` for the
 * phasing.
 */
export {
  CONNECTIVITY_CHANGED_EVENT,
  OfflineError,
  isNetworkFailure,
  isOfflineError,
  isOnline,
  markOffline,
  markOnline,
  subscribeConnectivity,
} from './connectivity';

export {
  OFFLINE_GRACE_MS,
  OFFLINE_WARN_MS,
  OfflineSessionExpiredError,
  evaluateOfflineSession,
  isOfflineSessionExpiredError,
  type OfflineSession,
  type OfflineSessionStatus,
} from './session';

export {
  markPermissionsVerified,
  markSessionVerified,
  readOfflineSession,
  resetSessionStampThrottle,
} from './session-store';

export {
  forgetDevice,
  getDevice,
  getDeviceId,
  setDeviceLabel,
  type DeviceIdentity,
} from './device';

export {
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PinError,
  changePin,
  hasPin,
  idleLockMs,
  isLocked,
  lock,
  lockHard,
  msUntilIdleLock,
  recoverWithCode,
  setPin,
  touchActivity,
  validatePin,
  verifyPin,
  type RecoveryResult,
  type VerifyResult,
} from './pin';

export {
  VAULT_CHANGED_EVENT,
  VaultLockedError,
  hasVault,
  isVaultLockedError,
  isVaultOpen,
  normalizeRecoveryCode,
} from './vault';

export {
  canResetDevice,
  hasPendingRecoveryUpload,
  recoverDevice,
  resetDevice,
  setupDevicePin,
  uploadPendingRecovery,
} from './device-lock';

export { isObjectId, newObjectId, objectIdTimestamp } from './ids';

export {
  clearAllRecords,
  getMeta,
  isStorageAvailable,
  listRecords,
  openDb,
  setMeta,
  type CachedRecord,
} from './db';

export {
  counts as queueCounts,
  discard as discardQueued,
  enqueue,
  listAll as listQueue,
  listFailed,
  listPending,
  pruneDone,
  retryFailed,
  type QueueEntry,
  type QueueCounts,
  type QueueStatus,
} from './queue';

export {
  REPLAY_PROGRESS_EVENT,
  classifyResponse,
  isDraining,
  lastAppliedSeq,
  replayQueue,
  type ReplayOutcome,
} from './replay';

export {
  WORKING_SET,
  lastSyncedAt,
  matchCacheable,
  syncWorkingSet,
  type SyncReport,
  type WorkingSetEntry,
} from './working-set';

export { registerServiceWorker, startOfflineSync } from './bootstrap';

export { describeAge, useOfflineStatus, type OfflineStatus } from './useOfflineStatus';

export {
  OFFLINE_COUNTERS,
  drawNumber,
  ensureAllLeases,
  ensureLease,
  getLease,
  leaseHealth,
  remaining as leaseRemaining,
  renderNumber,
  reportLeaseUsage,
  type LeaseCounterName,
  type LeaseHealth,
  type StoredLease,
} from './leases';
