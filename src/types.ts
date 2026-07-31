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
}
