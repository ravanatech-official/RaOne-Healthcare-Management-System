import express from 'express';
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
