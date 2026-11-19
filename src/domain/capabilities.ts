import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditEvents,
  legalEntities,
  memberships,
  professionalGrants,
  tenantCapabilities,
  tenants,
  users,
} from '../db/schema.ts';
import type {
  CapabilityKey,
  ProductMode,
  ProfessionalGrantType,
} from '../contracts/api.ts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from './errors.ts';
import { assertPermission, type ActiveWorkspaceContext } from './tenancy.ts';

export const MANDATORY_SAFETY_CAPABILITIES: readonly CapabilityKey[] = [
  'safety.tenant_isolation',
  'safety.audit_trail',
  'safety.expiry_recall_guard',
  'safety.ledger_integrity',
] as const;

export const SHARED_STANDARD_CAPABILITIES: readonly CapabilityKey[] = [
  'reports.basic',
  'assistant.text',
  'assistant.voice',
] as const;

export const PRODUCT_MODE_CAPABILITIES: Record<ProductMode, readonly CapabilityKey[]> = {
  clinic_only: [
    'appointments.manage',
    'attendance.manage',
    'collections.record',
    ...SHARED_STANDARD_CAPABILITIES,
    ...MANDATORY_SAFETY_CAPABILITIES,
  ],
  pharmacy_inventory_only: [
    'pharmacy.catalogue',
    'pharmacy.receiving',
    'pharmacy.inventory',
    ...SHARED_STANDARD_CAPABILITIES,
    ...MANDATORY_SAFETY_CAPABILITIES,
  ],
  pharmacy_retail_only: [
    // Dependency closure automatically enables catalogue + receiving + inventory
    'pharmacy.catalogue',
    'pharmacy.receiving',
    'pharmacy.inventory',
    'pharmacy.pos',
    'pharmacy.returns',
    'pharmacy.professional_gate',
    ...SHARED_STANDARD_CAPABILITIES,
    ...MANDATORY_SAFETY_CAPABILITIES,
  ],
  combo: [
    'appointments.manage',
    'attendance.manage',
    'collections.record',
    'pharmacy.catalogue',
    'pharmacy.receiving',
    'pharmacy.inventory',
    'pharmacy.pos',
    'pharmacy.returns',
    'pharmacy.professional_gate',
    ...SHARED_STANDARD_CAPABILITIES,
    ...MANDATORY_SAFETY_CAPABILITIES,
  ],
};

export const ALL_KNOWN_CAPABILITIES: readonly CapabilityKey[] = [
  'appointments.manage',
  'attendance.manage',
  'collections.record',
  'pharmacy.catalogue',
  'pharmacy.receiving',
  'pharmacy.inventory',
  'pharmacy.pos',
  'pharmacy.returns',
  'pharmacy.professional_gate',
  'reports.basic',
  'assistant.text',
  'assistant.voice',
  'exports.csv',
  ...MANDATORY_SAFETY_CAPABILITIES,
];

export function resolveCapabilitiesForMode(
  mode: ProductMode,
  extraCapabilities?: Record<string, boolean>
): Record<CapabilityKey, boolean> {
  const result = {} as Record<CapabilityKey, boolean>;
  for (const cap of ALL_KNOWN_CAPABILITIES) {
    result[cap] = false;
  }

  for (const cap of PRODUCT_MODE_CAPABILITIES[mode]) {
    result[cap] = true;
  }

  if (extraCapabilities) {
    for (const [key, desired] of Object.entries(extraCapabilities)) {
      if ((MANDATORY_SAFETY_CAPABILITIES as readonly string[]).includes(key) && desired === false) {
        throw new ForbiddenError(
          `Mandatory safety control "${key}" cannot be disabled in any package tier`,
          'SAFETY_CONTROL_LOCKED',
          'errors.safety_control_locked'
        );
      }
      if ((ALL_KNOWN_CAPABILITIES as readonly string[]).includes(key)) {
        const typedKey = key as CapabilityKey;
        // Dependency closure: pharmacy.pos requires pharmacy.inventory, pharmacy.receiving, pharmacy.catalogue
        if (typedKey === 'pharmacy.pos' && desired === true) {
          result['pharmacy.catalogue'] = true;
          result['pharmacy.receiving'] = true;
          result['pharmacy.inventory'] = true;
          result['pharmacy.professional_gate'] = true;
        }
        if (
          (typedKey === 'pharmacy.catalogue' ||
            typedKey === 'pharmacy.receiving' ||
            typedKey === 'pharmacy.inventory') &&
          desired === false &&
          result['pharmacy.pos']
        ) {
          throw new ValidationError(
            `Cannot disable ${typedKey} while pharmacy POS is active`,
            'errors.capability_dependency_violation'
          );
        }
        result[typedKey] = Boolean(desired);
      }
    }
  }

  // Re-assert mandatory safety controls unconditionally
  for (const safetyCap of MANDATORY_SAFETY_CAPABILITIES) {
    result[safetyCap] = true;
  }

  return result;
}

export async function updateTenantProductMode(
  context: ActiveWorkspaceContext,
  input: { productMode: ProductMode; extraCapabilities?: Record<string, boolean> },
  correlationId: string
) {
  assertPermission(context, 'platform.capabilities.manage');
  const resolved = resolveCapabilitiesForMode(input.productMode, input.extraCapabilities);

  await db.transaction(async (tx) => {
    await tx
      .update(tenants)
      .set({
        productMode: input.productMode,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, context.tenantId));

    for (const [capabilityKey, enabled] of Object.entries(resolved)) {
      await tx
        .insert(tenantCapabilities)
        .values({
          tenantId: context.tenantId,
          capabilityKey,
          enabled,
          planTier: input.productMode,
          quotaLimit: capabilityKey === 'assistant.voice' ? 120 : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tenantCapabilities.tenantId, tenantCapabilities.capabilityKey],
          set: {
            enabled,
            planTier: input.productMode,
            updatedAt: new Date(),
          },
        });
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'platform.product_mode_updated',
      entityType: 'tenant',
      entityId: context.tenantId,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        previousMode: context.productMode,
        newMode: input.productMode,
      },
    });
  });

  return {
    productMode: input.productMode,
    capabilities: resolved,
  };
}

/**
 * Verifies an active, unrevoked, unexpired professional grant in PostgreSQL.
 * Holding `owner` or `manager` membership NEVER satisfies a professional grant.
 */
export async function assertProfessionalGrant(
  context: ActiveWorkspaceContext,
  grantType: ProfessionalGrantType
) {
  const now = new Date();
  const [grant] = await db
    .select({
      id: professionalGrants.id,
      grantType: professionalGrants.grantType,
      licenseNumber: professionalGrants.licenseNumber,
      expiresAt: professionalGrants.expiresAt,
    })
    .from(professionalGrants)
    .where(
      and(
        eq(professionalGrants.tenantId, context.tenantId),
        eq(professionalGrants.userId, context.userId),
        eq(professionalGrants.grantType, grantType),
        eq(professionalGrants.active, true),
        isNull(professionalGrants.revokedAt),
        or(isNull(professionalGrants.expiresAt), gt(professionalGrants.expiresAt, now))
      )
    )
    .limit(1);

  if (!grant) {
    throw new ForbiddenError(
      `An active ${grantType} professional grant is required for this regulated operation (admin/owner role alone is insufficient)`,
      'PROFESSIONAL_GRANT_REQUIRED',
      'errors.professional_grant_required'
    );
  }

  return grant;
}

export async function listProfessionalGrants(context: ActiveWorkspaceContext) {
  assertPermission(context, 'pharmacy.stock.read');
  const rows = await db
    .select({
      id: professionalGrants.id,
      userId: professionalGrants.userId,
      userEmail: users.email,
      userName: users.displayName,
      grantType: professionalGrants.grantType,
      licenseNumber: professionalGrants.licenseNumber,
      active: professionalGrants.active,
      revokedAt: professionalGrants.revokedAt,
      expiresAt: professionalGrants.expiresAt,
      createdAt: professionalGrants.createdAt,
    })
    .from(professionalGrants)
    .innerJoin(users, eq(professionalGrants.userId, users.id))
    .where(eq(professionalGrants.tenantId, context.tenantId))
    .orderBy(desc(professionalGrants.createdAt));

  return rows;
}

export async function grantProfessionalAuthority(
  context: ActiveWorkspaceContext,
  input: {
    userId: number;
    grantType: ProfessionalGrantType;
    licenseNumber: string;
    expiresAt?: string | null;
  },
  correlationId: string
) {
  assertPermission(context, 'platform.grants.manage');

  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, context.tenantId),
        eq(memberships.userId, input.userId),
        eq(memberships.active, true)
      )
    )
    .limit(1);

  if (!member) {
    throw new NotFoundError('Target staff member does not have an active membership in this workspace');
  }

  const existing = await db
    .select({ id: professionalGrants.id })
    .from(professionalGrants)
    .where(
      and(
        eq(professionalGrants.tenantId, context.tenantId),
        eq(professionalGrants.userId, input.userId),
        eq(professionalGrants.grantType, input.grantType),
        eq(professionalGrants.active, true),
        isNull(professionalGrants.revokedAt)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError(
      `User already holds an active ${input.grantType} grant in this workspace`,
      'GRANT_ALREADY_ACTIVE'
    );
  }

  const parsedExpires = input.expiresAt ? new Date(input.expiresAt) : null;

  const [created] = await db.transaction(async (tx) => {
    const [grant] = await tx
      .insert(professionalGrants)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        userId: input.userId,
        grantType: input.grantType,
        licenseNumber: input.licenseNumber.trim(),
        active: true,
        grantedByUserId: context.userId,
        expiresAt: parsedExpires,
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'platform.professional_grant_issued',
      entityType: 'professional_grant',
      entityId: grant.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        targetUserId: input.userId,
        grantType: input.grantType,
        licenseNumber: input.licenseNumber.trim(),
      },
    });

    return [grant];
  });

  return created;
}

export async function revokeProfessionalAuthority(
  context: ActiveWorkspaceContext,
  grantId: string,
  correlationId: string
) {
  assertPermission(context, 'platform.grants.manage');

  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(professionalGrants)
      .set({
        active: false,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(professionalGrants.id, grantId),
          eq(professionalGrants.tenantId, context.tenantId),
          eq(professionalGrants.active, true)
        )
      )
      .returning();

    if (!row) {
      throw new NotFoundError('Active professional grant not found');
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'platform.professional_grant_revoked',
      entityType: 'professional_grant',
      entityId: row.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        targetUserId: row.userId,
        grantType: row.grantType,
      },
    });

    return [row];
  });

  return updated;
}

export async function listLegalEntities(context: ActiveWorkspaceContext) {
  return db
    .select()
    .from(legalEntities)
    .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.active, true)));
}

export async function createLegalEntity(
  context: ActiveWorkspaceContext,
  input: { name: string; registrationNumber?: string; taxId?: string },
  correlationId: string
) {
  assertPermission(context, 'platform.capabilities.manage');
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(legalEntities)
      .values({
        tenantId: context.tenantId,
        name: input.name.trim(),
        registrationNumber: input.registrationNumber?.trim() || '',
        taxId: input.taxId?.trim() || '',
        countryCode: context.countryCode,
        currency: context.currency,
        active: true,
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'platform.legal_entity_created',
      entityType: 'legal_entity',
      entityId: created.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { name: created.name },
    });

    return created;
  });
}
