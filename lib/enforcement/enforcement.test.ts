import { beforeEach, describe, expect, it } from "vitest";

import {
  Currency,
  Exclusivity,
  GrantStatus,
  LicenseeVerificationStatus,
  Modality,
  UseType,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ActivationConflictError,
  IllegalStateError,
  InputError,
  NotFoundError,
  ValidationError,
  activateGrant,
  evaluateScope,
  issueGrant,
  revokeGrant,
  supersedeGrant,
} from "@/lib/enforcement";
import type { Actor, IssueGrantInput } from "@/lib/enforcement";

const SYSTEM: Actor = { type: "System" };

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-10T12:00:00.000Z");
const WINDOW_START = new Date(NOW.getTime() - DAY);
const WINDOW_END = new Date(NOW.getTime() + 30 * DAY);

/** Wipe all enforcement tables; CASCADE handles FK order. */
async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "AuditLog","ProvenanceRecord","LicenseInstance","GrantAsset","Grant","LikenessAsset","IdentityVerification","Person","Licensee","Representative" RESTART IDENTITY CASCADE`,
  );
}

async function makePerson(): Promise<string> {
  const p = await prisma.person.create({
    data: { displayName: "Test Holder", tier: "SELF_SERVE" },
  });
  return p.id;
}

async function makeAsset(personId: string, hash = "hash-A"): Promise<string> {
  const a = await prisma.likenessAsset.create({
    data: { personId, modality: Modality.FACE, referenceHash: hash },
  });
  return a.id;
}

async function makeLicensee(
  status: LicenseeVerificationStatus = LicenseeVerificationStatus.VERIFIED,
): Promise<string> {
  const l = await prisma.licensee.create({
    data: { orgName: "Acme", contactEmail: "ops@acme.test", status },
  });
  return l.id;
}

function grantInput(
  over: Partial<IssueGrantInput> & Pick<IssueGrantInput, "personId" | "assetIds">,
): IssueGrantInput {
  return {
    useTypes: [UseType.ADVERTISING],
    territory: ["GB"],
    startsAt: WINDOW_START,
    endsAt: WINDOW_END,
    priceMicros: 1_000_000n,
    currency: Currency.USD,
    exclusivity: Exclusivity.NON_EXCLUSIVE,
    actor: SYSTEM,
    ...over,
  };
}

/** A fully-passing scenario: active grant + linked asset + verified licensee. */
async function activeScenario(over: Partial<IssueGrantInput> = {}) {
  const personId = await makePerson();
  const assetId = await makeAsset(personId);
  const licenseeId = await makeLicensee();
  const grant = await issueGrant(
    grantInput({
      personId,
      assetIds: [assetId],
      licenseeId,
      ...over,
    }),
  );
  await activateGrant(grant.id, SYSTEM);
  return { personId, assetId, licenseeId, grantId: grant.id };
}

const auditCount = (action: string, entityId?: string) =>
  prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });

beforeEach(resetDb);

describe("issueGrant validation", () => {
  it("rejects empty useTypes", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    await expect(
      issueGrant(grantInput({ personId, assetIds: [assetId], useTypes: [] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty territory", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    await expect(
      issueGrant(grantInput({ personId, assetIds: [assetId], territory: [] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects endsAt <= startsAt", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    await expect(
      issueGrant(
        grantInput({
          personId,
          assetIds: [assetId],
          startsAt: WINDOW_END,
          endsAt: WINDOW_START,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty assetIds", async () => {
    const personId = await makePerson();
    await expect(
      issueGrant(grantInput({ personId, assetIds: [] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an asset that does not belong to the person", async () => {
    const personId = await makePerson();
    const otherPersonId = await makePerson();
    const foreignAsset = await makeAsset(otherPersonId);
    await expect(
      issueGrant(grantInput({ personId, assetIds: [foreignAsset] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates a DRAFT grant and writes GRANT_ISSUED", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    const grant = await issueGrant(grantInput({ personId, assetIds: [assetId] }));
    expect(grant.status).toBe(GrantStatus.DRAFT);
    expect(await auditCount("GRANT_ISSUED", grant.id)).toBe(1);
  });
});

describe("activateGrant", () => {
  it("moves DRAFT to ACTIVE and writes GRANT_ACTIVATED", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    const grant = await issueGrant(grantInput({ personId, assetIds: [assetId] }));
    const active = await activateGrant(grant.id, SYSTEM);
    expect(active.status).toBe(GrantStatus.ACTIVE);
    expect(await auditCount("GRANT_ACTIVATED", grant.id)).toBe(1);
  });

  it("is a no-op when already ACTIVE", async () => {
    const { grantId } = await activeScenario();
    const again = await activateGrant(grantId, SYSTEM);
    expect(again.status).toBe(GrantStatus.ACTIVE);
  });
});

describe("evaluateScope — ALLOW", () => {
  it("allows an in-scope check and cites the grant + surfaces hardExclusions", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario({
      hardExclusions: { noPolitical: true },
    });
    const decision = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.grantId).toBe(grantId);
    expect(decision.reasons).toEqual([]);
    expect(decision.hardExclusions).toEqual({ noPolitical: true });
    expect(await auditCount("SCOPE_EVALUATED", grantId)).toBe(1);
  });

  it("allows when territory is WORLDWIDE", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario({
      territory: ["WORLDWIDE"],
    });
    const decision = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "JP",
      at: NOW,
      licenseeId,
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows an open (null-licensee) grant for a VERIFIED licensee", async () => {
    const { assetId, grantId } = await activeScenario({ licenseeId: null });
    const verified = await makeLicensee(LicenseeVerificationStatus.VERIFIED);
    const decision = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId: verified,
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("evaluateScope — every DENY reason individually", () => {
  it("GRANT_NOT_ACTIVE (DRAFT)", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    const licenseeId = await makeLicensee();
    const grant = await issueGrant(
      grantInput({ personId, assetIds: [assetId], licenseeId }),
    );
    const d = await evaluateScope({
      grantId: grant.id,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons).toEqual(["GRANT_NOT_ACTIVE"]);
  });

  it("GRANT_REVOKED", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario();
    await revokeGrant(grantId, "test", SYSTEM);
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["GRANT_REVOKED"]);
  });

  it("OUTSIDE_WINDOW", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario();
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: new Date(WINDOW_END.getTime() + DAY),
      licenseeId,
    });
    expect(d.reasons).toEqual(["OUTSIDE_WINDOW"]);
  });

  it("USE_TYPE_NOT_PERMITTED", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario();
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.VOICE_SYNTHESIS,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["USE_TYPE_NOT_PERMITTED"]);
  });

  it("TERRITORY_NOT_PERMITTED", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario();
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "FR",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["TERRITORY_NOT_PERMITTED"]);
  });

  it("LICENSEE_MISMATCH (targeted grant, different licensee)", async () => {
    const { grantId, assetId } = await activeScenario();
    const otherLicensee = await makeLicensee();
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId: otherLicensee,
    });
    expect(d.reasons).toEqual(["LICENSEE_MISMATCH"]);
  });

  it("LICENSEE_NOT_VERIFIED (open grant, unverified licensee)", async () => {
    const { grantId, assetId } = await activeScenario({ licenseeId: null });
    const unverified = await makeLicensee(LicenseeVerificationStatus.UNVERIFIED);
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId: unverified,
    });
    expect(d.reasons).toEqual(["LICENSEE_NOT_VERIFIED"]);
  });

  it("LICENSEE_NOT_FOUND (open grant, unknown licensee)", async () => {
    const { grantId, assetId } = await activeScenario({ licenseeId: null });
    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId: "does-not-exist",
    });
    expect(d.reasons).toEqual(["LICENSEE_NOT_FOUND"]);
  });

  it("ASSET_NOT_LINKED (asset not attached to the grant)", async () => {
    const { grantId, personId, licenseeId } = await activeScenario();
    const otherAsset = await makeAsset(personId, "hash-B");
    const d = await evaluateScope({
      grantId,
      likenessAssetId: otherAsset,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["ASSET_NOT_LINKED"]);
  });

  it("GRANT_NOT_FOUND", async () => {
    const licenseeId = await makeLicensee();
    const d = await evaluateScope({
      grantId: "nonexistent",
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["GRANT_NOT_FOUND"]);
  });

  it("ASSET_NOT_FOUND (asset path, unknown asset)", async () => {
    const licenseeId = await makeLicensee();
    const d = await evaluateScope({
      likenessAssetId: "nonexistent",
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["ASSET_NOT_FOUND"]);
  });

  it("NO_GRANT_FOR_ASSET (asset exists, no grants)", async () => {
    const personId = await makePerson();
    const assetId = await makeAsset(personId);
    const licenseeId = await makeLicensee();
    const d = await evaluateScope({
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toEqual(["NO_GRANT_FOR_ASSET"]);
  });

  it("writes a SCOPE_EVALUATED audit row on DENY", async () => {
    const { grantId, assetId, licenseeId } = await activeScenario();
    await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.VOICE_SYNTHESIS,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(await auditCount("SCOPE_EVALUATED", grantId)).toBe(1);
  });

  it("throws InputError when neither grantId nor likenessAssetId is given", async () => {
    const licenseeId = await makeLicensee();
    await expect(
      evaluateScope({
        useType: UseType.ADVERTISING,
        territory: "GB",
        at: NOW,
        licenseeId,
      }),
    ).rejects.toBeInstanceOf(InputError);
  });
});

describe("revokeGrant", () => {
  it("sets REVOKED + revokedAt + revokedReason and writes GRANT_REVOKED", async () => {
    const { grantId } = await activeScenario();
    const revoked = await revokeGrant(grantId, "breach of terms", SYSTEM);
    expect(revoked.status).toBe(GrantStatus.REVOKED);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(revoked.revokedReason).toBe("breach of terms");
    expect(await auditCount("GRANT_REVOKED", grantId)).toBe(1);
  });

  it("is idempotent: re-revoking is a no-op with a distinct audit entry", async () => {
    const { grantId } = await activeScenario();
    await revokeGrant(grantId, "first", SYSTEM);
    const second = await revokeGrant(grantId, "second", SYSTEM);
    expect(second.status).toBe(GrantStatus.REVOKED);
    expect(second.revokedReason).toBe("first"); // unchanged
    expect(await auditCount("GRANT_REVOKED", grantId)).toBe(1);
    expect(await auditCount("GRANT_REVOKE_NOOP", grantId)).toBe(1);
  });

  it("throws NotFoundError for an unknown grant", async () => {
    await expect(revokeGrant("nope", "x", SYSTEM)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("supersedeGrant", () => {
  it("links the replacement and the old grant now evaluates as SUPERSEDED", async () => {
    const { grantId, personId, assetId, licenseeId } = await activeScenario();
    const { replacement } = await supersedeGrant(
      grantId,
      grantInput({ personId, assetIds: [assetId], licenseeId }),
    );

    expect(replacement.supersedesId).toBe(grantId);
    expect(replacement.status).toBe(GrantStatus.DRAFT);

    const d = await evaluateScope({
      grantId,
      likenessAssetId: assetId,
      useType: UseType.ADVERTISING,
      territory: "GB",
      at: NOW,
      licenseeId,
    });
    expect(d.reasons).toContain("SUPERSEDED");

    // Old row is not mutated except by the pointer — status remains ACTIVE.
    const old = await prisma.grant.findUniqueOrThrow({ where: { id: grantId } });
    expect(old.status).toBe(GrantStatus.ACTIVE);

    expect(await auditCount("GRANT_SUPERSEDED", grantId)).toBe(1);
    expect(await auditCount("GRANT_ISSUED", replacement.id)).toBe(1);
  });

  it("refuses to supersede an already-superseded grant", async () => {
    const { grantId, personId, assetId, licenseeId } = await activeScenario();
    await supersedeGrant(
      grantId,
      grantInput({ personId, assetIds: [assetId], licenseeId }),
    );
    await expect(
      supersedeGrant(
        grantId,
        grantInput({ personId, assetIds: [assetId], licenseeId }),
      ),
    ).rejects.toBeInstanceOf(IllegalStateError);
  });
});

describe("exclusivity conflict on activation", () => {
  it("refuses an EXCLUSIVE grant overlapping an existing ACTIVE grant", async () => {
    const { personId, assetId, grantId: firstId } = await activeScenario();
    const second = await issueGrant(
      grantInput({
        personId,
        assetIds: [assetId],
        exclusivity: Exclusivity.EXCLUSIVE,
      }),
    );
    let err: unknown;
    try {
      await activateGrant(second.id, SYSTEM);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ActivationConflictError);
    expect((err as ActivationConflictError).conflictingGrantIds).toContain(
      firstId,
    );

    const stillDraft = await prisma.grant.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(stillDraft.status).toBe(GrantStatus.DRAFT);
    expect(await auditCount("GRANT_ACTIVATION_REFUSED", second.id)).toBe(1);
  });

  it("symmetric: refuses a NON_EXCLUSIVE grant overlapping an existing EXCLUSIVE grant", async () => {
    const { personId, assetId, grantId: exclusiveId } = await activeScenario({
      exclusivity: Exclusivity.EXCLUSIVE,
    });
    const second = await issueGrant(
      grantInput({
        personId,
        assetIds: [assetId],
        exclusivity: Exclusivity.NON_EXCLUSIVE,
      }),
    );
    await expect(activateGrant(second.id, SYSTEM)).rejects.toBeInstanceOf(
      ActivationConflictError,
    );
  });

  it("SOLE behaves like EXCLUSIVE for conflict detection", async () => {
    const { personId, assetId } = await activeScenario();
    const sole = await issueGrant(
      grantInput({
        personId,
        assetIds: [assetId],
        exclusivity: Exclusivity.SOLE,
      }),
    );
    await expect(activateGrant(sole.id, SYSTEM)).rejects.toBeInstanceOf(
      ActivationConflictError,
    );
  });

  it("allows two overlapping NON_EXCLUSIVE grants", async () => {
    const { personId, assetId } = await activeScenario();
    const second = await issueGrant(
      grantInput({
        personId,
        assetIds: [assetId],
        exclusivity: Exclusivity.NON_EXCLUSIVE,
      }),
    );
    const activated = await activateGrant(second.id, SYSTEM);
    expect(activated.status).toBe(GrantStatus.ACTIVE);
  });

  it("does not conflict when useTypes are disjoint", async () => {
    const { personId, assetId } = await activeScenario({
      useTypes: [UseType.ADVERTISING],
      exclusivity: Exclusivity.EXCLUSIVE,
    });
    const voice = await issueGrant(
      grantInput({
        personId,
        assetIds: [assetId],
        useTypes: [UseType.VOICE_SYNTHESIS],
        exclusivity: Exclusivity.EXCLUSIVE,
      }),
    );
    const activated = await activateGrant(voice.id, SYSTEM);
    expect(activated.status).toBe(GrantStatus.ACTIVE);
  });

  it("does not conflict when windows are disjoint", async () => {
    const { personId, assetId } = await activeScenario({
      exclusivity: Exclusivity.EXCLUSIVE,
    });
    const future = await issueGrant(
      grantInput({
        personId,
        assetIds: [assetId],
        exclusivity: Exclusivity.EXCLUSIVE,
        startsAt: new Date(WINDOW_END.getTime() + DAY),
        endsAt: new Date(WINDOW_END.getTime() + 60 * DAY),
      }),
    );
    const activated = await activateGrant(future.id, SYSTEM);
    expect(activated.status).toBe(GrantStatus.ACTIVE);
  });

  it("a replacement may activate over the grant it supersedes", async () => {
    const { grantId, personId, assetId, licenseeId } = await activeScenario({
      exclusivity: Exclusivity.EXCLUSIVE,
    });
    const { replacement } = await supersedeGrant(
      grantId,
      grantInput({
        personId,
        assetIds: [assetId],
        licenseeId,
        exclusivity: Exclusivity.EXCLUSIVE,
      }),
    );
    const activated = await activateGrant(replacement.id, SYSTEM);
    expect(activated.status).toBe(GrantStatus.ACTIVE);
  });
});
