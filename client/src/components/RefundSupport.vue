<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  REFUND_REASON_OPTIONS,
  type Customer,
  type OrderSummary,
  type RefundReasonCategory,
  type RefundDecisionStatus,
  type EvaluateRefundResponse,
} from '../types';
import { getCustomers, submitRefundEvaluation, ApiError } from '../services/api';

// Loading & error states
const isLoadingCustomers = ref(true);
const customerLoadError = ref<string | null>(null);
const isSubmitting = ref(false);
const submitError = ref<string | null>(null);

// Form state
const customers = ref<Customer[]>([]);
const selectedCustomerId = ref<string>('');
const selectedOrderId = ref<string>('');
const selectedReason = ref<RefundReasonCategory | ''>('');
const customerStatement = ref<string>('');
const validationErrors = ref<{
  orderId?: string;
  reason?: string;
  statement?: string;
}>({});

type OrderWithCustomer = OrderSummary & { customerName: string; customerEmail: string };

// Result state
const evaluationResult = ref<EvaluateRefundResponse | null>(null);
const evaluatedOrderSnapshot = ref<OrderWithCustomer | null>(null);
const copiedId = ref(false);

// Load customers on mount
async function loadCustomerData() {
  isLoadingCustomers.value = true;
  customerLoadError.value = null;
  try {
    const data = await getCustomers();
    customers.value = data;
    // Auto-select first customer with orders if available
    const firstWithOrders = data.find((c) => c.orders && c.orders.length > 0);
    if (firstWithOrders) {
      selectedCustomerId.value = firstWithOrders.id;
      if (firstWithOrders.orders.length > 0) {
        selectedOrderId.value = firstWithOrders.orders[0].id;
      }
    }
  } catch (err) {
    if (err instanceof ApiError) {
      customerLoadError.value = err.message;
    } else {
      customerLoadError.value = 'Failed to load customer orders. Please ensure the backend is running.';
    }
  } finally {
    isLoadingCustomers.value = false;
  }
}

onMounted(() => {
  loadCustomerData();
});

const availableOrders = computed<OrderWithCustomer[]>(() => {
  if (selectedCustomerId.value) {
    const cust = customers.value.find((c) => c.id === selectedCustomerId.value);
    if (!cust) return [];
    return cust.orders.map((o) => ({
      ...o,
      customerName: cust.name,
      customerEmail: cust.email,
    }));
  }

  // All orders across all customers
  const all: Array<OrderSummary & { customerName: string; customerEmail: string }> = [];
  for (const cust of customers.value) {
    for (const order of cust.orders) {
      all.push({
        ...order,
        customerName: cust.name,
        customerEmail: cust.email,
      });
    }
  }
  return all;
});

const selectedOrder = computed(() => {
  if (!selectedOrderId.value) return null;
  return availableOrders.value.find((o) => o.id === selectedOrderId.value) || null;
});

// When customer selection changes, update the order selection
function onCustomerChange() {
  validationErrors.value.orderId = undefined;
  const currentOrders = availableOrders.value;
  if (currentOrders.length > 0) {
    selectedOrderId.value = currentOrders[0].id;
  } else {
    selectedOrderId.value = '';
  }
}

// Helpers
function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return `$${amount}`;
  return `$${num.toFixed(2)}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'DELIVERED':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'IN_TRANSIT':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function getDecisionTheme(status: RefundDecisionStatus) {
  switch (status) {
    case 'APPROVED':
      return {
        badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        cardBg: 'bg-emerald-50/50 border-emerald-200',
        titleColor: 'text-emerald-900',
        iconBg: 'bg-emerald-100 text-emerald-600',
        label: 'Approved',
        summary: 'Your refund request has been automatically approved.',
      };
    case 'DENIED':
      return {
        badgeBg: 'bg-rose-100 text-rose-800 border-rose-300',
        cardBg: 'bg-rose-50/50 border-rose-200',
        titleColor: 'text-rose-900',
        iconBg: 'bg-rose-100 text-rose-600',
        label: 'Denied',
        summary: 'Your refund request could not be approved according to store policy.',
      };
    case 'ESCALATED':
      return {
        badgeBg: 'bg-amber-100 text-amber-800 border-amber-300',
        cardBg: 'bg-amber-50/50 border-amber-200',
        titleColor: 'text-amber-900',
        iconBg: 'bg-amber-100 text-amber-600',
        label: 'Escalated for Review',
        summary: 'Your request requires manual review by our customer support specialists.',
      };
  }
}

// Form validation
function validateForm(): boolean {
  const errors: { orderId?: string; reason?: string; statement?: string } = {};

  if (!selectedOrderId.value) {
    errors.orderId = 'Please select an order to request a refund for.';
  }

  if (!selectedReason.value) {
    errors.reason = 'Please select a reason for your refund request.';
  }

  if (!customerStatement.value.trim()) {
    errors.statement = 'Please provide an explanation of what happened.';
  } else if (customerStatement.value.trim().length < 5) {
    errors.statement = 'Please provide a more descriptive statement (at least 5 characters).';
  }

  validationErrors.value = errors;
  return Object.keys(errors).length === 0;
}

// Form submission
async function handleSubmit() {
  submitError.value = null;

  if (!validateForm()) {
    return;
  }

  if (!selectedOrderId.value || !selectedReason.value) {
    return;
  }

  isSubmitting.value = true;

  // Cache order details for the result view
  evaluatedOrderSnapshot.value = selectedOrder.value;

  try {
    // STRICT REQUIREMENT: Send only orderId, reasonCategory, customerStatement
    const result = await submitRefundEvaluation({
      orderId: selectedOrderId.value,
      reasonCategory: selectedReason.value,
      customerStatement: customerStatement.value.trim(),
    });

    evaluationResult.value = result;
  } catch (err) {
    if (err instanceof ApiError) {
      submitError.value = err.message;
    } else {
      submitError.value = 'An unexpected error occurred while submitting your request. Please try again.';
    }
  } finally {
    isSubmitting.value = false;
  }
}

// Reset / New request
function handleReset() {
  evaluationResult.value = null;
  evaluatedOrderSnapshot.value = null;
  submitError.value = null;
  validationErrors.value = {};
  customerStatement.value = '';
  selectedReason.value = '';
  // Keep customer and order selection for convenience, or user can change them
}

// Copy refund request ID
async function copyRequestId() {
  if (!evaluationResult.value?.refundRequestId) return;
  try {
    await navigator.clipboard.writeText(evaluationResult.value.refundRequestId);
    copiedId.value = true;
    setTimeout(() => {
      copiedId.value = false;
    }, 2000);
  } catch {
    // Clipboard permission denied or fallback
  }
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-10 px-4 sm:px-6 lg:px-8">
    <div class="max-w-3xl mx-auto">
      <!-- Header / Product Title -->
      <header class="mb-8 text-center sm:text-left sm:flex sm:items-center sm:justify-between pb-6 border-b border-gray-200">
        <div>
          <div class="flex items-center gap-2 justify-center sm:justify-start">
            <span class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-lg shadow-sm">
              W
            </span>
            <h1 class="text-2xl font-bold tracking-tight text-gray-900">Refund Support</h1>
          </div>
          <p class="mt-1 text-sm text-gray-600">
            Submit a refund request for your order. Automated policy evaluation & instant decision.
          </p>
        </div>
        <div class="mt-3 sm:mt-0 text-xs text-gray-500 bg-white border border-gray-200 px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-xs">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>System Online</span>
        </div>
      </header>

      <!-- Global Loading State (Initial fetch) -->
      <div v-if="isLoadingCustomers" class="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-xs">
        <svg class="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-gray-700 font-medium">Loading customer accounts and orders...</p>
        <p class="text-xs text-gray-500 mt-1">Connecting to backend at /api/customers</p>
      </div>

      <!-- Customer Load Error -->
      <div v-else-if="customerLoadError" class="bg-white rounded-xl border border-red-200 p-8 shadow-xs">
        <div class="flex items-start gap-4">
          <div class="p-2 rounded-full bg-red-100 text-red-600">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
          </div>
          <div class="flex-1">
            <h3 class="text-base font-semibold text-gray-900">Failed to Load Orders</h3>
            <p class="text-sm text-red-700 mt-1">{{ customerLoadError }}</p>
            <button
              @click="loadCustomerData"
              class="mt-4 inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 shadow-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              Retry Loading
            </button>
          </div>
        </div>
      </div>

      <!-- RESULT STATE (Displayed when evaluation has returned) -->
      <div v-else-if="evaluationResult" class="space-y-6">
        <div
          class="rounded-xl border p-6 sm:p-8 shadow-xs transition-all"
          :class="getDecisionTheme(evaluationResult.status).cardBg"
        >
          <!-- Status Banner -->
          <div class="flex items-start sm:items-center justify-between flex-wrap gap-4 pb-6 border-b border-gray-200/80">
            <div class="flex items-center gap-3">
              <div
                class="w-12 h-12 rounded-full flex items-center justify-center shadow-xs"
                :class="getDecisionTheme(evaluationResult.status).iconBg"
              >
                <!-- Approved Icon -->
                <svg v-if="evaluationResult.status === 'APPROVED'" class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                </svg>
                <!-- Denied Icon -->
                <svg v-else-if="evaluationResult.status === 'DENIED'" class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                <!-- Escalated Icon -->
                <svg v-else class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
              <div>
                <span
                  class="inline-block text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border mb-1"
                  :class="getDecisionTheme(evaluationResult.status).badgeBg"
                >
                  {{ evaluationResult.status }}
                </span>
                <h2 class="text-xl sm:text-2xl font-bold" :class="getDecisionTheme(evaluationResult.status).titleColor">
                  {{ getDecisionTheme(evaluationResult.status).label }}
                </h2>
              </div>
            </div>

            <!-- Refund Request Reference ID -->
            <div class="bg-white/80 border border-gray-200 px-3.5 py-2 rounded-lg text-xs shadow-2xs">
              <span class="text-gray-500 block">Refund Request ID:</span>
              <div class="flex items-center gap-2 mt-0.5">
                <code class="font-mono font-medium text-gray-800 break-all select-all">{{ evaluationResult.refundRequestId }}</code>
                <button
                  @click="copyRequestId"
                  type="button"
                  title="Copy Request ID"
                  class="text-gray-400 hover:text-gray-700 transition-colors p-1"
                >
                  <span v-if="copiedId" class="text-emerald-600 font-semibold text-[10px]">Copied!</span>
                  <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Customer Message Section -->
          <div class="mt-6">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Message from Customer Support:
            </h3>
            <div class="bg-white rounded-lg p-4 sm:p-5 border border-gray-200/90 shadow-xs">
              <p class="text-gray-800 text-sm sm:text-base leading-relaxed whitespace-pre-line font-medium">
                {{ evaluationResult.customerMessage }}
              </p>
            </div>
          </div>

          <!-- Order Summary for context -->
          <div v-if="evaluatedOrderSnapshot" class="mt-6 pt-5 border-t border-gray-200/80 space-y-3 text-xs">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span class="text-gray-500 block">Order Number</span>
                <span class="font-semibold text-gray-900 text-sm">{{ evaluatedOrderSnapshot.orderNumber }}</span>
              </div>
              <div>
                <span class="text-gray-500 block">Order Total</span>
                <span class="font-semibold text-gray-900 text-sm">{{ formatCurrency(evaluatedOrderSnapshot.totalAmount) }}</span>
              </div>
              <div>
                <span class="text-gray-500 block">Customer</span>
                <span class="font-semibold text-gray-900 text-sm truncate block">{{ evaluatedOrderSnapshot.customerName }}</span>
              </div>
              <div>
                <span class="text-gray-500 block">Submitted Reason</span>
                <span class="font-semibold text-gray-900 text-sm">{{ selectedReason }}</span>
              </div>
            </div>

            <!-- Items summary in result -->
            <div v-if="evaluatedOrderSnapshot.items && evaluatedOrderSnapshot.items.length > 0" class="pt-2 border-t border-gray-200/60">
              <span class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                Purchased Items ({{ evaluatedOrderSnapshot.items.length }})
              </span>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="item in evaluatedOrderSnapshot.items"
                  :key="item.id"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/90 border border-gray-200 text-gray-800 text-xs shadow-2xs"
                >
                  <span class="font-medium text-gray-900">{{ item.productName }}</span>
                  <span class="text-gray-400 font-mono text-[11px]">(Qty {{ item.quantity }} × {{ formatCurrency(item.unitPrice) }})</span>
                  <span v-if="item.isFinalSale" class="text-[10px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200">Final Sale</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Reset Button: Return to form -->
        <div class="text-center pt-2">
          <button
            @click="handleReset"
            type="button"
            class="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z"></path>
            </svg>
            Submit Another Refund Request
          </button>
        </div>
      </div>

      <!-- FORM STATE (Customer refund submission) -->
      <div v-else class="space-y-6">
        <!-- Error Alert (Submission Error) -->
        <div
          v-if="submitError"
          class="rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5 flex items-start gap-3 shadow-xs"
        >
          <div class="text-red-600 shrink-0 mt-0.5">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div class="flex-1 text-sm text-red-800">
            <p class="font-semibold">Unable to Process Refund Request</p>
            <p class="mt-0.5 text-red-700">{{ submitError }}</p>
          </div>
          <button
            @click="submitError = null"
            class="text-red-400 hover:text-red-600 p-1 rounded-md"
            title="Dismiss error"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form @submit.prevent="handleSubmit" class="bg-white rounded-xl border border-gray-200 shadow-xs divide-y divide-gray-200 overflow-hidden">
          <!-- Step 1: Customer Account & Order Selection -->
          <div class="p-6 sm:p-8 space-y-6">
            <div class="border-b border-gray-100 pb-4">
              <span class="text-xs font-bold uppercase tracking-wider text-indigo-600">Step 1 of 3</span>
              <h2 class="text-lg font-semibold text-gray-900 mt-0.5">Select Your Order</h2>
              <p class="text-xs text-gray-500 mt-1">Choose your customer account and the purchase you would like to request a refund for.</p>
            </div>

            <!-- Customer Account Selector -->
            <div>
              <label for="customer-select" class="block text-sm font-medium text-gray-700 mb-1.5">
                Customer Account
              </label>
              <select
                id="customer-select"
                v-model="selectedCustomerId"
                @change="onCustomerChange"
                :disabled="isSubmitting"
                class="w-full rounded-lg border-gray-300 shadow-2xs focus:border-indigo-500 focus:ring-indigo-500 text-sm py-2.5 px-3 bg-white border"
              >
                <option value="">-- All Customers / Select Account --</option>
                <option
                  v-for="customer in customers"
                  :key="customer.id"
                  :value="customer.id"
                >
                  {{ customer.name }} ({{ customer.email }}) — {{ customer.orders.length }} {{ customer.orders.length === 1 ? 'order' : 'orders' }}
                </option>
              </select>
            </div>

            <!-- Order Selector -->
            <div>
              <label for="order-select" class="block text-sm font-medium text-gray-700 mb-1.5">
                Order <span class="text-red-500">*</span>
              </label>
              <select
                id="order-select"
                v-model="selectedOrderId"
                :disabled="isSubmitting || availableOrders.length === 0"
                class="w-full rounded-lg border shadow-2xs focus:border-indigo-500 focus:ring-indigo-500 text-sm py-2.5 px-3 bg-white"
                :class="validationErrors.orderId ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-300'"
              >
                <option value="" disabled>-- Select an order --</option>
                <option
                  v-for="order in availableOrders"
                  :key="order.id"
                  :value="order.id"
                >
                  Order #{{ order.orderNumber }} — {{ formatCurrency(order.totalAmount) }} (Purchased {{ formatDate(order.purchaseDate) }}) [{{ order.status }}] - {{ order.customerName }}
                </option>
              </select>
              <p v-if="validationErrors.orderId" class="mt-1.5 text-xs text-red-600">
                {{ validationErrors.orderId }}
              </p>
              <p v-else-if="availableOrders.length === 0" class="mt-1.5 text-xs text-amber-600">
                No orders found for the selected account.
              </p>
            </div>

            <!-- Selected Order Summary Card -->
            <div
              v-if="selectedOrder"
              class="rounded-lg bg-gray-50 border border-gray-200/80 p-4 text-sm space-y-3"
            >
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-gray-900 text-base">Order #{{ selectedOrder.orderNumber }}</span>
                  <span
                    class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                    :class="getStatusBadgeClass(selectedOrder.status)"
                  >
                    {{ selectedOrder.status }}
                  </span>
                  <span
                    v-if="selectedOrder.isFinalSale"
                    class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                  >
                    Final Sale
                  </span>
                </div>
                <div class="text-right">
                  <span class="text-xs text-gray-500 block">Total Amount</span>
                  <span class="font-bold text-gray-900 text-base">{{ formatCurrency(selectedOrder.totalAmount) }}</span>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-2 border-t border-gray-200 text-gray-600">
                <div>
                  <span class="text-gray-400 block">Purchased:</span>
                  <span class="font-medium text-gray-700">{{ formatDate(selectedOrder.purchaseDate) }}</span>
                </div>
                <div>
                  <span class="text-gray-400 block">Delivered:</span>
                  <span class="font-medium text-gray-700">{{ formatDate(selectedOrder.deliveredDate) }}</span>
                </div>
                <div>
                  <span class="text-gray-400 block">Customer:</span>
                  <span class="font-medium text-gray-700 truncate block">{{ selectedOrder.customerName }}</span>
                </div>
              </div>

              <!-- Order Items Section -->
              <div v-if="selectedOrder.items && selectedOrder.items.length > 0" class="pt-2.5 border-t border-gray-200">
                <span class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                  Items in this order ({{ selectedOrder.items.length }})
                </span>
                <div class="space-y-1.5">
                  <div
                    v-for="item in selectedOrder.items"
                    :key="item.id"
                    class="flex items-center justify-between text-xs bg-white border border-gray-200 rounded-md px-2.5 py-1.5 shadow-2xs"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="font-medium text-gray-900 truncate">{{ item.productName }}</span>
                      <span class="text-gray-400 font-mono text-[11px] shrink-0">({{ item.sku }})</span>
                      <span
                        v-if="item.isFinalSale"
                        class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 shrink-0"
                      >
                        Final Sale
                      </span>
                    </div>
                    <div class="text-gray-700 font-mono text-xs shrink-0 ml-2">
                      <span class="text-gray-400 font-sans">Qty {{ item.quantity }} ×</span> {{ formatCurrency(item.unitPrice) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Step 2: Refund Reason Selection -->
          <div class="p-6 sm:p-8 space-y-6">
            <div class="border-b border-gray-100 pb-4">
              <span class="text-xs font-bold uppercase tracking-wider text-indigo-600">Step 2 of 3</span>
              <h2 class="text-lg font-semibold text-gray-900 mt-0.5">Reason for Refund</h2>
              <p class="text-xs text-gray-500 mt-1">Select the reason that best describes your request.</p>
            </div>

            <div>
              <label for="reason-select" class="block text-sm font-medium text-gray-700 mb-1.5">
                Refund Reason Category <span class="text-red-500">*</span>
              </label>
              <select
                id="reason-select"
                v-model="selectedReason"
                :disabled="isSubmitting"
                class="w-full rounded-lg border shadow-2xs focus:border-indigo-500 focus:ring-indigo-500 text-sm py-2.5 px-3 bg-white"
                :class="validationErrors.reason ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-300'"
              >
                <option value="" disabled>-- Select a reason category --</option>
                <option
                  v-for="opt in REFUND_REASON_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }} — {{ opt.description }}
                </option>
              </select>
              <p v-if="validationErrors.reason" class="mt-1.5 text-xs text-red-600">
                {{ validationErrors.reason }}
              </p>
            </div>
          </div>

          <!-- Step 3: Customer Statement -->
          <div class="p-6 sm:p-8 space-y-6">
            <div class="border-b border-gray-100 pb-4">
              <span class="text-xs font-bold uppercase tracking-wider text-indigo-600">Step 3 of 3</span>
              <h2 class="text-lg font-semibold text-gray-900 mt-0.5">Describe What Happened</h2>
              <p class="text-xs text-gray-500 mt-1">
                Please provide details so our automated refund policy engine and AI assistant can review your claim.
              </p>
            </div>

            <div>
              <label for="customer-statement" class="block text-sm font-medium text-gray-700 mb-1.5">
                Customer Statement <span class="text-red-500">*</span>
              </label>
              <textarea
                id="customer-statement"
                v-model="customerStatement"
                rows="4"
                :disabled="isSubmitting"
                placeholder="Example: The item arrived broken in transit. The outer packaging was damaged and the ceramic handle was shattered."
                class="w-full rounded-lg border shadow-2xs focus:border-indigo-500 focus:ring-indigo-500 text-sm p-3 bg-white resize-y"
                :class="validationErrors.statement ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-300'"
              ></textarea>
              <div class="flex items-center justify-between mt-1.5">
                <p v-if="validationErrors.statement" class="text-xs text-red-600">
                  {{ validationErrors.statement }}
                </p>
                <span v-else class="text-xs text-gray-400">Please be as descriptive as possible.</span>
                <span class="text-xs text-gray-400">{{ customerStatement.length }} characters</span>
              </div>
            </div>
          </div>

          <!-- Submission Footer -->
          <div class="p-6 sm:p-8 bg-gray-50/70 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="text-xs text-gray-500 text-center sm:text-left">
              <span>Requests are evaluated immediately using automated policy rules and AI analysis.</span>
            </div>

            <button
              type="submit"
              :disabled="isSubmitting || !selectedOrderId || !selectedReason || !customerStatement.trim()"
              class="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <span v-if="isSubmitting" class="inline-flex items-center gap-2">
                <svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Evaluating Refund Request...
              </span>
              <span v-else class="inline-flex items-center gap-2">
                Submit Refund Request
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
                </svg>
              </span>
            </button>
          </div>
        </form>

        <!-- Loading State Banner while request is processing -->
        <div v-if="isSubmitting" class="bg-indigo-50 border border-indigo-200 rounded-xl p-6 text-center animate-pulse shadow-xs">
          <div class="inline-flex items-center gap-2 text-indigo-700 font-medium text-sm">
            <svg class="animate-spin h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Evaluating request with automated policy rules & AI reasoning...</span>
          </div>
          <p class="text-xs text-indigo-600/80 mt-1">Please do not navigate away or refresh the page.</p>
        </div>
      </div>
    </div>
  </div>
</template>
