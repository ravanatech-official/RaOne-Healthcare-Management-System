import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  branches,
  counters,
  departments,
  memberships,
  staffInvites,
  staffShiftPins,
  storageLocations,
  users,
} from '../db/schema.ts';
import { getMemoryUserByEmail, getMemoryUserById } from '../db/users.ts';
import type {
  CreateBranchInput,
  CreateStaffInviteInput,
  Role,
} from '../contracts/api.ts';
import type { AuthenticatedUser } from '../middleware/auth.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace, assertWithinQuota } from './subscription-billing.ts';
import { assertPermission, type ActiveWorkspaceContext } from './tenancy.ts';

function hashPin(pin: string, salt?: string): { salt: string; hash: string } {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pin, s, 32).toString('hex');
  return { salt: s, hash: h };
}

function verifyPinHash(pin: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPin(pin, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// 1. Dual-Mode Team & Audit Queries (Preview + Cloud SQL)
// ---------------------------------------------------------------------------
export async function listTeamMembers(context: ActiveWorkspaceContext) {
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.memberships
      .filter((m) => m.tenantId === context.tenantId)
      .map((m) => {
        const u = getMemoryUserById(m.userId);
        const branch = store.branches.find((b) => b.id === m.branchId);
        return {
          membershipId: m.id,
          userId: m.userId,
          role: m.role,
          active: m.active,
          branchId: m.branchId,
          branchName: branch?.name ?? 'Main Branch',
          email: u?.email ?? 'staff@suwaseva.lk',
          displayName: u?.displayName ?? 'Workspace Staff',
          createdAt: m.createdAt,
        };
      });
  }

  return db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      active: memberships.active,
      branchId: memberships.branchId,
      branchName: branches.name,
      email: users.email,
      displayName: users.displayName,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(branches, eq(memberships.branchId, branches.id))
    .where(eq(memberships.tenantId, context.tenantId));
}

export async function listWorkspaceAuditEvents(context: ActiveWorkspaceContext, limit = 50) {
  assertPermission(context, 'audit.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.auditEvents
      .filter((e) => e.tenantId === context.tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  return db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      inputSource: auditEvents.inputSource,
      correlationId: auditEvents.correlationId,
      metadataJson: auditEvents.metadataJson,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, context.tenantId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// 2. Multi-Branch Management (Quota-Enforced)
// ---------------------------------------------------------------------------
export async function listWorkspaceBranches(context: ActiveWorkspaceContext) {
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.branches.filter((b) => b.tenantId === context.tenantId && b.active);
  }
  return db
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, context.tenantId), eq(branches.active, true)));
}

export async function createWorkspaceBranch(
  context: ActiveWorkspaceContext,
  input: CreateBranchInput,
  correlationId: string
) {
  assertPermission(context, 'team.manage_stepup');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);
  await assertWithinQuota(context, 'branches');

  const codeClean = input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const dup = store.branches.find(
      (b) => b.tenantId === context.tenantId && b.code === codeClean
    );
    if (dup) throw new ConflictError(`Branch code "${codeClean}" already exists`);

    const leId =
      context.legalEntityId ??
      store.legalEntities.find((l) => l.tenantId === context.tenantId)?.id ??
      crypto.randomUUID();

    const branch = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      legalEntityId: leId,
      name: input.name.trim(),
      code: codeClean,
      timezone: context.timezone,
      openingHoursJson: { summary: input.openingHoursSummary },
      isDefault: false,
      active: true,
      createdAt: now,
    };
    store.branches.push(branch);

    store.counters.push({
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: branch.id,
      departmentId: null,
      name: `${branch.name} Counter 1`,
      code: `${codeClean}-1`,
      active: true,
      createdAt: now,
    });

    store.storageLocations.push(
      {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        branchId: branch.id,
        code: `${codeClean}-DISP`,
        name: `${branch.name} Dispensary`,
        locationType: 'dispensary',
        active: true,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        branchId: branch.id,
        code: `${codeClean}-QUAR`,
        name: `${branch.name} Quarantine Cage`,
        locationType: 'quarantine',
        active: true,
        createdAt: now,
      }
    );

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'platform.branch_created',
      entityType: 'branch',
      entityId: branch.id,
      correlationId,
      metadataJson: { name: branch.name, code: branch.code },
    });

    return branch;
  }

  return db.transaction(async (tx) => {
    const [branch] = await tx
      .insert(branches)
      .values({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId!,
        name: input.name.trim(),
        code: codeClean,
        timezone: context.timezone,
        openingHoursJson: { summary: input.openingHoursSummary },
        isDefault: false,
        active: true,
      })
      .returning();

    const [dept] = await tx
      .insert(departments)
      .values({
        tenantId: context.tenantId,
        branchId: branch.id,
        name: `${branch.name} General`,
        domain: 'shared',
        active: true,
      })
      .returning();

    await tx.insert(counters).values({
      tenantId: context.tenantId,
      branchId: branch.id,
      departmentId: dept.id,
      name: `${branch.name} Counter 1`,
      code: `${codeClean}-1`,
      active: true,
    });

    await tx.insert(storageLocations).values([
      {
        tenantId: context.tenantId,
        branchId: branch.id,
        code: `${codeClean}-DISP`,
        name: `${branch.name} Dispensary`,
        locationType: 'dispensary',
        active: true,
      },
      {
        tenantId: context.tenantId,
        branchId: branch.id,
        code: `${codeClean}-QUAR`,
        name: `${branch.name} Quarantine Cage`,
        locationType: 'quarantine',
        active: true,
      },
    ]);

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'platform.branch_created',
      entityType: 'branch',
      entityId: branch.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { name: branch.name, code: branch.code },
    });

    return branch;
  });
}

// ---------------------------------------------------------------------------
// 3. Staff Invites & Role / Branch Management
// ---------------------------------------------------------------------------
export async function listStaffInvites(context: ActiveWorkspaceContext) {
  assertPermission(context, 'team.manage_stepup');
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.staffInvites
      .filter((i) => i.tenantId === context.tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return db
    .select()
    .from(staffInvites)
    .where(eq(staffInvites.tenantId, context.tenantId))
    .orderBy(desc(staffInvites.createdAt));
}

export async function createStaffInvite(
  context: ActiveWorkspaceContext,
  input: CreateStaffInviteInput,
  correlationId: string
) {
  assertPermission(context, 'team.manage_stepup');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);
  await assertWithinQuota(context, 'staff');

  const emailNorm = input.email.trim().toLowerCase();
  const token = `inv_${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const branch = store.branches.find(
      (b) => b.tenantId === context.tenantId && b.id === input.branchId
    );
    if (!branch) throw new NotFoundError('Branch not found');

    const invite = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: input.branchId,
      email: emailNorm,
      displayName: input.displayName.trim() || emailNorm.split('@')[0],
      role: input.role,
      inviteToken: token,
      status: 'pending' as const,
      invitedByUserId: context.userId,
      expiresAt,
      createdAt: now,
    };
    store.staffInvites.unshift(invite);

    // If user already exists in memory registry, leave pending until accepted or let accept endpoint link
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'team.staff_invite_created',
      entityType: 'staff_invite',
      entityId: invite.id,
      correlationId,
      metadataJson: { email: emailNorm, role: input.role, branchId: input.branchId },
    });

    return invite;
  }

  const [created] = await db
    .insert(staffInvites)
    .values({
      tenantId: context.tenantId,
      branchId: input.branchId,
      email: emailNorm,
      displayName: input.displayName.trim() || emailNorm.split('@')[0],
      role: input.role,
      inviteToken: token,
      status: 'pending',
      invitedByUserId: context.userId,
      expiresAt,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'team.staff_invite_created',
    entityType: 'staff_invite',
    entityId: created.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: { email: emailNorm, role: input.role, branchId: input.branchId },
  });

  return created;
}

export async function acceptStaffInvite(
  authUser: AuthenticatedUser,
  inviteToken: string,
  correlationId: string
) {
  const now = new Date();
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const inv = store.staffInvites.find((i) => i.inviteToken === inviteToken);
    if (!inv) throw new NotFoundError('Staff invite not found');
    if (inv.status !== 'pending') throw new ConflictError(`Invite is already ${inv.status}`);
    if (inv.expiresAt.getTime() < now.getTime()) throw new ConflictError('Invite has expired');

    const existingMem = store.memberships.find(
      (m) => m.tenantId === inv.tenantId && m.userId === authUser.id && m.active
    );
    if (!existingMem) {
      store.memberships.push({
        id: crypto.randomUUID(),
        tenantId: inv.tenantId,
        branchId: inv.branchId,
        userId: authUser.id,
        role: inv.role,
        active: true,
        revokedAt: null,
        createdAt: now,
      });
    }
    inv.status = 'accepted';

    addMemAuditEvent({
      tenantId: inv.tenantId,
      actorUserId: authUser.id,
      actorUid: authUser.uid,
      action: 'team.staff_invite_accepted',
      entityType: 'staff_invite',
      entityId: inv.id,
      correlationId,
      metadataJson: { email: authUser.email, role: inv.role },
    });

    return { accepted: true, tenantId: inv.tenantId, role: inv.role };
  }

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(staffInvites)
      .where(eq(staffInvites.inviteToken, inviteToken))
      .limit(1);
    if (!inv) throw new NotFoundError('Staff invite not found');
    if (inv.status !== 'pending') throw new ConflictError(`Invite is already ${inv.status}`);
    if (inv.expiresAt.getTime() < now.getTime()) throw new ConflictError('Invite has expired');

    const existing = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, inv.tenantId),
          eq(memberships.userId, authUser.id),
          eq(memberships.active, true)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await tx.insert(memberships).values({
        tenantId: inv.tenantId,
        branchId: inv.branchId,
        userId: authUser.id,
        role: inv.role,
        active: true,
      });
    }

    await tx
      .update(staffInvites)
      .set({ status: 'accepted' })
      .where(eq(staffInvites.id, inv.id));

    await tx.insert(auditEvents).values({
      tenantId: inv.tenantId,
      actorUserId: authUser.id,
      actorUid: authUser.uid,
      action: 'team.staff_invite_accepted',
      entityType: 'staff_invite',
      entityId: inv.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { email: authUser.email, role: inv.role },
    });

    return { accepted: true, tenantId: inv.tenantId, role: inv.role };
  });
}

export async function revokeStaffInvite(
  context: ActiveWorkspaceContext,
  inviteId: string,
  correlationId: string
) {
  assertPermission(context, 'team.manage_stepup');
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const inv = store.staffInvites.find(
      (i) => i.id === inviteId && i.tenantId === context.tenantId
    );
    if (!inv) throw new NotFoundError('Invite not found');
    inv.status = 'revoked';
    return inv;
  }

  const [updated] = await db
    .update(staffInvites)
    .set({ status: 'revoked' })
    .where(and(eq(staffInvites.id, inviteId), eq(staffInvites.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Invite not found');
  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'team.invite_revoked',
    entityType: 'staff_invite',
    entityId: inviteId,
    inputSource: 'ui',
    correlationId,
  });
  return updated;
}

export async function updateMemberRoleOrBranch(
  context: ActiveWorkspaceContext,
  membershipId: string,
  patch: { role?: Role; branchId?: string; active?: boolean },
  correlationId: string
) {
  assertPermission(context, 'team.manage_stepup');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const mem = store.memberships.find(
      (m) => m.id === membershipId && m.tenantId === context.tenantId
    );
    if (!mem) throw new NotFoundError('Membership not found');
    if (patch.branchId) {
      const br = store.branches.find(
        (b) => b.id === patch.branchId && b.tenantId === context.tenantId
      );
      if (!br) throw new NotFoundError('Branch not found');
      mem.branchId = br.id;
    }
    if (patch.role) mem.role = patch.role;
    if (patch.active !== undefined) {
      mem.active = patch.active;
      mem.revokedAt = patch.active ? null : new Date();
    }
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'team.membership_updated',
      entityType: 'membership',
      entityId: mem.id,
      correlationId,
      metadataJson: patch as Record<string, unknown>,
    });
    return mem;
  }

  if (patch.branchId) {
    const [br] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, patch.branchId), eq(branches.tenantId, context.tenantId)))
      .limit(1);
    if (!br) throw new NotFoundError('Branch not found');
  }

  const [updated] = await db
    .update(memberships)
    .set({
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.branchId ? { branchId: patch.branchId } : {}),
      ...(patch.active !== undefined
        ? { active: patch.active, revokedAt: patch.active ? null : new Date() }
        : {}),
    })
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, context.tenantId)))
    .returning();

  if (!updated) throw new NotFoundError('Membership not found');

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'team.membership_updated',
    entityType: 'membership',
    entityId: updated.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: patch as Record<string, unknown>,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// 4. Quick Shift Lock Screen PIN (4-6 digit)
// ---------------------------------------------------------------------------
export async function setStaffShiftPin(
  context: ActiveWorkspaceContext,
  pin: string,
  correlationId: string
) {
  const { salt, hash } = hashPin(pin);
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existing = store.staffShiftPins.find(
      (p) => p.tenantId === context.tenantId && p.userId === context.userId
    );
    if (existing) {
      existing.pinSalt = salt;
      existing.pinHash = hash;
      existing.branchId = context.branchId;
      existing.updatedAt = now;
    } else {
      store.staffShiftPins.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        userId: context.userId,
        branchId: context.branchId,
        pinSalt: salt,
        pinHash: hash,
        updatedAt: now,
      });
    }
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'team.shift_pin_set',
      entityType: 'user',
      entityId: String(context.userId),
      correlationId,
      metadataJson: {},
    });
    return { configured: true };
  }

  const [existing] = await db
    .select()
    .from(staffShiftPins)
    .where(and(eq(staffShiftPins.tenantId, context.tenantId), eq(staffShiftPins.userId, context.userId)))
    .limit(1);

  if (existing) {
    await db
      .update(staffShiftPins)
      .set({ pinSalt: salt, pinHash: hash, branchId: context.branchId, updatedAt: now })
      .where(eq(staffShiftPins.id, existing.id));
  } else {
    await db.insert(staffShiftPins).values({
      tenantId: context.tenantId,
      userId: context.userId,
      branchId: context.branchId,
      pinSalt: salt,
      pinHash: hash,
    });
  }

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'team.shift_pin_set',
    entityType: 'user',
    entityId: String(context.userId),
    inputSource: 'ui',
    correlationId,
    metadataJson: {},
  });

  return { configured: true };
}

export async function verifyStaffShiftPin(
  context: ActiveWorkspaceContext,
  pin: string,
  correlationId: string
) {
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const pins = store.staffShiftPins.filter((p) => p.tenantId === context.tenantId);
    const matched = pins.find((p) => verifyPinHash(pin, p.pinSalt, p.pinHash));
    if (!matched) {
      throw new ForbiddenError('Invalid Shift PIN', 'INVALID_SHIFT_PIN');
    }
    const member = store.memberships.find(
      (m) => m.tenantId === context.tenantId && m.userId === matched.userId && m.active
    );
    if (!member) {
      throw new ForbiddenError('Staff membership is inactive or revoked', 'MEMBERSHIP_REVOKED');
    }
    const u = getMemoryUserById(matched.userId);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'team.shift_pin_unlocked',
      entityType: 'user',
      entityId: String(matched.userId),
      correlationId,
      metadataJson: { role: member.role },
    });
    return {
      verified: true,
      userId: matched.userId,
      displayName: u?.displayName ?? 'Staff Member',
      role: member.role,
    };
  }

  const pins = await db
    .select()
    .from(staffShiftPins)
    .where(eq(staffShiftPins.tenantId, context.tenantId));
  const matched = pins.find((p) => verifyPinHash(pin, p.pinSalt, p.pinHash));
  if (!matched) {
    throw new ForbiddenError('Invalid Shift PIN', 'INVALID_SHIFT_PIN');
  }
  const [mem] = await db
    .select({ role: memberships.role, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.tenantId, context.tenantId),
        eq(memberships.userId, matched.userId),
        eq(memberships.active, true)
      )
    )
    .limit(1);

  if (!mem) {
    throw new ForbiddenError('Staff membership is inactive or revoked', 'MEMBERSHIP_REVOKED');
  }

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'team.shift_pin_unlocked',
    entityType: 'user',
    entityId: String(matched.userId),
    inputSource: 'ui',
    correlationId,
    metadataJson: { role: mem.role },
  });

  return {
    verified: true,
    userId: matched.userId,
    displayName: mem.displayName,
    role: mem.role as Role,
  };
}
