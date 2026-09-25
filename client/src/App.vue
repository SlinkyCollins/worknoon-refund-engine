<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
    <!-- Top Navigation Bar -->
    <nav class="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-2xs">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-14">
          <!-- Logo & Brand -->
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-indigo-600 text-white font-bold text-sm shadow-xs">
              W
            </span>
            <span class="font-bold text-gray-900 text-sm tracking-tight">Worknoon Refund Engine</span>
          </div>

          <!-- Navigation Links -->
          <div class="flex items-center gap-1">
            <router-link
              to="/"
              class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
              :class="route.path === '/' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'"
            >
              Customer Portal
            </router-link>
            <router-link
              to="/admin"
              class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
              :class="route.path === '/admin' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'"
            >
              Admin Dashboard
            </router-link>
          </div>
        </div>
      </div>
    </nav>

    <!-- Main View -->
    <main class="flex-1">
      <router-view />
    </main>
  </div>
</template>
