import { Prisma } from "@/lib/generated/prisma/client";

import type { Actor } from "./types";

/**
 * Every grant issuance, activation (and refusal), scope evaluation, revocation,
 * and supersession writes an AuditLog row. The log is append-only and uses
 * (actorType, actorId)/(entityType, entityId) rather than FKs, so it survives
 * deletion of the rows it describes.
 */
export const AuditAction = {
  GRANT_ISSUED: "GRANT_ISSUED",
  GRANT_ACTIVATED: "GRANT_ACTIVATED",
  GRANT_ACTIVATION_REFUSED: "GRANT_ACTIVATION_REFUSED",
  GRANT_REVOKED: "GRANT_REVOKED",
  GRANT_REVOKE_NOOP: "GRANT_REVOKE_NOOP",
  GRANT_SUPERSEDED: "GRANT_SUPERSEDED",
  SCOPE_EVALUATED: "SCOPE_EVALUATED",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditInput {
  actor: Actor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * Write one audit row. Accepts either the base client or a transaction client
 * (PrismaClient is assignable to Prisma.TransactionClient) so callers can keep
 * the audit write inside the same transaction as the mutation it records.
 */
export async function writeAudit(
  client: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      // DbNull → SQL NULL in the nullable Json column (not a JSON `null`).
      before: input.before ?? Prisma.DbNull,
      after: input.after ?? Prisma.DbNull,
    },
  });
}
