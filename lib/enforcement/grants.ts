import {
  Exclusivity,
  GrantStatus,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { Grant } from "@/lib/generated/prisma/client";

import { prisma } from "@/lib/db";

import { AuditAction, writeAudit } from "./audit";
import { findExclusivityConflicts } from "./conflicts";
import {
  ActivationConflictError,
  IllegalStateError,
  NotFoundError,
  ValidationError,
} from "./errors";
import type { Actor, IssueGrantInput } from "./types";

// ── helpers ──────────────────────────────────────────────────────────────────

interface NormalizedInput extends IssueGrantInput {
  assetIds: string[];
}

function normalize(input: IssueGrantInput): NormalizedInput {
  return { ...input, assetIds: [...new Set(input.assetIds ?? [])] };
}

/** Coherence checks — default-deny means an under-specified grant is illegal. */
function validateScope(input: NormalizedInput): string[] {
  const problems: string[] = [];
  if (input.assetIds.length === 0)
    problems.push("assetIds must contain at least one asset");
  if (!input.useTypes || input.useTypes.length === 0)
    problems.push("useTypes must be non-empty");
  if (!input.territory || input.territory.length === 0)
    problems.push("territory must be non-empty");
  const startOk =
    input.startsAt instanceof Date && !Number.isNaN(input.startsAt.getTime());
  const endOk =
    input.endsAt instanceof Date && !Number.isNaN(input.endsAt.getTime());
  if (!startOk) problems.push("startsAt must be a valid date");
  if (!endOk) problems.push("endsAt must be a valid date");
  if (startOk && endOk && input.endsAt.getTime() <= input.startsAt.getTime())
    problems.push("endsAt must be strictly after startsAt");
  if (typeof input.priceMicros !== "bigint" || input.priceMicros < 0n)
    problems.push("priceMicros must be a non-negative bigint");
  return problems;
}

/** Verify referenced rows exist and assets belong to the person. */
async function assertEntities(
  tx: Prisma.TransactionClient,
  input: NormalizedInput,
): Promise<void> {
  const person = await tx.person.findUnique({
    where: { id: input.personId },
    select: { id: true },
  });
  if (!person) throw new NotFoundError(`Person ${input.personId} not found`);

  const assets = await tx.likenessAsset.findMany({
    where: { id: { in: input.assetIds } },
    select: { id: true, personId: true },
  });
  if (assets.length !== input.assetIds.length) {
    const found = new Set(assets.map((a) => a.id));
    const missing = input.assetIds.filter((id) => !found.has(id));
    throw new NotFoundError(`LikenessAsset(s) not found: ${missing.join(", ")}`);
  }
  const foreign = assets
    .filter((a) => a.personId !== input.personId)
    .map((a) => a.id);
  if (foreign.length > 0) {
    throw new ValidationError([
      `asset(s) do not belong to person ${input.personId}: ${foreign.join(", ")}`,
    ]);
  }

  if (input.licenseeId) {
    const licensee = await tx.licensee.findUnique({
      where: { id: input.licenseeId },
      select: { id: true },
    });
    if (!licensee)
      throw new NotFoundError(`Licensee ${input.licenseeId} not found`);
  }
}

async function createGrantTx(
  tx: Prisma.TransactionClient,
  input: NormalizedInput,
  supersedesId?: string,
): Promise<Grant> {
  return tx.grant.create({
    data: {
      person: { connect: { id: input.personId } },
      useTypes: input.useTypes,
      territory: input.territory,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      priceMicros: input.priceMicros,
      currency: input.currency,
      exclusivity: input.exclusivity ?? Exclusivity.NON_EXCLUSIVE,
      licensee: input.licenseeId
        ? { connect: { id: input.licenseeId } }
        : undefined,
      hardExclusions: input.hardExclusions ?? {},
      status: GrantStatus.DRAFT,
      supersedes: supersedesId ? { connect: { id: supersedesId } } : undefined,
      assets: {
        create: input.assetIds.map((assetId) => ({
          asset: { connect: { id: assetId } },
        })),
      },
    },
  });
}

/** Plain, JSON-safe snapshot for the audit trail (no bigint / Date instances). */
function snapshot(g: Grant): Prisma.InputJsonValue {
  return {
    id: g.id,
    personId: g.personId,
    useTypes: g.useTypes,
    territory: g.territory,
    startsAt: g.startsAt.toISOString(),
    endsAt: g.endsAt.toISOString(),
    priceMicros: g.priceMicros.toString(),
    currency: g.currency,
    exclusivity: g.exclusivity,
    licenseeId: g.licenseeId,
    hardExclusions: g.hardExclusions as Prisma.InputJsonValue,
    status: g.status,
    revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
    revokedReason: g.revokedReason,
    supersedesId: g.supersedesId,
  } satisfies Record<string, unknown> as Prisma.InputJsonValue;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Issue a grant. Validates that every scope field is present and coherent, then
 * creates the grant as DRAFT — activation is a separate, explicit call so the
 * exclusivity conflict check runs at a well-defined point. Writes GRANT_ISSUED.
 */
export async function issueGrant(input: IssueGrantInput): Promise<Grant> {
  const normalized = normalize(input);
  const problems = validateScope(normalized);
  if (problems.length > 0) throw new ValidationError(problems);

  return prisma.$transaction(async (tx) => {
    await assertEntities(tx, normalized);
    const grant = await createGrantTx(tx, normalized);
    await writeAudit(tx, {
      actor: input.actor,
      action: AuditAction.GRANT_ISSUED,
      entityType: "Grant",
      entityId: grant.id,
      before: null,
      after: snapshot(grant),
    });
    return grant;
  });
}

/**
 * Activate a DRAFT grant. Runs the exclusivity conflict check and refuses (with
 * the conflicting grant ids, and a GRANT_ACTIVATION_REFUSED audit row) if
 * activating it would violate exclusivity. Already-ACTIVE is a no-op.
 */
export async function activateGrant(
  grantId: string,
  actor: Actor,
): Promise<Grant> {
  const grant = await prisma.grant.findUnique({
    where: { id: grantId },
    include: { supersededBy: { select: { id: true } } },
  });
  if (!grant) throw new NotFoundError(`Grant ${grantId} not found`);
  if (grant.status === GrantStatus.ACTIVE) return grant;
  if (grant.status !== GrantStatus.DRAFT) {
    throw new IllegalStateError(
      `Grant ${grantId} cannot be activated from status ${grant.status}`,
    );
  }
  if (grant.supersededBy) {
    throw new IllegalStateError(
      `Grant ${grantId} is superseded and cannot be activated`,
    );
  }

  const conflicts = await findExclusivityConflicts(prisma, grant);
  if (conflicts.length > 0) {
    // Recorded outside the (aborted) activation so the refusal survives.
    await writeAudit(prisma, {
      actor,
      action: AuditAction.GRANT_ACTIVATION_REFUSED,
      entityType: "Grant",
      entityId: grantId,
      before: snapshot(grant),
      after: { conflictingGrantIds: conflicts } as Prisma.InputJsonValue,
    });
    throw new ActivationConflictError(conflicts);
  }

  return prisma.$transaction(async (tx) => {
    const activated = await tx.grant.update({
      where: { id: grantId },
      data: { status: GrantStatus.ACTIVE },
    });
    await writeAudit(tx, {
      actor,
      action: AuditAction.GRANT_ACTIVATED,
      entityType: "Grant",
      entityId: grantId,
      before: snapshot(grant),
      after: snapshot(activated),
    });
    return activated;
  });
}

/**
 * Revoke a grant. Idempotent: revoking an already-REVOKED grant is a no-op with
 * a distinct GRANT_REVOKE_NOOP audit entry — not an error.
 */
export async function revokeGrant(
  grantId: string,
  reason: string,
  actor: Actor,
): Promise<Grant> {
  const grant = await prisma.grant.findUnique({ where: { id: grantId } });
  if (!grant) throw new NotFoundError(`Grant ${grantId} not found`);

  if (grant.status === GrantStatus.REVOKED) {
    await writeAudit(prisma, {
      actor,
      action: AuditAction.GRANT_REVOKE_NOOP,
      entityType: "Grant",
      entityId: grantId,
      before: snapshot(grant),
      after: snapshot(grant),
    });
    return grant;
  }

  return prisma.$transaction(async (tx) => {
    const revoked = await tx.grant.update({
      where: { id: grantId },
      data: {
        status: GrantStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
    await writeAudit(tx, {
      actor,
      action: AuditAction.GRANT_REVOKED,
      entityType: "Grant",
      entityId: grantId,
      before: snapshot(grant),
      after: snapshot(revoked),
    });
    return revoked;
  });
}

/**
 * Supersede a grant with a replacement. Issues the replacement (DRAFT, activated
 * separately) and links it via supersedesId. The old grant row is NOT mutated —
 * supersession is expressed by the pointer, and the old grant's evaluations now
 * DENY with reason SUPERSEDED. Writes GRANT_ISSUED (new) and GRANT_SUPERSEDED
 * (old). Throws if the old grant is already superseded.
 */
export async function supersedeGrant(
  oldGrantId: string,
  newGrantInput: IssueGrantInput,
): Promise<{ old: Grant; replacement: Grant }> {
  const normalized = normalize(newGrantInput);
  const problems = validateScope(normalized);
  if (problems.length > 0) throw new ValidationError(problems);

  return prisma.$transaction(async (tx) => {
    const old = await tx.grant.findUnique({
      where: { id: oldGrantId },
      include: { supersededBy: { select: { id: true } } },
    });
    if (!old) throw new NotFoundError(`Grant ${oldGrantId} not found`);
    if (old.supersededBy) {
      throw new IllegalStateError(
        `Grant ${oldGrantId} is already superseded by ${old.supersededBy.id}`,
      );
    }

    await assertEntities(tx, normalized);
    const replacement = await createGrantTx(tx, normalized, oldGrantId);

    await writeAudit(tx, {
      actor: newGrantInput.actor,
      action: AuditAction.GRANT_ISSUED,
      entityType: "Grant",
      entityId: replacement.id,
      before: null,
      after: snapshot(replacement),
    });
    await writeAudit(tx, {
      actor: newGrantInput.actor,
      action: AuditAction.GRANT_SUPERSEDED,
      entityType: "Grant",
      entityId: oldGrantId,
      before: snapshot(old),
      after: { supersededById: replacement.id } as Prisma.InputJsonValue,
    });

    return { old, replacement };
  });
}
