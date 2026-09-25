<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { AdminRefundRequest, RefundDecisionStatus } from '../types';
import { getAdminRequests, getAdminRequestById, ApiError } from '../services/api';

const requests = ref<AdminRefundRequest[]>([]);
const selectedRequest = ref<AdminRefundRequest | null>(null);
const isLoading = ref(true);
const isLoadingDetail = ref(false);
const errorMessage = ref<string | null>(null);
const copiedId = ref(false);

async function loadRequests() {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const data = await getAdminRequests();
    requests.value = data;
    // Auto-select first request for immediate review
    if (data.length > 0 && !selectedRequest.value) {
      await handleSelectRequest(data[0]);
    } else if (data.length > 0 && selectedRequest.value) {
      // Refresh current selection if still present
      const current = data.find((r) => r.id === selectedRequest.value?.id) || data[0];
      await handleSelectRequest(current);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      errorMessage.value = err.message;
    } else {
      errorMessage.value = 'Failed to load refund requests.';
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleSelectRequest(req: AdminRefundRequest) {
  selectedRequest.value = req;
  isLoadingDetail.value = true;
  try {
    // Call GET /api/admin/requests/:id to ensure endpoint verification and freshness
    const detailed = await getAdminRequestById(req.id);
    selectedRequest.value = detailed;
  } catch {
    // If individual detail fetch fails, fall back to the row item already in memory
    selectedRequest.value = req;
  } finally {
    isLoadingDetail.value = false;
  }
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function formatFullDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function getDecisionBadgeClass(status: RefundDecisionStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    case 'DENIED':
      return 'bg-rose-100 text-rose-800 border-rose-300';
    case 'ESCALATED':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

async function copyRequestId() {
  if (!selectedRequest.value?.id) return;
  try {
    await navigator.clipboard.writeText(selectedRequest.value.id);
    copiedId.value = true;
    setTimeout(() => {
      copiedId.value = false;
    }, 2000);
  } catch {
    // Clipboard permission denied or fallback
  }
}

onMounted(() => {
  loadRequests();
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Main Dashboard Card -->
      <div class="bg-white rounded-xl border border-gray-300 shadow-xs overflow-hidden">
        <!-- Dashboard Header -->
        <header class="px-6 py-4 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-gray-900">Admin</h1>
            <p class="text-xs text-gray-500 mt-0.5">Audit trail and evaluation history</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-500">
              {{ requests.length }} {{ requests.length === 1 ? 'request' : 'requests' }} recorded
            </span>
            <button
              @click="loadRequests"
              :disabled="isLoading"
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <svg
                class="w-3.5 h-3.5 text-gray-500"
                :class="{ 'animate-spin': isLoading }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              Refresh
            </button>
          </div>
        </header>

        <!-- Loading State -->
        <div v-if="isLoading && requests.length === 0" class="p-12 text-center text-gray-500 text-sm">
          <svg class="animate-spin h-6 w-6 text-indigo-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading audit requests...
        </div>

        <!-- Error State -->
        <div v-else-if="errorMessage" class="p-6 bg-red-50 border-b border-red-200 text-sm text-red-800 flex items-start gap-3">
          <svg class="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div class="flex-1">
            <p class="font-semibold">Error Loading Dashboard</p>
            <p class="mt-0.5 text-xs text-red-700">{{ errorMessage }}</p>
          </div>
          <button @click="loadRequests" class="text-xs font-semibold text-red-700 underline">Try again</button>
        </div>

        <div v-else class="divide-y divide-gray-200">
          <!-- SECTION 1: Recent Requests List -->
          <div>
            <div class="px-6 py-3 bg-gray-100/60 border-b border-gray-200 flex items-center justify-between">
              <h2 class="text-xs font-bold uppercase tracking-wider text-gray-700">Recent Requests</h2>
              <span class="text-[11px] text-gray-500">Click a row to inspect full audit details</span>
            </div>

            <!-- Empty State -->
            <div v-if="requests.length === 0" class="p-8 text-center text-sm text-gray-500">
              No refund requests found in the system.
            </div>

            <!-- Requests Table / List -->
            <div v-else class="divide-y divide-gray-100">
              <div
                v-for="req in requests"
                :key="req.id"
                @click="handleSelectRequest(req)"
                class="px-6 py-3.5 flex items-center justify-between gap-4 cursor-pointer transition-colors hover:bg-gray-50"
                :class="{
                  'bg-indigo-50/70 border-l-4 border-l-indigo-600 font-medium': selectedRequest?.id === req.id,
                  'border-l-4 border-l-transparent': selectedRequest?.id !== req.id
                }"
              >
                <!-- Order Number & Customer -->
                <div class="min-w-0 flex-1 flex items-center gap-3">
                  <span class="font-mono text-sm font-semibold text-gray-900 shrink-0">
                    {{ req.order?.orderNumber || 'N/A' }}
                  </span>
                  <span class="text-xs text-gray-500 truncate hidden sm:inline">
                    ({{ req.customer?.name || 'Customer' }})
                  </span>
                </div>

                <!-- Reason Category -->
                <div class="shrink-0 text-xs font-mono text-gray-700 hidden md:block">
                  {{ req.reasonCategory }}
                </div>

                <!-- Decision Badge -->
                <div class="shrink-0">
                  <span
                    class="inline-block text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full border shadow-2xs tracking-wider"
                    :class="getDecisionBadgeClass(req.status)"
                  >
                    {{ req.status }}
                  </span>
                </div>

                <!-- Timestamp -->
                <div class="shrink-0 text-xs text-gray-500 text-right font-mono min-w-[70px]">
                  {{ formatTime(req.createdAt) }}
                </div>
              </div>
            </div>
          </div>

          <!-- SECTION 2: Selected Request Details -->
          <div class="p-6 bg-white space-y-6">
            <div class="flex items-center justify-between border-b border-gray-200 pb-3">
              <h2 class="text-xs font-bold uppercase tracking-wider text-gray-700">Selected Request</h2>
              <span v-if="selectedRequest" class="text-xs text-gray-500">
                Created: {{ formatFullDateTime(selectedRequest.createdAt) }}
              </span>
            </div>

            <!-- No Selection State -->
            <div v-if="!selectedRequest" class="p-8 text-center text-sm text-gray-400">
              Select a request from the list above to view its audit details.
            </div>

            <!-- Selected Request Body -->
            <div v-else class="space-y-5 text-sm">
              <!-- Meta Fields Grid -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4 border border-gray-200/80">
                <div>
                  <span class="text-xs font-medium text-gray-500 block">Customer:</span>
                  <span class="font-semibold text-gray-900 block mt-0.5">
                    {{ selectedRequest.customer?.name }}
                    <span class="font-normal text-xs text-gray-500">({{ selectedRequest.customer?.email }})</span>
                  </span>
                </div>

                <div>
                  <span class="text-xs font-medium text-gray-500 block">Order:</span>
                  <span class="font-mono font-semibold text-gray-900 block mt-0.5">
                    {{ selectedRequest.order?.orderNumber }}
                  </span>
                </div>

                <div>
                  <span class="text-xs font-medium text-gray-500 block">Reason:</span>
                  <span class="font-mono text-gray-800 block mt-0.5 text-xs font-semibold">
                    {{ selectedRequest.reasonCategory }}
                  </span>
                </div>

                <div>
                  <span class="text-xs font-medium text-gray-500 block">Decision:</span>
                  <div class="mt-0.5">
                    <span
                      class="inline-block text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full border shadow-2xs tracking-wider"
                      :class="getDecisionBadgeClass(selectedRequest.status)"
                    >
                      {{ selectedRequest.status }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Customer Statement -->
              <div>
                <span class="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  Customer Statement:
                </span>
                <div class="bg-gray-50/70 border border-gray-200 rounded-lg p-3.5 text-gray-800 text-sm italic">
                  "{{ selectedRequest.customerStatement }}"
                </div>
              </div>

              <!-- Rules Triggered -->
              <div>
                <span class="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  Rules Triggered:
                </span>
                <div v-if="selectedRequest.auditLog?.rulesTriggered && selectedRequest.auditLog.rulesTriggered.length > 0" class="flex flex-wrap gap-2">
                  <span
                    v-for="rule in selectedRequest.auditLog.rulesTriggered"
                    :key="rule"
                    class="font-mono text-xs px-2.5 py-1 rounded-md bg-gray-100 border border-gray-300 text-gray-800 font-semibold"
                  >
                    {{ rule }}
                  </span>
                </div>
                <div v-else class="text-xs text-gray-400 italic">
                  None (no hard policy or AI flags triggered)
                </div>
              </div>

              <!-- AI Reasoning -->
              <div>
                <span class="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  AI Reasoning:
                </span>
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-3.5 text-gray-800 text-sm whitespace-pre-line leading-relaxed">
                  {{ selectedRequest.auditLog?.aiReasoning || 'No AI reasoning recorded.' }}
                </div>
              </div>

              <!-- Customer Response / Message -->
              <div>
                <span class="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  Customer Response:
                </span>
                <div class="bg-indigo-50/50 border border-indigo-200/70 rounded-lg p-3.5 text-indigo-950 text-sm whitespace-pre-line leading-relaxed">
                  {{ selectedRequest.auditLog?.customerMessage || 'No customer response recorded.' }}
                </div>
              </div>

              <!-- Request ID reference -->
              <div class="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                <span>Request ID: <code class="font-mono text-gray-600 select-all">{{ selectedRequest.id }}</code></span>
                <button
                  @click="copyRequestId"
                  type="button"
                  class="text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  {{ copiedId ? 'Copied ID!' : 'Copy ID' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
