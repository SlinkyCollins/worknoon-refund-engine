import { Prisma, type Customer, type Order, type OrderItem } from "@prisma/client";

export const REFUND_WINDOW_DAYS = 30;
export const REFUND_AMOUNT_LIMIT = new Prisma.Decimal("500.00");

export type PolicyRule =
  | "FINAL_SALE"
  | "REFUND_WINDOW_EXPIRED"
  | "REFUND_AMOUNT_OVER_LIMIT";

export type HardDecision = "DENIED" | "ESCALATED" | null;

export type PolicyCustomer = Pick<Customer, "id" | "name" | "email">;

export type PolicyOrder = Pick<
  Order,
  "id" | "totalAmount" | "isFinalSale" | "purchaseDate"
> & {
  items?: Array<Pick<OrderItem, "isFinalSale">>;
};

export type EvaluateRefundInput = {
  order: PolicyOrder;
  customer: PolicyCustomer;
  reasonCategory: string;
  customerStatement: string;
};

export type PolicyEvaluation = {
  hardDecision: HardDecision;
  rulesTriggered: PolicyRule[];
  eligibleForAi: boolean;
  policySummary: string;
};

function isOlderThanRefundWindow(purchaseDate: Date, now: Date): boolean {
  const refundWindowStart = new Date(now);
  refundWindowStart.setUTCDate(refundWindowStart.getUTCDate() - REFUND_WINDOW_DAYS);
  return purchaseDate.getTime() < refundWindowStart.getTime();
}

function hasFinalSaleItem(order: PolicyOrder): boolean {
  return order.isFinalSale || order.items?.some((item) => item.isFinalSale) === true;
}

export function evaluateRefund(
  input: EvaluateRefundInput,
  now: Date = new Date(),
): PolicyEvaluation {
  const { order, customer, reasonCategory, customerStatement } = input;
  void customer;
  void reasonCategory;
  void customerStatement;

  const rulesTriggered: PolicyRule[] = [];
  const finalSale = hasFinalSaleItem(order);
  const expired = isOlderThanRefundWindow(new Date(order.purchaseDate), now);
  const highValue = new Prisma.Decimal(order.totalAmount).gt(REFUND_AMOUNT_LIMIT);

  if (finalSale) {
    rulesTriggered.push("FINAL_SALE");
  }

  if (expired) {
    rulesTriggered.push("REFUND_WINDOW_EXPIRED");
  }

  if (highValue) {
    rulesTriggered.push("REFUND_AMOUNT_OVER_LIMIT");
  }

  if (finalSale || expired) {
    return {
      hardDecision: "DENIED",
      rulesTriggered,
      eligibleForAi: false,
      policySummary: finalSale
        ? "Order is marked as final sale and is not eligible for a refund."
        : "Order is outside the 30-day refund window.",
    };
  }

  if (highValue) {
    return {
      hardDecision: "ESCALATED",
      rulesTriggered,
      eligibleForAi: false,
      policySummary: "Refund amount exceeds the $500 threshold and requires human review.",
    };
  }

  return {
    hardDecision: null,
    rulesTriggered,
    eligibleForAi: true,
    policySummary: "Order passes deterministic policy checks and can proceed to AI review.",
  };
}
