<script setup lang="ts">
const navigation = ["Dashboard", "Refund Requests", "Orders", "Customers"];
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <header class="border-b bg-white">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <h1 class="text-xl font-bold text-gray-900">Refund Engine</h1>

        <span class="text-sm text-gray-500">Operations Dashboard</span>
      </div>
    </header>

    <div class="mx-auto flex max-w-7xl">
      <aside class="hidden min-h-[calc(100vh-73px)] w-60 border-r bg-white p-4 md:block">
        <nav class="space-y-1">
          <a
            v-for="item in navigation"
            :key="item"
            href="#"
            class="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            {{ item }}
          </a>
        </nav>
      </aside>

      <main class="flex-1 p-6">
        <h2 class="text-2xl font-semibold text-gray-900">Dashboard</h2>
        <p class="mt-2 text-gray-600">
          Review refund requests and manage customer decisions.
        </p>
      </main>
    </div>
  </div>
</template>
