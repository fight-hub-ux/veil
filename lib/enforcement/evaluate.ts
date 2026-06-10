import {
  GrantStatus,
  LicenseeVerificationStatus,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { UseType } from "@/lib/generated/prisma/client";

import { prisma } from "@/lib/db";

import { AuditAction, writeAudit } from "./audit";
import { InputError } from "./errors";
import { WORLDWIDE } from "./types";
import type { DenyReason, ScopeCheck, ScopeDecision } from "./types";

/** The fields of a Grant the evaluator reads, plus superseded-ness. */
interface EvalGrant {
  id: string;
  status: GrantStatus;
  supersededBy: { id: string } | null;
  startsAt: Date;
  endsAt: Date;
  useTypes: UseType[];
  territory: string[];
  licenseeId: string | null;
  hardExclusions: Prisma.JsonValue;
}

const GRANT_SELECTION = {
  include: { supersededBy: { select: { id: true } } },
} as const;

type LicenseeLite = { id: string; status: LicenseeVerificationStatus } | null;

/**
 * Evaluate a single grant against the check, returning ALL failed conditions.
 * Order is fixed and every condition is checked (no short-circuit) so a DENY
 * enumerates the complete set of failures.
 */
async function evaluateGrant(
  tx: Prisma.TransactionClient,
  g: EvalGrant,
  check: ScopeCheck,
  licensee: LicenseeLite,
): Promise<DenyReason[]> {
  const reasons: DenyReason[] = [];

  if (g.status === GrantStatus.REVOKED) reasons.push("GRANT_REVOKED");
  else if (g.status !== GrantStatus.ACTIVE) reasons.push("GRANT_NOT_ACTIVE");

  if (g.supersededBy) reasons.push("SUPERSEDED");

  const at = check.at.getTime();
  if (!(g.startsAt.getTime() <= at && at < g.endsAt.getTime()))
    reasons.push("OUTSIDE_WINDOW");

  if (!g.useTypes.includes(check.useType))
    reasons.push("USE_TYPE_NOT_PERMITTED");

  if (
    !(g.territory.includes(WORLDWIDE) || g.territory.includes(check.territory))
  )
    reasons.push("TERRITORY_NOT_PERMITTED");

  if (g.licenseeId !== null) {
    // Targeted grant: the asking licensee must be the targeted one.
    if (check.licenseeId !== g.licenseeId) reasons.push("LICENSEE_MISMATCH");
  } else {
    // Open standing offer: any licensee may use it, but must be VERIFIED.
    if (!licensee) reasons.push("LICENSEE_NOT_FOUND");
    else if (licensee.status !== LicenseeVerificationStatus.VERIFIED)
      reasons.push("LICENSEE_NOT_VERIFIED");
  }

  if (check.likenessAssetId) {
    const link = await tx.grantAsset.findUnique({
      where: {
        grantId_assetId: { grantId: g.id, assetId: check.likenessAssetId },
      },
      select: { grantId: true },
    });
    if (!link) reasons.push("ASSET_NOT_LINKED");
  }

  return reasons;
}

async function finalize(
  tx: Prisma.TransactionClient,
  check: ScopeCheck,
  decision: ScopeDecision,
): Promise<ScopeDecision> {
  await writeAudit(tx, {
    actor: { type: "Licensee", id: check.licenseeId },
    action: AuditAction.SCOPE_EVALUATED,
    entityType: decision.grantId ? "Grant" : "LikenessAsset",
    entityId:
      decision.grantId ??
      check.likenessAssetId ??
      check.grantId ??
      "unknown",
    before: null,
    after: {
      allowed: decision.allowed,
      grantId: decision.grantId ?? null,
      reasons: decision.reasons,
      useType: check.useType,
      territory: check.territory,
      at: check.at.toISOString(),
      licenseeId: check.licenseeId,
    } as Prisma.InputJsonValue,
  });
  return decision;
}

/**
 * The core of default-deny. Resolves the candidate grant(s) — a specific grant
 * (grantId) or every grant linked to an asset (likenessAssetId) — evaluates each
 * against the requested use, and returns a decision that is never a bare
 * boolean: ALLOW cites the authorizing grant; DENY enumerates the failed
 * conditions. hardExclusions, when a grant is in context, is surfaced verbatim;
 * the v1 evaluator does not interpret its Json. An AuditLog row is written on
 * every evaluation — ALLOW and DENY alike.
 */
export async function evaluateScope(check: ScopeCheck): Promise<ScopeDecision> {
  if (!check.grantId && !check.likenessAssetId) {
    throw new InputError(
      "evaluateScope requires either grantId or likenessAssetId",
    );
  }

  return prisma.$transaction(async (tx) => {
    const licensee: LicenseeLite = await tx.licensee.findUnique({
      where: { id: check.licenseeId },
      select: { id: true, status: true },
    });

    let candidates: EvalGrant[];

    if (check.grantId) {
      const g = await tx.grant.findUnique({
        where: { id: check.grantId },
        ...GRANT_SELECTION,
      });
      if (!g) {
        return finalize(tx, check, {
          allowed: false,
          grantId: check.grantId,
          reasons: ["GRANT_NOT_FOUND"],
        });
      }
      candidates = [g];
    } else {
      const asset = await tx.likenessAsset.findUnique({
        where: { id: check.likenessAssetId! },
        select: { id: true },
      });
      if (!asset) {
        return finalize(tx, check, { allowed: false, reasons: ["ASSET_NOT_FOUND"] });
      }
      const links = await tx.grantAsset.findMany({
        where: { assetId: check.likenessAssetId! },
        select: { grantId: true },
      });
      if (links.length === 0) {
        return finalize(tx, check, {
          allowed: false,
          reasons: ["NO_GRANT_FOR_ASSET"],
        });
      }
      candidates = await tx.grant.findMany({
        where: { id: { in: links.map((l) => l.grantId) } },
        ...GRANT_SELECTION,
      });
    }

    // Evaluate sequentially — an interactive transaction multiplexes one
    // connection, so concurrent queries on `tx` are unsafe.
    const evaluated: { g: EvalGrant; reasons: DenyReason[] }[] = [];
    for (const g of candidates) {
      evaluated.push({ g, reasons: await evaluateGrant(tx, g, check, licensee) });
    }

    const allow = evaluated.find((e) => e.reasons.length === 0);
    if (allow) {
      return finalize(tx, check, {
        allowed: true,
        grantId: allow.g.id,
        reasons: [],
        hardExclusions: allow.g.hardExclusions,
      });
    }

    // No grant allowed. Cite the closest (fewest failures) as the representative
    // DENY so the caller gets the most actionable reason set.
    const best = [...evaluated].sort(
      (a, b) => a.reasons.length - b.reasons.length,
    )[0];
    return finalize(tx, check, {
      allowed: false,
      grantId: best.g.id,
      reasons: best.reasons,
      hardExclusions: best.g.hardExclusions,
    });
  });
}
