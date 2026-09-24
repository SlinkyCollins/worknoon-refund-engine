import "dotenv/config";
import { PrismaClient, type DecisionStatus, type RefundReasonCategory } from "@prisma/client";
import { OrderNotFoundError } from "./refundOrchestrator.js";

export type DecisionPayload = {
  status: DecisionStatus;
  rulesTriggered?: readonly string[] | string[];
  aiReasoning?: string;
  customerMessage?: string;
};

export type PersistRefundDecisionInput = {
  orderId: string;
  customerId?: string;
  reasonCategory: RefundReasonCategory;
  customerStatement: string;
  decision?: DecisionPayload;
  status?: DecisionStatus;
  rulesTriggered?: readonly string[] | string[];
  aiReasoning?: string;
  customerMessage?: string;
};

export type PersistedAuditLog = {
  id: string;
  refundRequestId: string;
  decision: DecisionStatus;
  rulesTriggered: string[];
  aiReasoning: string;
  customerMessage: string;
  createdAt: Date;
};

export type PersistedRefundRecord = {
  id: string;
  orderId: string;
  customerId: string;
  reasonCategory: RefundReasonCategory;
  customerStatement: string;
  status: DecisionStatus;
  createdAt: Date;
  auditLog: PersistedAuditLog | null;
};

export type PersistencePrismaClient = {
  order?: {
    findUnique: (args: {
      where: { id: string };
      select: { customerId: true };
    }) => Promise<{ customerId: string } | null>;
  };
  refundRequest: {
    create: (args: {
      data: {
        orderId: string;
        customerId: string;
        reasonCategory: RefundReasonCategory;
        customerStatement: string;
        status: DecisionStatus;
        auditLog: {
          create: {
            decision: DecisionStatus;
            rulesTriggered: string[];
            aiReasoning: string;
            customerMessage: string;
          };
        };
      };
      include: {
        auditLog: true;
      };
    }) => Promise<PersistedRefundRecord>;
    findUnique?: (args: {
      where: { id: string };
      include: { auditLog: true };
    }) => Promise<PersistedRefundRecord | null>;
  };
};

export type PersistRefundDependencies = {
  prisma?: PersistencePrismaClient | PrismaClient;
};

let sharedPrisma: PrismaClient | undefined;

function getSharedPrisma(): PersistencePrismaClient {
  if (!sharedPrisma) {
    sharedPrisma = new PrismaClient();
  }
  return sharedPrisma as unknown as PersistencePrismaClient;
}

/**
 * Persists a refund decision by creating a RefundRequest and an associated AuditLog record.
 * If customerId is not provided, looks up customerId from the order.
 */
export async function persistRefundDecision(
  input: PersistRefundDecisionInput,
  dependencies: PersistRefundDependencies = {},
): Promise<PersistedRefundRecord> {
  const prisma = (dependencies.prisma ?? getSharedPrisma()) as unknown as PersistencePrismaClient;

  let customerId = input.customerId;
  if (!customerId) {
    if (!prisma.order) {
      throw new Error("Prisma client does not support order lookup to resolve customerId");
    }
    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: { customerId: true },
    });
    if (!order) {
      throw new OrderNotFoundError(input.orderId);
    }
    customerId = order.customerId;
  }

  const status = input.decision?.status ?? input.status;
  if (!status) {
    throw new Error("Decision status is required to persist a refund request");
  }

  const rulesTriggered = Array.from(input.decision?.rulesTriggered ?? input.rulesTriggered ?? []);
  const aiReasoning = input.decision?.aiReasoning ?? input.aiReasoning ?? "";
  const customerMessage = input.decision?.customerMessage ?? input.customerMessage ?? "";

  const record = await prisma.refundRequest.create({
    data: {
      orderId: input.orderId,
      customerId,
      reasonCategory: input.reasonCategory,
      customerStatement: input.customerStatement,
      status,
      auditLog: {
        create: {
          decision: status,
          rulesTriggered,
          aiReasoning,
          customerMessage,
        },
      },
    },
    include: {
      auditLog: true,
    },
  });

  return record;
}

/**
 * Retrieves a persisted refund request with its audit log by ID.
 */
export async function getRefundRequestWithAudit(
  id: string,
  dependencies: PersistRefundDependencies = {},
): Promise<PersistedRefundRecord | null> {
  const prisma = (dependencies.prisma ?? getSharedPrisma()) as unknown as PersistencePrismaClient;
  if (!prisma.refundRequest.findUnique) {
    throw new Error("findUnique is not implemented on the provided Prisma client");
  }
  return prisma.refundRequest.findUnique({
    where: { id },
    include: { auditLog: true },
  });
}
