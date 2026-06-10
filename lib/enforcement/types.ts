import type {
  Prisma,
  UseType,
  Currency,
  Exclusivity,
} from "@/lib/generated/prisma/client";

/**
 * Sentinel territory value meaning "unrestricted". Stored as a member of the
 * Grant.territory String[] alongside ISO 3166-1 alpha-2 codes.
 */
export const WORLDWIDE = "WORLDWIDE" as const;

export type ActorType = "Person" | "Representative" | "Licensee" | "System";

/** Who is performing an action, for the audit trail. */
export interface Actor {
  type: ActorType;
  id?: string | null;
}

/**
 * Input to issueGrant. Every scope field is required and explicit — default-deny
 * means nothing is permitted unless a grant says so, so a grant with implicit or
 * empty scope must not be expressible.
 */
export interface IssueGrantInput {
  personId: string;
  /** At least one LikenessAsset, linked via GrantAsset. */
  assetIds: string[];
  useTypes: UseType[];
  /** ISO 3166-1 alpha-2 codes and/or the WORLDWIDE sentinel. */
  territory: string[];
  startsAt: Date;
  endsAt: Date;
  priceMicros: bigint;
  currency: Currency;
  /** Defaults to NON_EXCLUSIVE. */
  exclusivity?: Exclusivity;
  /** null = open standing offer (still requires a verified licensee at use). */
  licenseeId?: string | null;
  /** Open-ended negative space; surfaced verbatim, never interpreted here. */
  hardExclusions?: Prisma.InputJsonValue;
  actor: Actor;
}

/**
 * Input to evaluateScope. Exactly one of grantId / likenessAssetId identifies
 * what to evaluate; the rest describe the requested use.
 */
export interface ScopeCheck {
  /** Pin a specific grant. */
  grantId?: string;
  /** Or ask "is any grant authorizing this asset?". */
  likenessAssetId?: string;
  useType: UseType;
  territory: string;
  at: Date;
  /** The licensee asking. Required: default-deny needs to know who is asking. */
  licenseeId: string;
}

/**
 * The reasons a scope check can be denied. Every DENY enumerates the specific
 * conditions that failed — never a bare boolean.
 */
export type DenyReason =
  | "GRANT_NOT_FOUND"
  | "GRANT_NOT_ACTIVE"
  | "GRANT_REVOKED"
  | "SUPERSEDED"
  | "OUTSIDE_WINDOW"
  | "USE_TYPE_NOT_PERMITTED"
  | "TERRITORY_NOT_PERMITTED"
  | "LICENSEE_MISMATCH"
  | "LICENSEE_NOT_FOUND"
  | "LICENSEE_NOT_VERIFIED"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_LINKED"
  | "NO_GRANT_FOR_ASSET";

/**
 * The decision object. Never a bare boolean: a DENY enumerates which conditions
 * failed; an ALLOW cites the grant that authorized it. hardExclusions, when a
 * grant is in context, is surfaced verbatim for the caller to interpret — the v1
 * evaluator does not read its Json semantics.
 */
export interface ScopeDecision {
  allowed: boolean;
  /** The grant that allowed (ALLOW) or was evaluated (single-grant DENY). */
  grantId?: string;
  reasons: DenyReason[];
  hardExclusions?: Prisma.JsonValue;
}
