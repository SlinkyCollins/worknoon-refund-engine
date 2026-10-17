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

export const customerMessageFallbacks: Record<FinalStatus, string> = {
  APPROVED:
    "Your refund request has been approved. The refund has not necessarily been completed or paid out yet.",
  DENIED: "Your refund request has been denied based on the applicable refund policy.",
  ESCALATED:
    "Your request has been escalated to our support team for human review. A final decision is pending.",
};

function containsApprovalLanguage(message: string): boolean {
  return /\bapprove(?:d|s|d)?\b|\bapproval\b|\bapproving\b/i.test(message);
}

function containsDenialLanguage(message: string): boolean {
  return /\bden(?:y|ied|ies|ial)\b|\breject(?:ed|s|ion)?\b|\brefus(?:e|ed|al)\b/i.test(message);
}

function containsEscalationLanguage(message: string): boolean {
  return /\bescalat(?:e|ed|ion|ing)\b|\bhuman review\b|\bsupport review\b|\bmanual review\b/i.test(
    message,
  );
}

/**
 * Keeps customer-facing wording aligned with the status synthesized by this module.
 * Uncertain or contradictory AI wording is replaced with an application-owned message.
 */
export function validateCustomerMessage(
  status: FinalStatus,
  proposedMessage: string | null | undefined,
): string {
  if (typeof proposedMessage !== "string") {
    return customerMessageFallbacks[status];
  }

  const message = proposedMessage.trim();
  if (!message || message.length > 1_000) {
    return customerMessageFallbacks[status];
  }

  const approval = containsApprovalLanguage(message);
  const denial = containsDenialLanguage(message);
  const escalation = containsEscalationLanguage(message);
  const pending = /\bpending\b|\bunder review\b|\bawait(?:s|ing)\b/i.test(message);
  const alreadyPaid = /\b(?:already|successfully|has been|was)\s+(?:refunded|paid out|paid|issued|completed)\b|\brefund(?:ed)?\s+(?:has been|was)\s+(?:completed|paid|issued)\b/i.test(
    message,
  );

  if (status === "APPROVED") {
    if (
      approval &&
      !/\bnot\s+(?:been\s+)?approved\b|\bnever\s+approved\b|\bwasn['’]?t\s+approved\b/i.test(
        message,
      ) &&
      !denial &&
      !escalation &&
      !pending &&
      !alreadyPaid
    ) {
      return message;
    }
  }

  if (status === "DENIED") {
    if (denial && !approval && !escalation && !pending) {
      return message;
    }
  }

  if (status === "ESCALATED") {
    if (escalation && pending && !approval && !denial) {
      return message;
    }
  }

  return customerMessageFallbacks[status];
}

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
      customerMessage: validateCustomerMessage(
        policyEvaluation.hardDecision,
        buildHardDecisionMessage(policyEvaluation),
      ),
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
      customerMessage: validateCustomerMessage("ESCALATED", undefined),
      policyEvaluation,
      aiAnalysis: null,
    };
  }

  // The AI can flag suspicious/conflicting content (e.g. prompt-injection attempts),
  // but it can never DENY — the worst it can trigger is ESCALATED.
  if (aiAnalysis.suspicious) {
    const customerMessage = validateCustomerMessage("ESCALATED", aiAnalysis.customerMessage);

    return {
      status: "ESCALATED",
      rulesTriggered: [...policyEvaluation.rulesTriggered, "AI_FLAGGED_SUSPICIOUS"],
      aiReasoning: aiAnalysis.reasoning,
      customerMessage,
      policyEvaluation,
      aiAnalysis,
    };
  }

  const customerMessage = validateCustomerMessage("APPROVED", aiAnalysis.customerMessage);

  return {
    status: "APPROVED",
    rulesTriggered: [...policyEvaluation.rulesTriggered],
    aiReasoning: aiAnalysis.reasoning,
    customerMessage,
    policyEvaluation,
    aiAnalysis,
  };
}