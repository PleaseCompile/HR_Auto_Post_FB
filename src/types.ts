export type Slot = "morning" | "midday" | "evening";
export type DraftStatus = "draft" | "ready" | "archived";
export type RunMode = "assisted" | "dry-run";
export type RunWorkflow = "sequential" | "hybrid-tabs" | "hybrid-windows";

export type TargetStatus =
  | "queued"
  | "opening"
  | "preparing"
  | "awaiting_confirmation"
  | "submitting"
  | "published"
  | "pending_review"
  | "dry_run_ready"
  | "manual_action_required"
  | "failed"
  | "skipped";

export interface DraftRecord {
  id: string;
  workDate: string;
  slot: Slot;
  text: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  media: MediaRecord[];
}

export interface MediaRecord {
  id: string;
  draftId: string;
  fileName: string;
  storedPath: string;
  mimeType: string;
  position: number;
}

export interface GroupRecord {
  id: string;
  name: string;
  url: string;
  province: string;
  tags: string[];
  canPost: "yes" | "no" | "unknown";
  requiresApproval: boolean;
  note: string;
  active: boolean;
  lastPostedAt: string | null;
  source: "manual" | "csv" | "automatic_scan";
  externalId: string | null;
  scannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupScanState {
  id: string | null;
  status: "idle" | "running" | "stopping" | "completed" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  foundCount: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  scrollCount: number;
  message: string;
  snapshotPath: string | null;
  error: string | null;
}

export interface RunRecord {
  id: string;
  draftId: string;
  mode: RunMode;
  workflow: RunWorkflow;
  tabLimit: number;
  autoConfirm: boolean;
  status:
    | "queued"
    | "running"
    | "awaiting_confirmation"
    | "paused"
    | "completed"
    | "stopped"
    | "failed"
    | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  draft?: DraftRecord;
  targets?: RunTargetRecord[];
}

export interface RunTargetRecord {
  id: string;
  runId: string;
  groupId: string;
  position: number;
  status: TargetStatus;
  message: string;
  evidencePath: string | null;
  permalink: string | null;
  updatedAt: string;
  group?: GroupRecord;
}

export interface ManualEvidenceRecord {
  id: string;
  targetId: string;
  fileName: string;
  storedPath: string;
  mimeType: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStatus {
  browserOpen: boolean;
  authenticated: boolean;
  url: string | null;
  accountIdMasked: string | null;
  pageCount?: number;
  profileLocked?: boolean;
  ownerPid?: number | null;
  crashCount?: number;
  pageErrorCount?: number;
  lastError?: string | null;
  lastEventAt?: string | null;
}

export type PendingCleanupScope = "known-pending" | "posted" | "all" | "custom";
export type PendingDeleteMode = "all" | "older-than";

export type PendingCleanupStatus =
  | "idle"
  | "scanning"
  | "stopping-scan"
  | "scanned"
  | "deleting"
  | "stopping-delete"
  | "completed"
  | "failed";

export type PendingCleanupGroupStatus =
  | "queued"
  | "scanning"
  | "scanned"
  | "deleting"
  | "done"
  | "failed"
  | "skipped";

export type PendingPostStatus = "found" | "deleted" | "failed" | "skipped";

export interface PendingPostRecord {
  id: string;
  cleanupGroupId: string;
  position: number;
  snippet: string;
  rawDate: string;
  postedAt: string | null;
  ageDays: number | null;
  status: PendingPostStatus;
  evidencePath: string | null;
  message: string;
}

export interface PendingCleanupGroupRecord {
  id: string;
  cleanupId: string;
  groupId: string;
  externalId: string;
  groupName: string;
  groupUrl: string;
  pendingCount: number;
  status: PendingCleanupGroupStatus;
  selected: boolean;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
  message: string;
  scannedAt: string | null;
  posts?: PendingPostRecord[];
}

export interface PendingCleanupState {
  id: string | null;
  status: PendingCleanupStatus;
  scope: PendingCleanupScope;
  deleteMode: PendingDeleteMode;
  olderThanDays: number;
  startedAt: string | null;
  scanFinishedAt: string | null;
  finishedAt: string | null;
  groupsTotal: number;
  groupsScanned: number;
  groupsWithPending: number;
  pendingFound: number;
  deleteGroupsTotal: number;
  deleteGroupsDone: number;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
  message: string;
  snapshotPath: string | null;
  error: string | null;
  groups?: PendingCleanupGroupRecord[];
}
