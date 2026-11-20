import crypto from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  appointments,
  auditEvents,
  branches,
  counters,
  departments,
  doctorCommissionRules,
  doctorSchedules,
  legalEntities,
  memberships,
  people,
  professionalGrants,
  resources,
  services,
  storageLocations,
  tenantCapabilities,
  tenants,
  users,
} from '../db/schema.ts';
import {
  CapabilityKey,
  OnboardingBootstrapInput,
  PermissionKey,
  ProductMode,
  ProfessionalGrantSummary,
  ProfessionalGrantType,
  ROLE_PERMISSIONS,
  Role,
  SessionContextResponse,
} from '../contracts/api.ts';
import {
  MANDATORY_SAFETY_CAPABILITIES,
  resolveCapabilitiesForMode,
} from './capabilities.ts';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from './errors.ts';
import {
  addMemAuditEvent,
  getMemoryStore,
  seedStarterPharmacyAndOpsData,
} from './memory-store.ts';
import type { AuthenticatedUser } from '../middleware/auth.ts';

export interface ActiveWorkspaceContext {
  userId: number;
  uid: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  productMode: ProductMode;
  legalEntityId: string | null;
  legalEntityName: string | null;
  countryCode: string;
  timezone: string;
  currency: string;
  branchId: string;
  branchName: string;
  role: Role;
  permissions: readonly PermissionKey[];
  professionalGrants: ProfessionalGrantSummary[];
  capabilities: Record<string, boolean>;
}

export function hasPermission(role: Role, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(context: ActiveWorkspaceContext, permission: PermissionKey) {
  if (!hasPermission(context.role, permission)) {
    throw new ForbiddenError(
      'Your current role does not permit this operation',
      'PERMISSION_DENIED',
      'errors.permission_denied'
    );
  }
}

export function assertCapability(context: ActiveWorkspaceContext, capability: CapabilityKey) {
  if (!context.capabilities[capability]) {
    throw new CapabilityUnavailableError(`Capability ${capability} is disabled for this workspace`);
  }
}

export function getBusinessDateInTimezone(timezone: string, reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

export async function resolveSessionContext(
  authUser: AuthenticatedUser,
  requestedTenantId?: string
): Promise<{
  session: SessionContextResponse;
  activeContext: ActiveWorkspaceContext | null;
}> {
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const userMemberships = store.memberships
      .filter((m) => m.userId === authUser.id && m.active)
      .map((m) => {
        const tenant = store.tenants.find((t) => t.id === m.tenantId);
        const branch = store.branches.find((b) => b.id === m.branchId && b.tenantId === m.tenantId);
        if (!tenant || !branch) return null;
        return {
          membershipId: m.id,
          membershipActive: m.active,
          role: m.role,
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantStatus: tenant.status,
          productMode: tenant.productMode,
          countryCode: tenant.countryCode,
          timezone: tenant.timezone,
          currency: tenant.currency,
          branchId: branch.id,
          branchName: branch.name,
          legalEntityId: branch.legalEntityId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const availableTenants = userMemberships
      .filter((m) => m.tenantStatus === 'active')
      .map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        branchName: m.branchName,
        role: m.role as Role,
        productMode: m.productMode,
      }));

    if (requestedTenantId) {
      const uuidValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        requestedTenantId
      );
      if (!uuidValid) {
        throw new NotFoundError('Workspace not found');
      }
      const matched = userMemberships.find(
        (m) => m.tenantId === requestedTenantId && m.tenantStatus === 'active'
      );
      if (!matched) {
        throw new NotFoundError('Workspace not found');
      }
    }

    const selected = requestedTenantId
      ? userMemberships.find((m) => m.tenantId === requestedTenantId)
      : userMemberships.find((m) => m.tenantStatus === 'active');

    if (!selected) {
      return {
        session: {
          authenticated: true,
          user: {
            id: authUser.id,
            uid: authUser.uid,
            email: authUser.email,
            displayName: authUser.displayName,
            preferredLocale: authUser.preferredLocale,
          },
          requiresOnboarding: true,
          workspace: null,
          availableTenants: [],
        },
        activeContext: null,
      };
    }

    if (selected.tenantStatus !== 'active') {
      throw new ForbiddenError('Workspace is currently suspended', 'TENANT_SUSPENDED');
    }

    const capabilities: Record<string, boolean> = {};
    for (const c of store.capabilities.filter((cap) => cap.tenantId === selected.tenantId)) {
      capabilities[c.capabilityKey] = c.enabled;
    }
    for (const safetyCap of MANDATORY_SAFETY_CAPABILITIES) {
      capabilities[safetyCap] = true;
    }

    const le =
      store.legalEntities.find(
        (l) => l.id === selected.legalEntityId && l.tenantId === selected.tenantId
      ) ?? store.legalEntities.find((l) => l.tenantId === selected.tenantId);

    const nowMs = Date.now();
    const activeGrants: ProfessionalGrantSummary[] = store.professionalGrants
      .filter(
        (g) =>
          g.tenantId === selected.tenantId &&
          g.userId === authUser.id &&
          g.active &&
          !g.revokedAt &&
          (!g.expiresAt || g.expiresAt.getTime() > nowMs)
      )
      .map((g) => ({
        id: g.id,
        grantType: g.grantType,
        licenseNumber: g.licenseNumber,
        active: g.active,
        expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
      }));

    const role = selected.role as Role;
    const permissions = ROLE_PERMISSIONS[role];
    const activeContext: ActiveWorkspaceContext = {
      userId: authUser.id,
      uid: authUser.uid,
      tenantId: selected.tenantId,
      tenantName: selected.tenantName,
      tenantStatus: selected.tenantStatus,
      productMode: selected.productMode,
      legalEntityId: le?.id ?? selected.legalEntityId,
      legalEntityName: le?.name ?? null,
      countryCode: selected.countryCode,
      timezone: selected.timezone,
      currency: selected.currency,
      branchId: selected.branchId,
      branchName: selected.branchName,
      role,
      permissions,
      professionalGrants: activeGrants,
      capabilities,
    };

    return {
      session: {
        authenticated: true,
        user: {
          id: authUser.id,
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
          preferredLocale: authUser.preferredLocale,
        },
        requiresOnboarding: false,
        workspace: {
          tenantId: activeContext.tenantId,
          tenantName: activeContext.tenantName,
          tenantStatus: activeContext.tenantStatus,
          productMode: activeContext.productMode,
          legalEntityId: activeContext.legalEntityId,
          legalEntityName: activeContext.legalEntityName,
          countryCode: activeContext.countryCode,
          timezone: activeContext.timezone,
          currency: activeContext.currency,
          branchId: activeContext.branchId,
          branchName: activeContext.branchName,
          role: activeContext.role,
          permissions: activeContext.permissions,
          professionalGrants: activeContext.professionalGrants,
          capabilities: activeContext.capabilities,
        },
        availableTenants,
      },
      activeContext,
    };
  }

  try {
    const userMemberships = await db
      .select({
        membershipId: memberships.id,
        membershipActive: memberships.active,
        role: memberships.role,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantStatus: tenants.status,
        productMode: tenants.productMode,
        countryCode: tenants.countryCode,
        timezone: tenants.timezone,
        currency: tenants.currency,
        branchId: branches.id,
        branchName: branches.name,
        legalEntityId: branches.legalEntityId,
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .innerJoin(
        branches,
        and(eq(memberships.branchId, branches.id), eq(branches.tenantId, tenants.id))
      )
      .where(and(eq(memberships.userId, authUser.id), eq(memberships.active, true)));

    const availableTenants = userMemberships
      .filter((m) => m.tenantStatus === 'active')
      .map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        branchName: m.branchName,
        role: m.role as Role,
        productMode: (m.productMode || 'clinic_only') as ProductMode,
      }));

    if (requestedTenantId) {
      const uuidValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        requestedTenantId
      );
      if (!uuidValid) {
        throw new NotFoundError('Workspace not found');
      }
      const matched = userMemberships.find(
        (m) => m.tenantId === requestedTenantId && m.tenantStatus === 'active'
      );
      if (!matched) {
        throw new NotFoundError('Workspace not found');
      }
    }

    const selected = requestedTenantId
      ? userMemberships.find((m) => m.tenantId === requestedTenantId)
      : userMemberships.find((m) => m.tenantStatus === 'active');

    if (!selected) {
      return {
        session: {
          authenticated: true,
          user: {
            id: authUser.id,
            uid: authUser.uid,
            email: authUser.email,
            displayName: authUser.displayName,
            preferredLocale: authUser.preferredLocale,
          },
          requiresOnboarding: true,
          workspace: null,
          availableTenants: [],
        },
        activeContext: null,
      };
    }

    if (selected.tenantStatus !== 'active') {
      throw new ForbiddenError('Workspace is currently suspended', 'TENANT_SUSPENDED');
    }

    const caps = await db
      .select({
        capabilityKey: tenantCapabilities.capabilityKey,
        enabled: tenantCapabilities.enabled,
      })
      .from(tenantCapabilities)
      .where(eq(tenantCapabilities.tenantId, selected.tenantId));

    const capabilities: Record<string, boolean> = {};
    for (const c of caps) {
      capabilities[c.capabilityKey] = c.enabled;
    }
    for (const safetyCap of MANDATORY_SAFETY_CAPABILITIES) {
      capabilities[safetyCap] = true;
    }

    let resolvedLegalEntityId = selected.legalEntityId;
    let resolvedLegalEntityName: string | null = null;

    if (resolvedLegalEntityId) {
      const [le] = await db
        .select({ id: legalEntities.id, name: legalEntities.name })
        .from(legalEntities)
        .where(
          and(
            eq(legalEntities.id, resolvedLegalEntityId),
            eq(legalEntities.tenantId, selected.tenantId)
          )
        )
        .limit(1);
      resolvedLegalEntityName = le?.name ?? null;
    } else {
      const [fallbackLe] = await db
        .select({ id: legalEntities.id, name: legalEntities.name })
        .from(legalEntities)
        .where(eq(legalEntities.tenantId, selected.tenantId))
        .limit(1);
      if (fallbackLe) {
        resolvedLegalEntityId = fallbackLe.id;
        resolvedLegalEntityName = fallbackLe.name;
      }
    }

    const now = new Date();
    const grantRows = await db
      .select({
        id: professionalGrants.id,
        grantType: professionalGrants.grantType,
        licenseNumber: professionalGrants.licenseNumber,
        active: professionalGrants.active,
        expiresAt: professionalGrants.expiresAt,
      })
      .from(professionalGrants)
      .where(
        and(
          eq(professionalGrants.tenantId, selected.tenantId),
          eq(professionalGrants.userId, authUser.id),
          eq(professionalGrants.active, true),
          isNull(professionalGrants.revokedAt),
          or(isNull(professionalGrants.expiresAt), gt(professionalGrants.expiresAt, now))
        )
      );

    const activeGrants: ProfessionalGrantSummary[] = grantRows.map((g) => ({
      id: g.id,
      grantType: g.grantType as ProfessionalGrantType,
      licenseNumber: g.licenseNumber,
      active: g.active,
      expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
    }));

    const role = selected.role as Role;
    const permissions = ROLE_PERMISSIONS[role];
    const productMode = (selected.productMode || 'clinic_only') as ProductMode;

    const activeContext: ActiveWorkspaceContext = {
      userId: authUser.id,
      uid: authUser.uid,
      tenantId: selected.tenantId,
      tenantName: selected.tenantName,
      tenantStatus: selected.tenantStatus,
      productMode,
      legalEntityId: resolvedLegalEntityId,
      legalEntityName: resolvedLegalEntityName,
      countryCode: selected.countryCode,
      timezone: selected.timezone,
      currency: selected.currency,
      branchId: selected.branchId,
      branchName: selected.branchName,
      role,
      permissions,
      professionalGrants: activeGrants,
      capabilities,
    };

    return {
      session: {
        authenticated: true,
        user: {
          id: authUser.id,
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
          preferredLocale: authUser.preferredLocale,
        },
        requiresOnboarding: false,
        workspace: {
          tenantId: activeContext.tenantId,
          tenantName: activeContext.tenantName,
          tenantStatus: activeContext.tenantStatus,
          productMode: activeContext.productMode,
          legalEntityId: activeContext.legalEntityId,
          legalEntityName: activeContext.legalEntityName,
          countryCode: activeContext.countryCode,
          timezone: activeContext.timezone,
          currency: activeContext.currency,
          branchId: activeContext.branchId,
          branchName: activeContext.branchName,
          role: activeContext.role,
          permissions: activeContext.permissions,
          professionalGrants: activeContext.professionalGrants,
          capabilities: activeContext.capabilities,
        },
        availableTenants,
      },
      activeContext,
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      throw error;
    }
    console.error('Failed to resolve workspace session context:', error);
    throw new Error('Unable to resolve workspace context', { cause: error });
  }
}

export async function requireActiveWorkspace(
  authUser: AuthenticatedUser,
  requestedTenantId?: string
): Promise<ActiveWorkspaceContext> {
  const { activeContext } = await resolveSessionContext(authUser, requestedTenantId);
  if (!activeContext) {
    throw new ForbiddenError(
      'No active workspace membership found for user',
      'MEMBERSHIP_REQUIRED',
      'errors.membership_required'
    );
  }
  return activeContext;
}

export type BootstrapInputCompat = Omit<OnboardingBootstrapInput, 'productMode'> & {
  productMode?: ProductMode;
};

export async function bootstrapClinicWorkspace(
  authUser: AuthenticatedUser,
  input: BootstrapInputCompat,
  correlationId: string
): Promise<ActiveWorkspaceContext> {
  const productMode: ProductMode = input.productMode ?? 'combo';
  const hasClinic = productMode === 'clinic_only' || productMode === 'combo';
  const hasPharmacy = productMode !== 'clinic_only';

  const slugBase =
    input.clinicName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'workspace';
  const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;
  const resolvedCapabilities = resolveCapabilitiesForMode(productMode);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existing = store.memberships.find((m) => m.userId === authUser.id && m.active);
    if (existing) {
      throw new ConflictError(
        'User already has an active workspace',
        'ALREADY_ONBOARDED',
        'errors.already_onboarded'
      );
    }

    const now = new Date();
    const tenantId = crypto.randomUUID();
    const legalEntityId = crypto.randomUUID();
    const branchId = crypto.randomUUID();

    store.tenants.push({
      id: tenantId,
      slug,
      name: input.clinicName,
      productMode,
      countryCode: input.countryCode,
      timezone: input.timezone,
      currency: input.currency,
      status: 'active',
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    });

    store.legalEntities.push({
      id: legalEntityId,
      tenantId,
      name: input.legalEntityName?.trim() || input.clinicName,
      registrationNumber: '',
      taxId: '',
      countryCode: input.countryCode,
      currency: input.currency,
      active: true,
      createdAt: now,
    });

    store.branches.push({
      id: branchId,
      tenantId,
      legalEntityId,
      name: input.branchName,
      code: 'MAIN',
      timezone: input.timezone,
      openingHoursJson: { summary: input.openingHoursSummary },
      isDefault: true,
      active: true,
      createdAt: now,
    });

    store.memberships.push({
      id: crypto.randomUUID(),
      tenantId,
      branchId,
      userId: authUser.id,
      role: 'owner',
      active: true,
      revokedAt: null,
      createdAt: now,
    });

    for (const [key, enabled] of Object.entries(resolvedCapabilities)) {
      store.capabilities.push({
        tenantId,
        capabilityKey: key,
        enabled,
        planTier: productMode,
        quotaLimit: key === 'assistant.voice' ? 250 : null,
        updatedAt: now,
      });
    }

    store.counters.push({
      id: crypto.randomUUID(),
      tenantId,
      branchId,
      departmentId: null,
      name: 'Main Counter 1',
      code: 'MAIN-1',
      active: true,
      createdAt: now,
    });

    if (hasPharmacy) {
      store.storageLocations.push(
        {
          id: crypto.randomUUID(),
          tenantId,
          branchId,
          code: 'DISP-1',
          name: 'Main Dispensary Shelf',
          locationType: 'dispensary',
          active: true,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          tenantId,
          branchId,
          code: 'STOR-1',
          name: 'Bulk Store Room',
          locationType: 'store_room',
          active: true,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          tenantId,
          branchId,
          code: 'QUAR-1',
          name: 'Quarantine Cage',
          locationType: 'quarantine',
          active: true,
          createdAt: now,
        }
      );
    }

    const businessDate = getBusinessDateInTimezone(input.timezone);
    let primaryResourceId: string | undefined;
    const seededAptIds: string[] = [];
    const seededPersonIds: string[] = [];

    if (hasClinic && input.services.length > 0) {
      const insertedServices = input.services.map((svc) => {
        const s = {
          id: crypto.randomUUID(),
          tenantId,
          branchId,
          name: svc.name,
          nameSi: svc.nameSi || svc.name,
          durationMinutes: svc.durationMinutes,
          priceMinor: Math.round(svc.priceLkr * 100),
          currency: input.currency,
          active: true,
        };
        store.services.push(s);
        return s;
      });

      primaryResourceId = crypto.randomUUID();
      store.resources.push({
        id: primaryResourceId,
        tenantId,
        branchId,
        name: input.primaryPractitionerName || 'Primary Provider',
        specialty: input.primaryPractitionerSpecialty || 'General Practice',
        capacity: 1,
        workingHoursJson: { summary: input.openingHoursSummary },
        active: true,
      });

      store.doctorCommissionRules.push({
        id: crypto.randomUUID(),
        tenantId,
        resourceId: primaryResourceId,
        serviceId: null,
        doctorSharePercent: 75,
        clinicSharePercent: 25,
        updatedAt: now,
      });

      if (input.includeSampleData && insertedServices.length > 0) {
        const primaryService = insertedServices[0];
        const nimalId = crypto.randomUUID();
        const kamalaId = crypto.randomUUID();
        seededPersonIds.push(nimalId, kamalaId);
        store.people.push(
          {
            id: nimalId,
            tenantId,
            branchId,
            displayName: 'Nimal Perera (Sample)',
            normalizedName: 'nimal perera sample',
            aliasesJson: ['නිමල් පෙරේරා', 'නිමල්'],
            phone: '0770001234',
            phoneLast4: '1234',
            notes: 'Synthetic onboarding sample patient',
            isSample: true,
            version: 1,
            createdAt: now,
          },
          {
            id: kamalaId,
            tenantId,
            branchId,
            displayName: 'Kamala Silva (Sample)',
            normalizedName: 'kamala silva sample',
            aliasesJson: ['කමලා සිල්වා', 'කමලා'],
            phone: '0710005678',
            phoneLast4: '5678',
            notes: 'Synthetic onboarding sample patient',
            isSample: true,
            version: 1,
            createdAt: now,
          }
        );

        const start1 = new Date(`${businessDate}T09:00:00+05:30`);
        const end1 = new Date(start1.getTime() + primaryService.durationMinutes * 60_000);
        const start2 = new Date(`${businessDate}T10:30:00+05:30`);
        const end2 = new Date(start2.getTime() + primaryService.durationMinutes * 60_000);

        const apt1Id = crypto.randomUUID();
        const apt2Id = crypto.randomUUID();
        seededAptIds.push(apt1Id, apt2Id);

        store.appointments.push(
          {
            id: apt1Id,
            tenantId,
            branchId,
            personId: nimalId,
            serviceId: primaryService.id,
            resourceId: primaryResourceId,
            startsAt: start1,
            endsAt: end1,
            businessDate,
            status: 'scheduled',
            bookedDurationMinutes: primaryService.durationMinutes,
            bookedPriceMinor: primaryService.priceMinor,
            currency: input.currency,
            notes: 'Sample appointment created during clinic onboarding',
            isSample: true,
            version: 1,
            createdByUserId: authUser.id,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: apt2Id,
            tenantId,
            branchId,
            personId: kamalaId,
            serviceId: primaryService.id,
            resourceId: primaryResourceId,
            startsAt: start2,
            endsAt: end2,
            businessDate,
            status: 'arrived',
            bookedDurationMinutes: primaryService.durationMinutes,
            bookedPriceMinor: primaryService.priceMinor,
            currency: input.currency,
            notes: 'Sample arrived patient',
            isSample: true,
            version: 1,
            createdByUserId: authUser.id,
            createdAt: now,
            updatedAt: now,
          }
        );
      }
    }

    if (input.includeSampleData) {
      seedStarterPharmacyAndOpsData({
        tenantId,
        legalEntityId,
        branchId,
        userId: authUser.id,
        businessDate,
        currency: input.currency,
        hasClinic,
        hasPharmacy,
        resourceId: primaryResourceId,
        appointmentIds: seededAptIds,
        personIds: seededPersonIds,
      });
    }

    addMemAuditEvent({
      tenantId,
      actorUserId: authUser.id,
      actorUid: authUser.uid,
      action: 'tenant.onboarding_bootstrapped',
      entityType: 'tenant',
      entityId: tenantId,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        productMode,
        legalEntityId,
        countryCode: input.countryCode,
        timezone: input.timezone,
        currency: input.currency,
        includeSampleData: input.includeSampleData,
      },
    });

    return requireActiveWorkspace(authUser, tenantId);
  }

  try {
    const existing = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, authUser.id), eq(memberships.active, true)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError(
        'User already has an active workspace',
        'ALREADY_ONBOARDED',
        'errors.already_onboarded'
      );
    }

    const created = await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ preferredLocale: input.preferredLocale, updatedAt: new Date() })
        .where(eq(users.id, authUser.id));

      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug,
          name: input.clinicName,
          productMode,
          countryCode: input.countryCode,
          timezone: input.timezone,
          currency: input.currency,
          status: 'active',
          onboardingCompleted: true,
        })
        .returning();

      const [legalEntity] = await tx
        .insert(legalEntities)
        .values({
          tenantId: tenant.id,
          name: input.legalEntityName?.trim() || input.clinicName,
          countryCode: input.countryCode,
          currency: input.currency,
          active: true,
        })
        .returning();

      const [branch] = await tx
        .insert(branches)
        .values({
          tenantId: tenant.id,
          legalEntityId: legalEntity.id,
          name: input.branchName,
          code: 'MAIN',
          timezone: input.timezone,
          openingHoursJson: { summary: input.openingHoursSummary },
          isDefault: true,
          active: true,
        })
        .returning();

      await tx.insert(memberships).values({
        tenantId: tenant.id,
        branchId: branch.id,
        userId: authUser.id,
        role: 'owner',
        active: true,
      });

      await tx.insert(tenantCapabilities).values(
        Object.entries(resolvedCapabilities).map(([key, enabled]) => ({
          tenantId: tenant.id,
          capabilityKey: key,
          enabled,
          planTier: productMode,
          quotaLimit: key === 'assistant.voice' ? 250 : null,
        }))
      );

      const deptValues: Array<{
        tenantId: string;
        branchId: string;
        name: string;
        domain: 'clinic' | 'pharmacy' | 'shared';
      }> = [];
      if (hasClinic) {
        deptValues.push({
          tenantId: tenant.id,
          branchId: branch.id,
          name: 'Clinic Reception & OPD',
          domain: 'clinic',
        });
      }
      if (hasPharmacy) {
        deptValues.push({
          tenantId: tenant.id,
          branchId: branch.id,
          name: 'Pharmacy Dispensary & Store',
          domain: 'pharmacy',
        });
      }
      const insertedDepts = await tx.insert(departments).values(deptValues).returning();
      if (insertedDepts.length > 0) {
        await tx.insert(counters).values({
          tenantId: tenant.id,
          branchId: branch.id,
          departmentId: insertedDepts[0].id,
          name: 'Main Counter 1',
          code: 'MAIN-1',
          active: true,
        });
      }

      if (hasPharmacy) {
        await tx.insert(storageLocations).values([
          {
            tenantId: tenant.id,
            branchId: branch.id,
            code: 'DISP-1',
            name: 'Main Dispensary Shelf',
            locationType: 'dispensary',
            active: true,
          },
          {
            tenantId: tenant.id,
            branchId: branch.id,
            code: 'STOR-1',
            name: 'Bulk Store Room',
            locationType: 'store_room',
            active: true,
          },
          {
            tenantId: tenant.id,
            branchId: branch.id,
            code: 'QUAR-1',
            name: 'Quarantine Cage',
            locationType: 'quarantine',
            active: true,
          },
        ]);
      }

      let servicesCount = 0;
      if (hasClinic && input.services.length > 0) {
        const insertedServices = await tx
          .insert(services)
          .values(
            input.services.map((svc) => ({
              tenantId: tenant.id,
              branchId: branch.id,
              name: svc.name,
              nameSi: svc.nameSi || svc.name,
              durationMinutes: svc.durationMinutes,
              priceMinor: Math.round(svc.priceLkr * 100),
              currency: input.currency,
              active: true,
            }))
          )
          .returning();
        servicesCount = insertedServices.length;

        const [resource] = await tx
          .insert(resources)
          .values({
            tenantId: tenant.id,
            branchId: branch.id,
            name: input.primaryPractitionerName || 'Primary Provider',
            specialty: input.primaryPractitionerSpecialty || 'General Practice',
            capacity: 1,
            workingHoursJson: { summary: input.openingHoursSummary },
            active: true,
          })
          .returning();

        // Default doctor schedule & commission split
        await tx.insert(doctorSchedules).values([1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          tenantId: tenant.id,
          branchId: branch.id,
          resourceId: resource.id,
          dayOfWeek,
          startTime: '08:30',
          endTime: '17:30',
          slotDurationMinutes: 20,
          active: true,
        })));
        await tx.insert(doctorCommissionRules).values({
          tenantId: tenant.id,
          resourceId: resource.id,
          doctorSharePercent: 75,
          clinicSharePercent: 25,
        });

        if (input.includeSampleData && insertedServices.length > 0) {
          const primaryService = insertedServices[0];
          const businessDate = getBusinessDateInTimezone(input.timezone);

          const [nimal, kamala] = await tx
            .insert(people)
            .values([
              {
                tenantId: tenant.id,
                branchId: branch.id,
                displayName: 'Nimal Perera (Sample)',
                normalizedName: 'nimal perera sample',
                aliasesJson: ['නිමල් පෙරේරා', 'නිමල්'],
                phone: '0770001234',
                phoneLast4: '1234',
                notes: 'Synthetic onboarding sample patient',
                isSample: true,
              },
              {
                tenantId: tenant.id,
                branchId: branch.id,
                displayName: 'Kamala Silva (Sample)',
                normalizedName: 'kamala silva sample',
                aliasesJson: ['කමලා සිල්වා', 'කමලා'],
                phone: '0710005678',
                phoneLast4: '5678',
                notes: 'Synthetic onboarding sample patient',
                isSample: true,
              },
            ])
            .returning();

          const start1 = new Date(`${businessDate}T09:00:00+05:30`);
          const end1 = new Date(start1.getTime() + primaryService.durationMinutes * 60_000);
          const start2 = new Date(`${businessDate}T10:30:00+05:30`);
          const end2 = new Date(start2.getTime() + primaryService.durationMinutes * 60_000);

          await tx.insert(appointments).values([
            {
              tenantId: tenant.id,
              branchId: branch.id,
              personId: nimal.id,
              serviceId: primaryService.id,
              resourceId: resource.id,
              startsAt: start1,
              endsAt: end1,
              businessDate,
              status: 'scheduled',
              bookedDurationMinutes: primaryService.durationMinutes,
              bookedPriceMinor: primaryService.priceMinor,
              currency: input.currency,
              notes: 'Sample appointment created during clinic onboarding',
              isSample: true,
              createdByUserId: authUser.id,
            },
            {
              tenantId: tenant.id,
              branchId: branch.id,
              personId: kamala.id,
              serviceId: primaryService.id,
              resourceId: resource.id,
              startsAt: start2,
              endsAt: end2,
              businessDate,
              status: 'arrived',
              bookedDurationMinutes: primaryService.durationMinutes,
              bookedPriceMinor: primaryService.priceMinor,
              currency: input.currency,
              notes: 'Sample arrived patient',
              isSample: true,
              createdByUserId: authUser.id,
            },
          ]);
        }
      }

      await tx.insert(auditEvents).values({
        tenantId: tenant.id,
        actorUserId: authUser.id,
        actorUid: authUser.uid,
        action: 'tenant.onboarding_bootstrapped',
        entityType: 'tenant',
        entityId: tenant.id,
        inputSource: 'ui',
        correlationId,
        metadataJson: {
          productMode,
          legalEntityId: legalEntity.id,
          countryCode: input.countryCode,
          timezone: input.timezone,
          currency: input.currency,
          includeSampleData: input.includeSampleData,
          servicesCount,
        },
      });

      return { tenant, branch };
    });

    return requireActiveWorkspace(authUser, created.tenant.id);
  } catch (error) {
    if (
      error instanceof DomainError ||
      error instanceof ConflictError ||
      error instanceof ForbiddenError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }
    console.error('Workspace onboarding bootstrap failed:', error);
    throw new Error('Failed to create workspace', { cause: error });
  }
}

class CapabilityUnavailableError extends DomainError {
  constructor(message: string) {
    super({
      statusCode: 403,
      code: 'FEATURE_UNAVAILABLE',
      messageKey: 'errors.feature_unavailable',
      message,
      retryable: false,
    });
  }
}
