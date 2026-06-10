// VEIL enforcement core — service layer. Default-deny throughout. License-only:
// nothing in this layer references or enables generation; it governs WHO may use
// a licensed likeness, for WHAT, WHERE, WHEN, and records every decision.

export {
  issueGrant,
  activateGrant,
  revokeGrant,
  supersedeGrant,
} from "./grants";
export { evaluateScope } from "./evaluate";

export { AuditAction } from "./audit";
export {
  findExclusivityConflicts,
  territoriesIntersect,
  useTypesIntersect,
  windowsOverlap,
} from "./conflicts";

export {
  ActivationConflictError,
  EnforcementError,
  IllegalStateError,
  InputError,
  NotFoundError,
  ValidationError,
} from "./errors";

export { WORLDWIDE } from "./types";
export type {
  Actor,
  ActorType,
  DenyReason,
  IssueGrantInput,
  ScopeCheck,
  ScopeDecision,
} from "./types";
