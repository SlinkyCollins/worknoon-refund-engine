export type RefundDecisionStatus = 'APPROVED' | 'DENIED' | 'ESCALATED';

export type RefundReasonCategory =
  | 'DAMAGED_ITEM'
  | 'INCORRECT_ITEM'
  | 'BUYERS_REMORSE'
  | 'LATE_DELIVERY'
  | 'FRAUD_SUSPECTED'
  | 'OTHER';

export interface ReasonOption {
  value: RefundReasonCategory;
  label: string;
  description: string;
}

export const REFUND_REASON_OPTIONS: ReasonOption[] = [
  {
    value: 'DAMAGED_ITEM',
    label: 'Damaged Item',
    description: 'Item arrived damaged, defective, or unusable',
  },
  {
    value: 'INCORRECT_ITEM',
    label: 'Incorrect Item',
    description: 'Received wrong product, size, color, or variant',
  },
  {
    value: 'BUYERS_REMORSE',
    label: "Buyer's Remorse",
    description: 'No longer needed or changed mind about the purchase',
  },
  {
    value: 'LATE_DELIVERY',
    label: 'Late Delivery',
    description: 'Order arrived significantly after estimated delivery date',
  },
  {
    value: 'FRAUD_SUSPECTED',
    label: 'Fraud Suspected',
    description: 'Suspected unauthorized purchase or fraudulent activity',
  },
  {
    value: 'OTHER',
    label: 'Other',
    description: 'Other reasons not covered above',
  },
];

export interface OrderItem {
  id: string;
  productName: string;
  sku: string;
  unitPrice: string | number;
  quantity: number;
  isFinalSale: boolean;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  totalAmount: string | number;
  status: 'DELIVERED' | 'IN_TRANSIT' | 'CANCELLED';
  purchaseDate: string;
  deliveredDate: string | null;
  isFinalSale: boolean;
  items?: OrderItem[];
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  orders: OrderSummary[];
}

export interface EvaluateRefundPayload {
  orderId: string;
  reasonCategory: RefundReasonCategory;
  customerStatement: string;
}

export interface EvaluateRefundResponse {
  refundRequestId: string;
  status: RefundDecisionStatus;
  rulesTriggered: string[];
  aiReasoning: string;
  customerMessage: string;
}

export interface ApiErrorResponse {
  error?: string;
  message?: string;
  details?: Array<{ field?: string; message?: string }>;
}

export interface AdminAuditLog {
  id: string;
  refundRequestId: string;
  decision: RefundDecisionStatus;
  rulesTriggered: string[];
  aiReasoning: string;
  customerMessage: string;
  createdAt: string;
}

export interface AdminRefundRequest {
  id: string;
  orderId: string;
  customerId: string;
  reasonCategory: RefundReasonCategory | string;
  customerStatement: string;
  status: RefundDecisionStatus;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
  };
  customer: {
    id: string;
    name: string;
    email: string;
  };
  auditLog: AdminAuditLog | null;
}
