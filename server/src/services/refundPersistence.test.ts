import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionStatus, Prisma, RefundReasonCategory } from "@prisma/client";
import {
  persistRefundDecision,
  getRefundRequestWithAudit,
  type PersistencePrismaClient,
  type PersistedRefundRecord,
} from "./refundPersistence.js";
import {
  orchestrateRefund,
  OrderNotFoundError,
  type OrchestratorOrder,
  type OrchestratorPrismaClient,
} from "./refundOrchestrator.js";

type FakeStore = {
  orders: Map<string, { id: string; customerId: string }>;
  refundRequests: Map<string, PersistedRefundRecord>;
};

function createFakePrisma(initial?: Partial<FakeStore>): PersistencePrismaClient {
  const orders = initial?.orders ?? new Map<string, { id: string; customerId: string }>();
  const refundRequests = initial?.refundRequests ?? new Map<string, PersistedRefundRecord>();

  return {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return orders.get(where.id) ?? null;
      },
    },
    refundRequest: {
      create: async ({ data }: any) => {
        const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const auditLogId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date();

        const record: PersistedRefundRecord = {
          id,
          orderId: data.orderId,
          customerId: data.customerId,
          reasonCategory: data.reasonCategory,
          customerStatement: data.customerStatement,
          status: data.status,
          createdAt: now,
          auditLog: data.auditLog?.create
            ? {
                id: auditLogId,
                refundRequestId: id,
                decision: data.auditLog.create.decision,
                rulesTriggered: data.auditLog.create.rulesTriggered,
                aiReasoning: data.auditLog.create.aiReasoning,
                customerMessage: data.auditLog.create.customerMessage,
                createdAt: now,
              }
            : null,
        };

        refundRequests.set(id, record);
        return record;
      },
      findUnique: async ({ where }: { where: { id: string }; include: { auditLog: true } }) => {
        return refundRequests.get(where.id) ?? null;
      },
    },
  };
}

describe("refundPersistence", () => {
  it("persists a RefundRequest with nested AuditLog for an APPROVED decision", async () => {
    const prisma = createFakePrisma();

    const result = await persistRefundDecision(
      {
        orderId: "order-101",
        customerId: "customer-101",
        reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
        customerStatement: "The ceramic bowl arrived broken.",
        decision: {
          status: DecisionStatus.APPROVED,
          rulesTriggered: [],
          aiReasoning: "The customer reported physical damage with clear photo details.",
          customerMessage: "Your refund request has been approved.",
        },
      },
      { prisma },
    );

    assert.ok(result.id);
    assert.equal(result.orderId, "order-101");
    assert.equal(result.customerId, "customer-101");
    assert.equal(result.reasonCategory, RefundReasonCategory.DAMAGED_ITEM);
    assert.equal(result.customerStatement, "The ceramic bowl arrived broken.");
    assert.equal(result.status, DecisionStatus.APPROVED);
    assert.ok(result.createdAt instanceof Date);

    assert.ok(result.auditLog);
    assert.ok(result.auditLog?.id);
    assert.equal(result.auditLog?.refundRequestId, result.id);
    assert.equal(result.auditLog?.decision, DecisionStatus.APPROVED);
    assert.deepEqual(result.auditLog?.rulesTriggered, []);
    assert.equal(
      result.auditLog?.aiReasoning,
      "The customer reported physical damage with clear photo details.",
    );
    assert.equal(
      result.auditLog?.customerMessage,
      "Your refund request has been approved.",
    );
  });

  it("persists an ESCALATED decision with rulesTriggered and reasoning", async () => {
    const prisma = createFakePrisma();

    const result = await persistRefundDecision(
      {
        orderId: "order-202",
        customerId: "customer-202",
        reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
        customerStatement: "Item broken, please review immediately.",
        decision: {
          status: DecisionStatus.ESCALATED,
          rulesTriggered: ["REFUND_AMOUNT_OVER_LIMIT"],
          aiReasoning: "Order total exceeds $500 threshold requiring supervisor review.",
          customerMessage: "Your request has been escalated for manual review.",
        },
      },
      { prisma },
    );

    assert.equal(result.status, DecisionStatus.ESCALATED);
    assert.ok(result.auditLog);
    assert.equal(result.auditLog?.decision, DecisionStatus.ESCALATED);
    assert.deepEqual(result.auditLog?.rulesTriggered, ["REFUND_AMOUNT_OVER_LIMIT"]);
    assert.equal(
      result.auditLog?.aiReasoning,
      "Order total exceeds $500 threshold requiring supervisor review.",
    );
  });

  it("persists a DENIED decision with policy rules", async () => {
    const prisma = createFakePrisma();

    const result = await persistRefundDecision(
      {
        orderId: "order-303",
        customerId: "customer-303",
        reasonCategory: RefundReasonCategory.BUYERS_REMORSE,
        customerStatement: "I changed my mind.",
        decision: {
          status: DecisionStatus.DENIED,
          rulesTriggered: ["FINAL_SALE"],
          aiReasoning: "Items marked final sale cannot be refunded under company policy.",
          customerMessage: "This request is denied because the item was marked final sale.",
        },
      },
      { prisma },
    );

    assert.equal(result.status, DecisionStatus.DENIED);
    assert.ok(result.auditLog);
    assert.equal(result.auditLog?.decision, DecisionStatus.DENIED);
    assert.deepEqual(result.auditLog?.rulesTriggered, ["FINAL_SALE"]);
  });

  it("accepts flattened decision parameters", async () => {
    const prisma = createFakePrisma();

    const result = await persistRefundDecision(
      {
        orderId: "order-404",
        customerId: "customer-404",
        reasonCategory: RefundReasonCategory.INCORRECT_ITEM,
        customerStatement: "Received blue instead of red.",
        status: DecisionStatus.APPROVED,
        rulesTriggered: [],
        aiReasoning: "Wrong item delivered.",
        customerMessage: "Approved for incorrect item.",
      },
      { prisma },
    );

    assert.equal(result.status, DecisionStatus.APPROVED);
    assert.equal(result.auditLog?.customerMessage, "Approved for incorrect item.");
  });

  it("auto-resolves customerId when omitted by querying the order", async () => {
    const orders = new Map<string, { id: string; customerId: string }>([
      ["order-505", { id: "order-505", customerId: "resolved-customer-505" }],
    ]);
    const prisma = createFakePrisma({ orders });

    const result = await persistRefundDecision(
      {
        orderId: "order-505",
        reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
        customerStatement: "Package damaged in transit.",
        decision: {
          status: DecisionStatus.APPROVED,
          rulesTriggered: [],
          aiReasoning: "Legitimate damage.",
          customerMessage: "Approved.",
        },
      },
      { prisma },
    );

    assert.equal(result.customerId, "resolved-customer-505");
  });

  it("throws OrderNotFoundError when customerId is omitted and order does not exist", async () => {
    const prisma = createFakePrisma();

    await assert.rejects(
      persistRefundDecision(
        {
          orderId: "nonexistent-order",
          reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
          customerStatement: "Help!",
          decision: {
            status: DecisionStatus.DENIED,
            rulesTriggered: [],
            aiReasoning: "No order",
            customerMessage: "Not found",
          },
        },
        { prisma },
      ),
      (error: unknown) =>
        error instanceof OrderNotFoundError && error.message.includes("nonexistent-order"),
    );
  });

  it("throws an error when status is missing", async () => {
    const prisma = createFakePrisma();

    await assert.rejects(
      persistRefundDecision(
        {
          orderId: "order-606",
          customerId: "customer-606",
          reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
          customerStatement: "Missing status",
        } as any,
        { prisma },
      ),
      /decision status is required/i,
    );
  });

  it("allows retrieving the created refund request and audit log via getRefundRequestWithAudit", async () => {
    const prisma = createFakePrisma();

    const saved = await persistRefundDecision(
      {
        orderId: "order-707",
        customerId: "customer-707",
        reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
        customerStatement: "Broken screen.",
        decision: {
          status: DecisionStatus.APPROVED,
          rulesTriggered: [],
          aiReasoning: "Screen damage verified.",
          customerMessage: "Refund granted.",
        },
      },
      { prisma },
    );

    const retrieved = await getRefundRequestWithAudit(saved.id, { prisma });
    assert.ok(retrieved);
    assert.equal(retrieved?.id, saved.id);
    assert.equal(retrieved?.auditLog?.id, saved.auditLog?.id);
    assert.equal(retrieved?.auditLog?.decision, DecisionStatus.APPROVED);
  });

  it("seamlessly integrates with orchestrateRefund output", async () => {
    const mockOrder: OrchestratorOrder = {
      id: "order-pipe-1",
      orderNumber: "WN-PIPE-1",
      totalAmount: new Prisma.Decimal("120.00"),
      isFinalSale: false,
      status: "DELIVERED",
      purchaseDate: new Date("2026-09-20T12:00:00.000Z"),
      deliveredDate: new Date("2026-09-21T12:00:00.000Z"),
      customer: { id: "customer-pipe-1", name: "Pipeline User", email: "pipe@example.com" },
      items: [
        {
          id: "item-p1",
          productName: "Silk Scarf",
          sku: "WN-SCARF",
          unitPrice: new Prisma.Decimal("120.00"),
          quantity: 1,
          isFinalSale: false,
        },
      ],
    };

    const orchestratorPrisma: OrchestratorPrismaClient = {
      order: {
        findUnique: async () => mockOrder,
      },
    };

    const decision = await orchestrateRefund(
      {
        orderId: "order-pipe-1",
        reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
        customerStatement: "The silk scarf has a huge tear on delivery.",
      },
      {
        prisma: orchestratorPrisma,
        now: new Date("2026-09-22T12:00:00.000Z"),
        analyze: async () => ({
          classification: RefundReasonCategory.DAMAGED_ITEM,
          suspicious: false,
          reasoning: "Customer reported genuine product tear upon arrival.",
          customerMessage: "Your refund request has been approved.",
        }),
      },
    );

    const persistencePrisma = createFakePrisma({
      orders: new Map([["order-pipe-1", { id: "order-pipe-1", customerId: mockOrder.customer.id }]]),
    });

    const persisted = await persistRefundDecision(
      {
        orderId: "order-pipe-1",
        customerId: mockOrder.customer.id,
        reasonCategory: RefundReasonCategory.DAMAGED_ITEM,
        customerStatement: "The silk scarf has a huge tear on delivery.",
        decision,
      },
      { prisma: persistencePrisma },
    );

    assert.equal(persisted.status, DecisionStatus.APPROVED);
    assert.equal(persisted.auditLog?.decision, DecisionStatus.APPROVED);
    assert.equal(
      persisted.auditLog?.aiReasoning,
      "Customer reported genuine product tear upon arrival.",
    );
    assert.equal(
      persisted.auditLog?.customerMessage,
      "Your refund request has been approved.",
    );
  });
});
