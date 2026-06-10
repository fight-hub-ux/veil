import {
  Exclusivity,
  GrantStatus,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { Grant, UseType } from "@/lib/generated/prisma/client";

import { WORLDWIDE } from "./types";

export function territoriesIntersect(a: string[], b: string[]): boolean {
  if (a.includes(WORLDWIDE) || b.includes(WORLDWIDE)) return true;
  return a.some((code) => b.includes(code));
}

export function useTypesIntersect(a: UseType[], b: UseType[]): boolean {
  return a.some((u) => b.includes(u));
}

/** Half-open intervals [start, end) overlap iff aStart < bEnd && bStart < aEnd. */
export function windowsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Find ACTIVE grants whose activation would conflict with `grant` on
 * exclusivity. Exclusivity tiers are symmetric and (in v1) EXCLUSIVE and SOLE
 * behave identically here: two overlapping grants conflict unless BOTH are
 * NON_EXCLUSIVE. The SOLE-vs-EXCLUSIVE difference is the holder's reserved
 * self-use, which has no representation in the current schema and so is recorded
 * as intent, not enforced as a distinct rule yet.
 *
 * "Overlap" = same person, intersecting useTypes, intersecting territory
 * (WORLDWIDE-aware), and overlapping [startsAt, endsAt). Superseded grants and
 * the grant itself are excluded — a replacement legitimately overlaps the grant
 * it supersedes.
 */
export async function findExclusivityConflicts(
  client: Prisma.TransactionClient,
  grant: Grant,
): Promise<string[]> {
  const candidates = await client.grant.findMany({
    where: {
      personId: grant.personId,
      status: GrantStatus.ACTIVE,
      id: { not: grant.id },
      // Cheap pre-filter in SQL; territory + exclusivity refined below.
      useTypes: { hasSome: grant.useTypes },
      startsAt: { lt: grant.endsAt },
      endsAt: { gt: grant.startsAt },
    },
    include: { supersededBy: { select: { id: true } } },
  });

  return candidates
    .filter(
      (c) =>
        c.supersededBy === null &&
        territoriesIntersect(grant.territory, c.territory) &&
        (grant.exclusivity !== Exclusivity.NON_EXCLUSIVE ||
          c.exclusivity !== Exclusivity.NON_EXCLUSIVE),
    )
    .map((c) => c.id);
}
