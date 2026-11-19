import express from 'express';
import { z } from 'zod';
import {
  CreateBranchSchema,
  CreateStaffInviteSchema,
  RoleSchema,
  SetShiftPinSchema,
  VerifyShiftPinSchema,
} from '../contracts/api.ts';
import {
  CreateLegalEntitySchema,
  GrantProfessionalSchema,
  UpdateProductModeSchema,
} from '../contracts/pharmacy.ts';
import {
  MANDATORY_SAFETY_CAPABILITIES,
  PRODUCT_MODE_CAPABILITIES,
  createLegalEntity,
  grantProfessionalAuthority,
  listLegalEntities,
  listProfessionalGrants,
  revokeProfessionalAuthority,
  updateTenantProductMode,
} from '../domain/capabilities.ts';
import { ValidationError } from '../domain/errors.ts';
import {
  acceptStaffInvite,
  createStaffInvite,
  createWorkspaceBranch,
  listStaffInvites,
  listWorkspaceBranches,
  revokeStaffInvite,
  setStaffShiftPin,
  updateMemberRoleOrBranch,
  verifyStaffShiftPin,
} from '../domain/team-ops.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const platformRouter = express.Router();

platformRouter.use(requireAuth);

platformRouter.get('/capabilities', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    return res.json({
      productMode: context.productMode,
      capabilities: context.capabilities,
      mandatorySafetyCapabilities: MANDATORY_SAFETY_CAPABILITIES,
      modeManifest: PRODUCT_MODE_CAPABILITIES,
      correlationId,
    });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.patch('/capabilities', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = UpdateProductModeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid product mode update payload'
      );
    }
    const updated = await updateTenantProductMode(
      context,
      {
        productMode: parsed.data.productMode,
        extraCapabilities: parsed.data.extraCapabilities,
      },
      correlationId
    );
    return res.json({ ...updated, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.get('/legal-entities', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const entities = await listLegalEntities(context);
    return res.json({ legalEntities: entities, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.post('/legal-entities', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateLegalEntitySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid legal entity data');
    }
    const entity = await createLegalEntity(
      context,
      {
        name: parsed.data.name,
        registrationNumber: parsed.data.registrationNumber,
        taxId: parsed.data.taxId,
      },
      correlationId
    );
    return res.status(201).json({ legalEntity: entity, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.get('/grants', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const grants = await listProfessionalGrants(context);
    return res.json({ grants, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.post('/grants', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = GrantProfessionalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid grant payload');
    }
    const grant = await grantProfessionalAuthority(
      context,
      {
        userId: parsed.data.userId,
        grantType: parsed.data.grantType,
        licenseNumber: parsed.data.licenseNumber,
        expiresAt: parsed.data.expiresAt,
      },
      correlationId
    );
    return res.status(201).json({ grant, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.delete('/grants/:id', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const grant = await revokeProfessionalAuthority(context, String(req.params.id), correlationId);
    return res.json({ grant, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// Multi-Branch Scale
platformRouter.get('/branches', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const branches = await listWorkspaceBranches(context);
    return res.json({ branches, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.post('/branches', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateBranchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid branch payload');
    }
    const branch = await createWorkspaceBranch(context, parsed.data, correlationId);
    return res.status(201).json({ branch, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// Staff Invites & Membership Management
platformRouter.get('/invites', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const invites = await listStaffInvites(context);
    return res.json({ invites, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.post('/invites', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateStaffInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid invite payload');
    }
    const invite = await createStaffInvite(context, parsed.data, correlationId);
    return res.status(201).json({ invite, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.post('/invites/:token/accept', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const result = await acceptStaffInvite(req.authUser!, String(req.params.token), correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.delete('/invites/:id', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const invite = await revokeStaffInvite(context, String(req.params.id), correlationId);
    return res.json({ invite, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.patch('/team/:membershipId', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const schema = z.object({
      role: RoleSchema.optional(),
      branchId: z.string().min(4).optional(),
      active: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid membership update payload');
    }
    const membership = await updateMemberRoleOrBranch(
      context,
      String(req.params.membershipId),
      parsed.data,
      correlationId
    );
    return res.json({ membership, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// Quick Shift PIN Lock Screen
platformRouter.post('/shift-pin/set', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = SetShiftPinSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid Shift PIN format');
    }
    const result = await setStaffShiftPin(context, parsed.data.pin, correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

platformRouter.post('/shift-pin/verify', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = VerifyShiftPinSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid Shift PIN');
    }
    const result = await verifyStaffShiftPin(context, parsed.data.pin, correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});
