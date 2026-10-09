#!/usr/bin/env bun

/**
 * Load Test Script - Optional Differential
 * Run with: bun run test:load
 * 
 * Metodologia:
 * - Warmup: 10s
 * - Test: 60s
 * - Cooldown: 10s
 * - Virtual users: 50 concurrent
 * - Ramp-up: 10s
 * 
 * Métricas coletadas:
 * - Throughput (req/s)
 * - Latency p50, p95, p99
 * - Taxa de erro
 * - Conflitos de concorrência
 * - Outbox lag
 */

import { writeFileSync } from "node:fs";

interface LoadTestConfig {
  baseUrl: string;
  duration: number;        // seconds
  concurrency: number;     // virtual users
  rampUp: number;          // seconds
  warmup: number;          // seconds
  cooldown: number;        // seconds
}

interface TestResult {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  latencyMs: number;
  error?: string;
}

interface AggregatedMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  throughput: number;      // req/s
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    min: number;
    max: number;
  };
  statusCodes: Record<number, number>;
  concurrencyConflicts: number;
}

const CONFIG: LoadTestConfig = {
  baseUrl: process.env.LOAD_TEST_URL || "http://localhost:3000",
  duration: parseInt(process.env.LOAD_TEST_DURATION || "60"),
  concurrency: parseInt(process.env.LOAD_TEST_CONCURRENCY || "50"),
  rampUp: parseInt(process.env.LOAD_TEST_RAMPUP || "10"),
  warmup: parseInt(process.env.LOAD_TEST_WARMUP || "10"),
  cooldown: parseInt(process.env.LOAD_TEST_COOLDOWN || "10"),
};

const results: TestResult[] = [];
let startTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function makeRequest(userId: number, walletId: string): Promise<TestResult> {
  const requestStart = performance.now();
  const idempotencyKey = `load-test-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
  try {
    const response = await fetch(`${CONFIG.baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        providerId: "load-test-provider",
        externalTransactionId: `ext-${userId}-${Date.now()}`,
        playerId: "load-test-player",
        walletId,
        roundId: `round-${userId}`,
        gameId: "load-test-game",
        kind: "BET",
        money: { amount: "1.00", currency: "BRL" },
      }),
    });

    const latencyMs = performance.now() - requestStart;
    const status = response.status;
    
    let error: string | undefined;
    if (status >= 400) {
      const text = await response.text();
      error = text.slice(0, 200);
    }

    return { timestamp: new Date().toISOString(), method: "POST", url: "/wagering/transactions", status, latencyMs, error };
  } catch (err) {
    return { 
      timestamp: new Date().toISOString(), 
      method: "POST", 
      url: "/wagering/transactions", 
      status: 0, 
      latencyMs: performance.now() - requestStart, 
      error: String(err) 
    };
  }
}

async function virtualUser(userId: number, walletId: string, stopSignal: () => boolean): Promise<void> {
  while (!stopSignal()) {
    const result = await makeRequest(userId, walletId);
    results.push(result);
    
    // Small delay between requests per user (simulate think time)
    await sleep(10 + Math.random() * 20);
  }
}

async function runLoadTest(): Promise<void> {
  console.log("🚀 Starting Load Test");
  console.log("=".repeat(50));
  console.log(`Base URL: ${CONFIG.baseUrl}`);
  console.log(`Duration: ${CONFIG.duration}s`);
  console.log(`Concurrency: ${CONFIG.concurrency} users`);
  console.log(`Ramp-up: ${CONFIG.rampUp}s`);
  console.log(`Warmup: ${CONFIG.warmup}s`);
  console.log("=".repeat(50));

  // Create wallet for load test
  console.log("\n📋 Creating test wallet...");
  const walletResponse = await fetch(`${CONFIG.baseUrl}/wallets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId: "load-test-player",
      initialBalance: { amount: "100000.00", currency: "BRL" },
    }),
  });

  if (!walletResponse.ok) {
    throw new Error(`Failed to create wallet: ${walletResponse.status}`);
  }

  const wallet = await walletResponse.json();
  const walletId = wallet.id;
  console.log(`✅ Wallet created: ${walletId} (balance: ${wallet.balance.amount} ${wallet.balance.currency})`);

  // Warmup
  console.log(`\n🔥 Warmup (${CONFIG.warmup}s)...`);
  const warmupStart = Date.now();
  while (Date.now() - warmupStart < CONFIG.warmup * 1000) {
    await makeRequest(0, walletId);
    await sleep(50);
  }
  results.length = 0; // Clear warmup results

  // Ramp-up
  console.log(`\n📈 Ramp-up (${CONFIG.rampUp}s)...`);
  const users: (() => boolean)[] = [];
  const userPromises: Promise<void>[] = [];
  
  const rampStart = Date.now();
  for (let i = 0; i < CONFIG.concurrency; i++) {
    const stopFlag = { current: false };
    users.push(() => stopFlag.current);
    userPromises.push(virtualUser(i, walletId, () => stopFlag.current));
    
    const elapsed = Date.now() - rampStart;
    const targetElapsed = (i + 1) / CONFIG.concurrency * CONFIG.rampUp * 1000;
    if (elapsed < targetElapsed) {
      await sleep(targetElapsed - elapsed);
    }
  }

  // Steady state
  console.log(`\n⚡ Steady state (${CONFIG.duration}s)...`);
  startTime = Date.now();
  
  await sleep(CONFIG.duration * 1000);

  // Signal stop
  users.forEach(stop => stop());
  
  // Wait for all users to finish
  await Promise.all(userPromises);

  // Cooldown
  console.log(`\n❄️ Cooldown (${CONFIG.cooldown}s)...`);
  await sleep(CONFIG.cooldown * 1000);

  // Analyze results
  const endTime = Date.now();
  const totalDurationSec = (endTime - startTime) / 1000;
  
  console.log("\n" + "=".repeat(50));
  console.log("📊 LOAD TEST RESULTS");
  console.log("=".repeat(50));

  const latencies = results.map(r => r.latencyMs);
  const successful = results.filter(r => r.status === 200);
  const failed = results.filter(r => r.status !== 200 && r.status !== 0);
  const networkErrors = results.filter(r => r.status === 0);
  const concurrencyConflicts = results.filter(r => r.status === 409).length;

  const metrics: AggregatedMetrics = {
    totalRequests: results.length,
    successfulRequests: successful.length,
    failedRequests: failed.length + networkErrors.length,
    errorRate: (failed.length + networkErrors.length) / results.length,
    throughput: results.length / totalDurationSec,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies),
    },
    statusCodes: {},
    concurrencyConflicts,
  };

  for (const r of results) {
    metrics.statusCodes[r.status] = (metrics.statusCodes[r.status] || 0) + 1;
  }

  // Print metrics
  console.log(`\n📈 Throughput: ${metrics.throughput.toFixed(2)} req/s`);
  console.log(`\n⏱️ Latency:`);
  console.log(`   p50: ${metrics.latency.p50.toFixed(2)}ms`);
  console.log(`   p95: ${metrics.latency.p95.toFixed(2)}ms`);
  console.log(`   p99: ${metrics.latency.p99.toFixed(2)}ms`);
  console.log(`   avg: ${metrics.latency.avg.toFixed(2)}ms`);
  console.log(`   min: ${metrics.latency.min.toFixed(2)}ms`);
  console.log(`   max: ${metrics.latency.max.toFixed(2)}ms`);

  console.log(`\n📊 Requests:`);
  console.log(`   Total: ${metrics.totalRequests}`);
  console.log(`   Successful (200): ${metrics.successfulRequests}`);
  console.log(`   Failed (4xx/5xx): ${metrics.failedRequests}`);
  console.log(`   Network Errors: ${networkErrors.length}`);
  console.log(`   Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);

  console.log(`\n🔄 Concurrency Conflicts (409): ${metrics.concurrencyConflicts}`);
  console.log(`   (Expected: high due to single wallet contention)`);

  console.log(`\n📋 Status Codes:`);
  for (const [code, count] of Object.entries(metrics.statusCodes).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`   ${code}: ${count}`);
  }

  // Check outbox lag via metrics endpoint
  try {
    const metricsResponse = await fetch(`${CONFIG.baseUrl}/metrics`);
    const metricsText = await metricsResponse.text();
    const outboxLagMatch = metricsText.match(/wagering_outbox_lag_seconds\s+(\d+\.?\d*)/);
    if (outboxLagMatch) {
      console.log(`\n📬 Outbox Lag: ${outboxLagMatch[1]}s`);
    }
  } catch {
    console.log("\n📬 Outbox Lag: Unable to fetch");
  }

  // Final wallet balance
  const finalWallet = await fetch(`${CONFIG.baseUrl}/wallets/${walletId}`).then(r => r.json());
  console.log(`\n💰 Final Wallet Balance: ${finalWallet.balance.amount} ${finalWallet.balance.currency}`);
  console.log(`   Version: ${finalWallet.version}`);

  // Reconciliation
  const recon = await fetch(`${CONFIG.baseUrl}/wallets/${walletId}/reconciliation`, {
    method: "POST"
  }).then(r => r.json());
  console.log(`\n🔍 Reconciliation:`);
  console.log(`   Stored: ${recon.storedBalance.amount}`);
  console.log(`   Calculated: ${recon.calculatedBalance.amount}`);
  console.log(`   Consistent: ${recon.consistent}`);
  console.log(`   Entries Checked: ${recon.checkedEntries}`);

  // Save raw results
  const report = {
    config: CONFIG,
    timestamp: new Date().toISOString(),
    duration: totalDurationSec,
    metrics,
    environment: {
      nodeVersion: process.version,
      bunVersion: Bun.version,
      platform: process.platform,
      arch: process.arch,
    },
  };

  const filename = `load-test-report-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(report, null, 2));
  console.log(`\n💾 Report saved to: ${filename}`);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("✅ Load test completed");
  console.log("=".repeat(50));
}

runLoadTest().catch(err => {
  console.error("❌ Load test failed:", err);
  process.exit(1);
});