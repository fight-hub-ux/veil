/**
 * Errors thrown by the enforcement core for *operations* (issue, activate,
 * revoke, supersede). Scope *evaluation* never throws for a data-driven denial —
 * it returns a ScopeDecision. These represent caller/state errors that are not
 * scope outcomes.
 */
export class EnforcementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Bad or incoherent input (missing scope fields, endsAt <= startsAt, …). */
export class ValidationError extends EnforcementError {
  constructor(public readonly problems: string[]) {
    super(`Grant validation failed: ${problems.join("; ")}`);
  }
}

/** A referenced entity (grant, person, asset, licensee) does not exist. */
export class NotFoundError extends EnforcementError {}

/** A legal transition was requested from an incompatible state. */
export class IllegalStateError extends EnforcementError {}

/** A malformed evaluateScope call (e.g. neither grantId nor likenessAssetId). */
export class InputError extends EnforcementError {}

/**
 * Activation refused because activating this grant would violate exclusivity —
 * either this grant claims exclusivity over scope already occupied, or an
 * existing EXCLUSIVE/SOLE grant already covers the intersecting scope. Carries
 * the conflicting grant ids.
 */
export class ActivationConflictError extends EnforcementError {
  constructor(public readonly conflictingGrantIds: string[]) {
    super(
      `Activation refused: exclusivity conflict with grant(s) ${conflictingGrantIds.join(
        ", ",
      )}`,
    );
  }
}
