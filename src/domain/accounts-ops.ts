import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  creditAccounts,
  creditEntries,
  operatingExpenses,
  supplierDebitNotes,
  supplierInvoices,
  supplierPayments,
  suppliers,
} from '../db/schema.ts';
import type {
  AccountsOverviewResponse,
  CreateCreditAccountInput,
  RecordCreditEntryInput,
  RecordOperatingExpenseInput,
  RecordSupplierPaymentInput,
} from '../contracts/departments.ts';
import { NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { getCombinedZReport } from './pharmacy-ops.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

function computeAgingBucket(oldestDateStr: string, todayStr: string): '0-30d' | '31-60d' | '60d+' {
  const a = new Date(`${oldestDateStr}T00:00:00Z`).getTime();
  const b = new Date(`${todayStr}T00:00:00Z`).getTime();
  const days = Math.max(0, Math.round((b - a) / 86_400_000));
  if (days <= 30) return '0-30d';
  if (days <= 60) return '31-60d';
  return '60d+';
}

export async function getAccountsOverview(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<AccountsOverviewResponse> {
  assertCapability(context, 'accounts.ledger');
  assertPermission(context, 'accounts.read');

  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);
  const zReport = await getCombinedZReport(context, businessDate);
  const hasClinic = Boolean(context.capabilities['appointments.manage']);
  const hasPharmacy = Boolean(
    context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']
  );

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();

    const expenses = store.operatingExpenses
      .filter(
        (e) =>
          e.tenantId === context.tenantId &&
          e.branchId === context.branchId &&
          e.expenseDate === businessDate
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const activeOpexMinor = expenses
      .filter((e) => e.status === 'posted')
      .reduce((acc, e) => acc + e.amountMinor, 0);

    const arAccounts = store.creditAccounts
      .filter((a) => a.tenantId === context.tenantId && a.branchId === context.branchId)
      .sort((a, b) => b.balanceMinor - a.balanceMinor);

    let ar0To30 = 0;
    let ar31To60 = 0;
    let ar60Plus = 0;

    const arItems = arAccounts.map((acc) => {
      const entries = store.creditEntries
        .filter((e) => e.tenantId === context.tenantId && e.creditAccountId === acc.id)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

      const oldestOpen = entries.find((e) => e.entryType === 'charge');
      const bucket =
        acc.balanceMinor <= 0
          ? '0-30d'
          : computeAgingBucket(
              (oldestOpen?.occurredAt ?? acc.createdAt).toISOString().slice(0, 10),
              businessDate
            );
      if (acc.balanceMinor > 0) {
        if (bucket === '0-30d') ar0To30 += acc.balanceMinor;
        else if (bucket === '31-60d') ar31To60 += acc.balanceMinor;
        else ar60Plus += acc.balanceMinor;
      }

      return {
        id: acc.id,
        accountName: acc.accountName,
        accountType: acc.accountType,
        phone: acc.phone,
        creditLimitMinor: acc.creditLimitMinor,
        balanceMinor: acc.balanceMinor,
        agingBucket: bucket,
        lastTransactionAt: acc.lastTransactionAt.toISOString(),
        recentEntries: entries.slice(0, 8).map((e) => ({
          id: e.id,
          entryType: e.entryType,
          amountMinor: e.amountMinor,
          method: e.method,
          referenceNo: e.referenceNo,
          dueDate: e.dueDate,
          notes: e.notes,
          occurredAt: e.occurredAt.toISOString(),
        })),
      };
    });

    // Supplier AP balances (invoices - debit notes - supplier payments)
    const tenantSuppliers = store.suppliers.filter((s) => s.tenantId === context.tenantId);
    let ap0To30 = 0;
    let ap31To60 = 0;
    let ap60Plus = 0;

    const supplierPayables = tenantSuppliers
      .map((sup) => {
        const invs = store.supplierInvoices.filter(
          (i) => i.tenantId === context.tenantId && i.supplierId === sup.id
        );
        const debits = store.supplierDebitNotes.filter(
          (d) => d.tenantId === context.tenantId && d.supplierId === sup.id
        );
        const pays = store.supplierPayments.filter(
          (p) => p.tenantId === context.tenantId && p.supplierId === sup.id
        );
        const totalInvoicedMinor = invs.reduce((s, i) => s + i.totalMinor, 0);
        const totalDebitNotesMinor = debits.reduce((s, d) => s + d.amountMinor, 0);
        const totalPaidMinor = pays.reduce((s, p) => s + p.amountMinor, 0);
        const outstandingMinor = Math.max(
          0,
          totalInvoicedMinor - totalDebitNotesMinor - totalPaidMinor
        );
        const oldestDate = invs[0]?.invoiceDate || businessDate;
        const bucket = outstandingMinor <= 0 ? '0-30d' : computeAgingBucket(oldestDate, businessDate);
        if (outstandingMinor > 0) {
          if (bucket === '0-30d') ap0To30 += outstandingMinor;
          else if (bucket === '31-60d') ap31To60 += outstandingMinor;
          else ap60Plus += outstandingMinor;
        }
        return {
          supplierId: sup.id,
          supplierName: sup.name,
          totalInvoicedMinor,
          totalDebitNotesMinor,
          totalPaidMinor,
          outstandingMinor,
          agingBucket: bucket,
        };
      })
      .sort((a, b) => b.outstandingMinor - a.outstandingMinor);

    const recentPayments = store.supplierPayments
      .filter((p) => p.tenantId === context.tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierName:
          store.suppliers.find((s) => s.id === p.supplierId)?.name ?? 'Supplier',
        amountMinor: p.amountMinor,
        method: p.method,
        referenceNo: p.referenceNo,
        paidDate: p.paidDate,
        notes: p.notes,
      }));

    const trueNetProfitMinor =
      zReport.clinic.clinicNetAfterPayoutMinor +
      zReport.pharmacy.grossProfitMinor -
      activeOpexMinor;

    return {
      businessDate,
      currency: context.currency,
      modeFlags: { hasClinic, hasPharmacy },
      dailyPnl: {
        clinicCollectionsMinor: zReport.clinic.netCollectionsMinor,
        doctorPayoutsMinor: zReport.clinic.doctorPayoutsMinor,
        clinicNetAfterDoctorMinor: zReport.clinic.clinicNetAfterPayoutMinor,
        pharmacyNetSalesMinor: zReport.pharmacy.netSalesMinor,
        pharmacyCogsMinor: zReport.pharmacy.estimatedCogsMinor,
        pharmacyGrossProfitMinor: zReport.pharmacy.grossProfitMinor,
        operatingExpensesMinor: activeOpexMinor,
        trueNetProfitMinor,
      },
      expenses: expenses.map((e) => ({
        id: e.id,
        expenseDate: e.expenseDate,
        category: e.category,
        description: e.description,
        amountMinor: e.amountMinor,
        paymentMethod: e.paymentMethod,
        referenceNo: e.referenceNo,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
      })),
      receivables: {
        totalOutstandingMinor: arItems.reduce((s, a) => s + a.balanceMinor, 0),
        aging: {
          current0To30Minor: ar0To30,
          days31To60Minor: ar31To60,
          days60PlusMinor: ar60Plus,
        },
        accounts: arItems,
      },
      payables: {
        totalPayableMinor: supplierPayables.reduce((s, p) => s + p.outstandingMinor, 0),
        aging: {
          current0To30Minor: ap0To30,
          days31To60Minor: ap31To60,
          days60PlusMinor: ap60Plus,
        },
        suppliers: supplierPayables,
        recentPayments,
      },
    };
  }

  // PostgreSQL branch
  const [expensesRows, arRows, entryRows, supRows, invRows, dnRows, payRows] = await Promise.all([
    db
      .select()
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.tenantId, context.tenantId),
          eq(operatingExpenses.branchId, context.branchId),
          eq(operatingExpenses.expenseDate, businessDate)
        )
      )
      .orderBy(desc(operatingExpenses.createdAt)),
    db
      .select()
      .from(creditAccounts)
      .where(
        and(
          eq(creditAccounts.tenantId, context.tenantId),
          eq(creditAccounts.branchId, context.branchId)
        )
      )
      .orderBy(desc(creditAccounts.balanceMinor)),
    db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.tenantId, context.tenantId))
      .orderBy(desc(creditEntries.occurredAt)),
    db.select().from(suppliers).where(eq(suppliers.tenantId, context.tenantId)),
    db.select().from(supplierInvoices).where(eq(supplierInvoices.tenantId, context.tenantId)),
    db.select().from(supplierDebitNotes).where(eq(supplierDebitNotes.tenantId, context.tenantId)),
    db
      .select()
      .from(supplierPayments)
      .where(eq(supplierPayments.tenantId, context.tenantId))
      .orderBy(desc(supplierPayments.createdAt)),
  ]);

  const activeOpexMinor = expensesRows
    .filter((e) => e.status === 'posted')
    .reduce((acc, e) => acc + e.amountMinor, 0);

  let ar0To30 = 0;
  let ar31To60 = 0;
  let ar60Plus = 0;
  const arItems = arRows.map((acc) => {
    const entries = entryRows.filter((e) => e.creditAccountId === acc.id);
    const oldest = entries.find((e) => e.entryType === 'charge');
    const bucket =
      acc.balanceMinor <= 0
        ? '0-30d'
        : computeAgingBucket(
            (oldest?.occurredAt ?? acc.createdAt).toISOString().slice(0, 10),
            businessDate
          );
    if (acc.balanceMinor > 0) {
      if (bucket === '0-30d') ar0To30 += acc.balanceMinor;
      else if (bucket === '31-60d') ar31To60 += acc.balanceMinor;
      else ar60Plus += acc.balanceMinor;
    }
    return {
      id: acc.id,
      accountName: acc.accountName,
      accountType: acc.accountType,
      phone: acc.phone,
      creditLimitMinor: acc.creditLimitMinor,
      balanceMinor: acc.balanceMinor,
      agingBucket: bucket,
      lastTransactionAt: acc.lastTransactionAt.toISOString(),
      recentEntries: entries.slice(0, 8).map((e) => ({
        id: e.id,
        entryType: e.entryType as 'charge' | 'payment',
        amountMinor: e.amountMinor,
        method: e.method,
        referenceNo: e.referenceNo,
        dueDate: e.dueDate,
        notes: e.notes,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  });

  let ap0To30 = 0;
  let ap31To60 = 0;
  let ap60Plus = 0;
  const supplierPayables = supRows
    .map((sup) => {
      const invs = invRows.filter((i) => i.supplierId === sup.id);
      const debits = dnRows.filter((d) => d.supplierId === sup.id);
      const pays = payRows.filter((p) => p.supplierId === sup.id);
      const totalInvoicedMinor = invs.reduce((s, i) => s + i.totalMinor, 0);
      const totalDebitNotesMinor = debits.reduce((s, d) => s + d.amountMinor, 0);
      const totalPaidMinor = pays.reduce((s, p) => s + p.amountMinor, 0);
      const outstandingMinor = Math.max(0, totalInvoicedMinor - totalDebitNotesMinor - totalPaidMinor);
      const oldestDate = invs[0]?.invoiceDate || businessDate;
      const bucket = outstandingMinor <= 0 ? '0-30d' : computeAgingBucket(oldestDate, businessDate);
      if (outstandingMinor > 0) {
        if (bucket === '0-30d') ap0To30 += outstandingMinor;
        else if (bucket === '31-60d') ap31To60 += outstandingMinor;
        else ap60Plus += outstandingMinor;
      }
      return {
        supplierId: sup.id,
        supplierName: sup.name,
        totalInvoicedMinor,
        totalDebitNotesMinor,
        totalPaidMinor,
        outstandingMinor,
        agingBucket: bucket,
      };
    })
    .sort((a, b) => b.outstandingMinor - a.outstandingMinor);

  const trueNetProfitMinor =
    zReport.clinic.clinicNetAfterPayoutMinor +
    zReport.pharmacy.grossProfitMinor -
    activeOpexMinor;

  return {
    businessDate,
    currency: context.currency,
    modeFlags: { hasClinic, hasPharmacy },
    dailyPnl: {
      clinicCollectionsMinor: zReport.clinic.netCollectionsMinor,
      doctorPayoutsMinor: zReport.clinic.doctorPayoutsMinor,
      clinicNetAfterDoctorMinor: zReport.clinic.clinicNetAfterPayoutMinor,
      pharmacyNetSalesMinor: zReport.pharmacy.netSalesMinor,
      pharmacyCogsMinor: zReport.pharmacy.estimatedCogsMinor,
      pharmacyGrossProfitMinor: zReport.pharmacy.grossProfitMinor,
      operatingExpensesMinor: activeOpexMinor,
      trueNetProfitMinor,
    },
    expenses: expensesRows.map((e) => ({
      id: e.id,
      expenseDate: e.expenseDate,
      category: e.category,
      description: e.description,
      amountMinor: e.amountMinor,
      paymentMethod: e.paymentMethod,
      referenceNo: e.referenceNo,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    })),
    receivables: {
      totalOutstandingMinor: arItems.reduce((s, a) => s + a.balanceMinor, 0),
      aging: { current0To30Minor: ar0To30, days31To60Minor: ar31To60, days60PlusMinor: ar60Plus },
      accounts: arItems,
    },
    payables: {
      totalPayableMinor: supplierPayables.reduce((s, p) => s + p.outstandingMinor, 0),
      aging: { current0To30Minor: ap0To30, days31To60Minor: ap31To60, days60PlusMinor: ap60Plus },
      suppliers: supplierPayables,
      recentPayments: payRows.slice(0, 12).map((p) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierName: supRows.find((s) => s.id === p.supplierId)?.name ?? 'Supplier',
        amountMinor: p.amountMinor,
        method: p.method,
        referenceNo: p.referenceNo,
        paidDate: p.paidDate,
        notes: p.notes,
      })),
    },
  };
}

export async function recordOperatingExpense(
  context: ActiveWorkspaceContext,
  input: RecordOperatingExpenseInput,
  correlationId: string
) {
  assertCapability(context, 'accounts.ledger');
  assertPermission(context, 'accounts.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const expenseDate = input.expenseDate || getBusinessDateInTimezone(context.timezone);
  const amountMinor = Math.round(input.amountLkr * 100);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const record = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      expenseDate,
      category: input.category,
      description: input.description,
      amountMinor,
      paymentMethod: input.paymentMethod,
      referenceNo: input.referenceNo,
      status: 'posted' as const,
      recordedByUserId: context.userId,
      createdAt: new Date(),
    };
    store.operatingExpenses.unshift(record);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'accounts.expense_recorded',
      entityType: 'operating_expense',
      entityId: record.id,
      correlationId,
      metadataJson: { category: input.category, amountMinor, expenseDate },
    });
    return { expense: record };
  }

  const [created] = await db
    .insert(operatingExpenses)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      expenseDate,
      category: input.category,
      description: input.description,
      amountMinor,
      paymentMethod: input.paymentMethod,
      referenceNo: input.referenceNo,
      status: 'posted',
      recordedByUserId: context.userId,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'accounts.expense_recorded',
    entityType: 'operating_expense',
    entityId: created.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: { category: input.category, amountMinor, expenseDate },
  });

  return { expense: created };
}

export async function voidOperatingExpense(
  context: ActiveWorkspaceContext,
  expenseId: string,
  correlationId: string
) {
  assertCapability(context, 'accounts.ledger');
  assertPermission(context, 'accounts.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const item = store.operatingExpenses.find(
      (e) => e.id === expenseId && e.tenantId === context.tenantId
    );
    if (!item) throw new NotFoundError('Operating expense not found');
    item.status = 'voided';
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'accounts.expense_voided',
      entityType: 'operating_expense',
      entityId: expenseId,
      correlationId,
    });
    return { expense: item };
  }

  const [updated] = await db
    .update(operatingExpenses)
    .set({ status: 'voided' })
    .where(and(eq(operatingExpenses.id, expenseId), eq(operatingExpenses.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Operating expense not found');
  return { expense: updated };
}

export async function createReceivableAccount(
  context: ActiveWorkspaceContext,
  input: CreateCreditAccountInput,
  correlationId: string
) {
  assertCapability(context, 'accounts.ledger');
  assertPermission(context, 'accounts.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const creditLimitMinor = Math.round(input.creditLimitLkr * 100);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const acc = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: input.personId ?? null,
      accountName: input.accountName,
      accountType: input.accountType,
      phone: input.phone,
      creditLimitMinor,
      balanceMinor: 0,
      lastTransactionAt: new Date(),
      createdAt: new Date(),
    };
    store.creditAccounts.unshift(acc);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'accounts.credit_account_created',
      entityType: 'credit_account',
      entityId: acc.id,
      correlationId,
      metadataJson: { accountName: acc.accountName, creditLimitMinor },
    });
    return { account: acc };
  }

  const [created] = await db
    .insert(creditAccounts)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: input.personId ?? null,
      accountName: input.accountName,
      accountType: input.accountType,
      phone: input.phone,
      creditLimitMinor,
      balanceMinor: 0,
    })
    .returning();

  return { account: created };
}

export async function recordReceivableEntry(
  context: ActiveWorkspaceContext,
  accountId: string,
  input: RecordCreditEntryInput,
  correlationId: string
) {
  assertCapability(context, 'accounts.ledger');
  assertPermission(context, 'accounts.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const amountMinor = Math.round(input.amountLkr * 100);
  const businessDate = getBusinessDateInTimezone(context.timezone);
  const dueDate = input.dueDate || businessDate;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const acc = store.creditAccounts.find(
      (a) => a.id === accountId && a.tenantId === context.tenantId
    );
    if (!acc) throw new NotFoundError('Credit account not found');

    if (input.entryType === 'charge' && acc.balanceMinor + amountMinor > acc.creditLimitMinor) {
      throw new ValidationError('Credit charge exceeds account credit limit');
    }

    const nextBalance =
      input.entryType === 'charge'
        ? acc.balanceMinor + amountMinor
        : Math.max(0, acc.balanceMinor - amountMinor);
    acc.balanceMinor = nextBalance;
    acc.lastTransactionAt = new Date();

    const entry = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      creditAccountId: acc.id,
      entryType: input.entryType,
      amountMinor,
      method: input.method,
      referenceNo: input.referenceNo,
      dueDate,
      notes: input.notes,
      recordedByUserId: context.userId,
      occurredAt: new Date(),
    };
    store.creditEntries.unshift(entry);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `accounts.credit_${input.entryType}`,
      entityType: 'credit_account',
      entityId: acc.id,
      correlationId,
      metadataJson: { amountMinor, nextBalance },
    });
    return { account: acc, entry };
  }

  return db.transaction(async (tx) => {
    const [acc] = await tx
      .select()
      .from(creditAccounts)
      .where(and(eq(creditAccounts.id, accountId), eq(creditAccounts.tenantId, context.tenantId)))
      .limit(1);
    if (!acc) throw new NotFoundError('Credit account not found');

    if (input.entryType === 'charge' && acc.balanceMinor + amountMinor > acc.creditLimitMinor) {
      throw new ValidationError('Credit charge exceeds account credit limit');
    }

    const nextBalance =
      input.entryType === 'charge'
        ? acc.balanceMinor + amountMinor
        : Math.max(0, acc.balanceMinor - amountMinor);

    const [updatedAcc] = await tx
      .update(creditAccounts)
      .set({ balanceMinor: nextBalance, lastTransactionAt: new Date() })
      .where(eq(creditAccounts.id, acc.id))
      .returning();

    const [entry] = await tx
      .insert(creditEntries)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        creditAccountId: acc.id,
        entryType: input.entryType,
        amountMinor,
        method: input.method,
        referenceNo: input.referenceNo,
        dueDate,
        notes: input.notes,
        recordedByUserId: context.userId,
      })
      .returning();

    return { account: updatedAcc, entry };
  });
}

export async function recordSupplierPayment(
  context: ActiveWorkspaceContext,
  input: RecordSupplierPaymentInput,
  correlationId: string
) {
  assertCapability(context, 'accounts.ledger');
  assertPermission(context, 'accounts.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const amountMinor = Math.round(input.amountLkr * 100);
  const paidDate = input.paidDate || getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const sup = store.suppliers.find(
      (s) => s.id === input.supplierId && s.tenantId === context.tenantId
    );
    if (!sup) throw new NotFoundError('Supplier not found');

    const payment = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      supplierId: sup.id,
      supplierInvoiceId: input.supplierInvoiceId ?? null,
      amountMinor,
      method: input.method,
      referenceNo: input.referenceNo,
      paidDate,
      notes: input.notes,
      recordedByUserId: context.userId,
      createdAt: new Date(),
    };
    store.supplierPayments.unshift(payment);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'accounts.supplier_payment_recorded',
      entityType: 'supplier_payment',
      entityId: payment.id,
      correlationId,
      metadataJson: { supplierId: sup.id, amountMinor, method: input.method },
    });
    return { payment };
  }

  const [created] = await db
    .insert(supplierPayments)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      supplierId: input.supplierId,
      supplierInvoiceId: input.supplierInvoiceId ?? null,
      amountMinor,
      method: input.method,
      referenceNo: input.referenceNo,
      paidDate,
      notes: input.notes,
      recordedByUserId: context.userId,
    })
    .returning();

  return { payment: created };
}
