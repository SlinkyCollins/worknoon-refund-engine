import "dotenv/config";
import { PrismaClient, type RefundReasonCategory } from "@prisma/client";
import {
  evaluateRefund,
  type PolicyEvaluation,
  type PolicyOrder,
  type PolicyRule,
} from "./policyEngine.js";
import {
  analyzeRefundRequest,
  AiServiceError,
  type AiAnalysis,
  type AiCustomerContext,
  type AiOrderContext,
} from "./aiService.js";

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} was not found`);
    this.name = "OrderNotFoundError";
  }
}

/** Rules the orchestrator can attach on top of whatever policyEngine already found. */
export type OrchestratorRule = PolicyRule | "AI_FLAGGED_SUSPICIOUS" | "AI_ANALYSIS_FAILED";

export type FinalStatus = "APPROVED" | "DENIED" | "ESCALATED";

export type OrchestrateRefundInput = {
  orderId: string;
  reasonCategory: RefundReasonCategory;
  customerStatement: string;
};

export type OrchestrateRefundResult = {
  status: FinalStatus;
  rulesTriggered: OrchestratorRule[];
  aiReasoning: string;
  customerMessage: string;
  policyEvaluation: PolicyEvaluation;
  aiAnalysis: AiAnalysis | null;
};

/** The exact shape we select from Prisma — matches PolicyOrder + AiOrderContext needs. */
const orderSelect = {
  id: true,
  orderNumber: true,
  totalAmount: true,
  isFinalSale: true,
  status: true,
  purchaseDate: true,
  deliveredDate: true,
  customer: {
    select: { id: true, name: true, email: true },
  },
  items: {
    select: {
      id: true,
      productName: true,
      sku: true,
      unitPrice: true,
      quantity: true,
      isFinalSale: true,
    },
  },
} as const;

export type OrchestratorOrder = PolicyOrder &
  Omit<AiOrderContext, keyof PolicyOrder> & {
    customer: AiCustomerContext;
    items: AiOrderContext["items"];
  };

/** Narrow surface of PrismaClient this module actually needs — makes it mockable in tests. */
export type OrchestratorPrismaClient = {
  order: {
    findUnique: (args: {
      where: { id: string };
      select: typeof orderSelect;
    }) => Promise<OrchestratorOrder | null>;
  };
};

export type OrchestrateRefundDependencies = {
  prisma?: OrchestratorPrismaClient;
  analyze?: typeof analyzeRefundRequest;
  now?: Date;
};

let sharedPrisma: PrismaClient | undefined;

function getSharedPrisma(): OrchestratorPrismaClient {
  if (!sharedPrisma) {
    sharedPrisma = new PrismaClient();
  }
  return sharedPrisma as unknown as OrchestratorPrismaClient;
}

function buildHardDecisionMessage(evaluation: PolicyEvaluation): string {
  if (evaluation.rulesTriggered.includes("FINAL_SALE")) {
    return "This request is denied because the item was marked final sale.";
  }
  if (evaluation.rulesTriggered.includes("REFUND_WINDOW_EXPIRED")) {
    return "This request is denied because the order is outside the 30-day refund window.";
  }
  if (evaluation.rulesTriggered.includes("REFUND_AMOUNT_OVER_LIMIT")) {
    return "Your request has been escalated for human review because of the order value.";
  }
  return evaluation.policySummary;
}

/**
 * Fetches the order/customer, runs the deterministic policy engine, and — only
 * when the policy engine says the request is eligible — calls the AI service.
 * The final status is always synthesized here, never handed directly from the AI.
 */
export async function orchestrateRefund(
  input: OrchestrateRefundInput,
  dependencies: OrchestrateRefundDependencies = {},
): Promise<OrchestrateRefundResult> {
  const prisma = dependencies.prisma ?? getSharedPrisma();
  const analyze = dependencies.analyze ?? analyzeRefundRequest;
  const now = dependencies.now ?? new Date();

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: orderSelect,
  });

  if (!order) {
    throw new OrderNotFoundError(input.orderId);
  }

  const policyEvaluation = evaluateRefund(
    {
      order,
      customer: order.customer,
      reasonCategory: input.reasonCategory,
      customerStatement: input.customerStatement,
    },
    now,
  );

  // Hard rules tripped — short-circuit. The AI is never consulted.
  if (policyEvaluation.hardDecision === "DENIED" || policyEvaluation.hardDecision === "ESCALATED") {
    return {
      status: policyEvaluation.hardDecision,
      rulesTriggered: [...policyEvaluation.rulesTriggered],
      aiReasoning: policyEvaluation.policySummary,
      customerMessage: buildHardDecisionMessage(policyEvaluation),
      policyEvaluation,
      aiAnalysis: null,
    };
  }

  // Eligible for AI review.
  let aiAnalysis: AiAnalysis;
  try {
    aiAnalysis = await analyze({
      customer: order.customer,
      order,
      reasonCategory: input.reasonCategory,
      customerStatement: input.customerStatement,
      policyEvaluation,
    });
  } catch (error) {
    // Fail safe: if the AI layer errors out, we never default to APPROVED.
    // The request is escalated to a human instead.
    return {
      status: "ESCALATED",
      rulesTriggered: [...policyEvaluation.rulesTriggered, "AI_ANALYSIS_FAILED"],
      aiReasoning:
        error instanceof AiServiceError
          ? error.message
          : "AI analysis failed unexpectedly.",
      customerMessage:
        "Your request has been escalated for manual review because we couldn't complete automated analysis.",
      policyEvaluation,
      aiAnalysis: null,
    };
  }

  // The AI can flag suspicious/conflicting content (e.g. prompt-injection attempts),
  // but it can never DENY — the worst it can trigger is ESCALATED.
  if (aiAnalysis.suspicious) {
    return {
      status: "ESCALATED",
      rulesTriggered: [...policyEvaluation.rulesTriggered, "AI_FLAGGED_SUSPICIOUS"],
      aiReasoning: aiAnalysis.reasoning,
      customerMessage: aiAnalysis.customerMessage,
      policyEvaluation,
      aiAnalysis,
    };
  }

  return {
    status: "APPROVED",
    rulesTriggered: [...policyEvaluation.rulesTriggered],
    aiReasoning: aiAnalysis.reasoning,
    customerMessage: aiAnalysis.customerMessage,
    policyEvaluation,
    aiAnalysis,
  };
}