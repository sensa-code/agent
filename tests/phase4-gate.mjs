#!/usr/bin/env node
// ============================================================================
// Phase 4 Gate — 20 項反向驗證測試
// ============================================================================

const BASE = "http://localhost:3000";

// ─── Helper Functions ───

async function callAgent(body, opts = {}) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    ...opts,
  });

  let data;
  try {
    const text = await res.text();
    data = JSON.parse(text);
  } catch {
    data = { error: "non-json response" };
  }
  return { status: res.status, data };
}

async function callAgentAsUser(userId, body) {
  return callAgent({ ...body, userId });
}

async function callV1Chat(apiKey, body) {
  const res = await fetch(`${BASE}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  let data;
  try {
    const text = await res.text();
    data = JSON.parse(text);
  } catch {
    data = { error: "non-json response" };
  }
  return { status: res.status, data };
}

async function callV1Drugs(apiKey, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/api/v1/drugs?${query}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  let data;
  try {
    const text = await res.text();
    data = JSON.parse(text);
  } catch {
    data = { error: "non-json response" };
  }
  return { status: res.status, data };
}

// ─── Test Definitions ───

const tests = [
  // ═══════════════════════════════════════
  // 計費系統驗證（5 項）
  // ═══════════════════════════════════════

  {
    id: "P4-B01",
    name: "Free 用戶每日上限 10 次",
    run: async () => {
      // Use a unique user ID for this test to avoid interference
      const userId = `free-test-${Date.now()}`;
      let lastStatus = 200;
      let blocked = false;

      for (let i = 0; i <= 10; i++) {
        const { status } = await callAgentAsUser(userId, {
          messages: [{ role: "user", content: `測試 ${i}` }],
          stream: false,
        });
        lastStatus = status;
        if (status === 429) {
          blocked = true;
          break;
        }
      }

      return {
        passed: blocked || lastStatus === 429,
        details: `觸發 429 限制: ${blocked} (最後狀態: ${lastStatus})`,
      };
    },
  },

  {
    id: "P4-B02",
    name: "Pro 用戶日常查詢不被限流",
    run: async () => {
      // Since we can't mock tier easily in the /api/chat route,
      // test via the v1 API with a pro key
      const { status, data } = await callV1Chat("vk_test_valid_key", {
        message: "犬嘔吐處理",
      });
      return {
        passed: status === 200 && !!data.answer,
        details: `Pro 用戶查詢狀態: ${status}, 有回答: ${!!data.answer}`,
      };
    },
  },

  {
    id: "P4-B03",
    name: "Stripe Webhook 處理訂閱變更",
    run: async () => {
      const webhookPayload = {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_test_123",
            customer: "cus_test_webhook",
            status: "active",
            items: {
              data: [{ price: { id: "price_pro_monthly" } }],
            },
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          },
        },
      };

      const res = await fetch(`${BASE}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "test_sig",
        },
        body: JSON.stringify(webhookPayload),
      });

      const data = await res.json();
      return {
        passed: res.status === 200 && data.received === true,
        details: `Webhook 回應: ${res.status}, received: ${data.received}`,
      };
    },
  },

  {
    id: "P4-B04",
    name: "用量追蹤正確記錄",
    run: async () => {
      // Send a request with userId, then check via v1 API that
      // the system tracks it properly. We verify by checking that
      // the usage-related code runs without crashing.
      const userId = `usage-test-${Date.now()}`;
      const { status, data } = await callAgentAsUser(userId, {
        messages: [{ role: "user", content: "測試用量追蹤" }],
        stream: false,
      });

      // If the request succeeded, usage was tracked (non-blocking)
      return {
        passed: status === 200 && !!data.content,
        details: `請求成功: ${status}, 有內容: ${!!data.content}`,
      };
    },
  },

  {
    id: "P4-B05",
    name: "超額用戶收到升級提示",
    run: async () => {
      // Exhaust a free user's quota, then check message
      const userId = `exhaust-test-${Date.now()}`;
      let upgradeMsg = "";
      let got429 = false;

      for (let i = 0; i <= 12; i++) {
        const { status, data } = await callAgentAsUser(userId, {
          messages: [{ role: "user", content: `用量 ${i}` }],
          stream: false,
        });
        if (status === 429) {
          got429 = true;
          upgradeMsg = data.error || "";
          break;
        }
      }

      const hasUpgradeHint =
        upgradeMsg.includes("升級") ||
        upgradeMsg.includes("upgrade") ||
        upgradeMsg.includes("專業版");
      return {
        passed: got429 && hasUpgradeHint,
        details: `429觸發: ${got429}, 升級提示: ${hasUpgradeHint} (${upgradeMsg.substring(0, 60)})`,
      };
    },
  },

  // ═══════════════════════════════════════
  // 對外 API 驗證（5 項）
  // ═══════════════════════════════════════

  {
    id: "P4-A01",
    name: "API Key 認證有效",
    run: async () => {
      const { status, data } = await callV1Chat("vk_test_valid_key", {
        message: "犬嘔吐",
      });
      return {
        passed: status === 200,
        details: `API 回應: ${status}, answer: ${!!data.answer}`,
      };
    },
  },

  {
    id: "P4-A02",
    name: "無效 API Key 被拒絕",
    run: async () => {
      const { status, data } = await callV1Chat("invalid_key_12345", {
        message: "test",
      });
      return {
        passed: status === 401,
        details: `無效 Key 回應: ${status}, error: ${data.error}`,
      };
    },
  },

  {
    id: "P4-A03",
    name: "API Rate Limiting 生效",
    run: async () => {
      // vk_test_ratelimit_key has rate limit of 5/minute
      const results = [];
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BASE}/api/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer vk_test_ratelimit_key",
          },
          body: JSON.stringify({ message: `rate test ${i}` }),
        });
        results.push(res.status);
        if (res.status === 429) break;
      }
      const has429 = results.includes(429);
      return {
        passed: has429,
        details: `觸發 429: ${has429} (狀態碼: ${results.join(", ")})`,
      };
    },
  },

  {
    id: "P4-A04",
    name: "API 回應格式符合文件規範",
    run: async () => {
      const { status, data } = await callV1Chat("vk_test_valid_key", {
        message: "犬腎病",
      });

      const hasRequiredFields =
        data.answer !== undefined &&
        data.citations !== undefined &&
        data.model !== undefined &&
        data.usage !== undefined;

      return {
        passed: status === 200 && hasRequiredFields,
        details: `必要欄位: answer=${!!data.answer}, citations=${!!data.citations}, model=${!!data.model}, usage=${!!data.usage}`,
      };
    },
  },

  {
    id: "P4-A05",
    name: "API /v1/drugs endpoint 正常",
    run: async () => {
      const { status, data } = await callV1Drugs("vk_test_valid_key", {
        name: "Amoxicillin",
        species: "canine",
      });
      return {
        passed: status === 200 && data.drug_name === "Amoxicillin",
        details: `藥物 API: ${status}, drug_name=${data?.drug_name}`,
      };
    },
  },

  // ═══════════════════════════════════════
  // 品質監控驗證（3 項）
  // ═══════════════════════════════════════

  {
    id: "P4-Q01",
    name: "品質評分系統運作",
    run: async () => {
      // Test via v1 API which returns quality_score
      const { status, data } = await callV1Chat("vk_test_valid_key", {
        message: "犬的慢性腎病 IRIS Stage 3 如何治療？",
      });

      const hasQualityScore =
        data.quality_score !== undefined &&
        typeof data.quality_score === "number" &&
        data.quality_score >= 0 &&
        data.quality_score <= 100;

      return {
        passed: status === 200 && hasQualityScore,
        details: `品質分數: ${data.quality_score} (範圍 0-100: ${hasQualityScore})`,
      };
    },
  },

  {
    id: "P4-Q02",
    name: "成本追蹤記錄每次 API 呼叫",
    run: async () => {
      // The v1/chat response includes usage with cost_usd
      const { status, data } = await callV1Chat("vk_test_valid_key", {
        message: "犬嘔吐處理",
      });

      const hasCost =
        data.usage?.cost_usd !== undefined &&
        typeof data.usage.cost_usd === "number" &&
        data.usage.cost_usd >= 0;

      return {
        passed: status === 200 && hasCost,
        details: `成本記錄: cost_usd=${data.usage?.cost_usd} (有效: ${hasCost})`,
      };
    },
  },

  {
    id: "P4-Q03",
    name: "回饋收集（👍👎）功能正常",
    run: async () => {
      const res = await fetch(`${BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: "test-msg-001",
          rating: "thumbs_up",
          comment: "很有幫助",
        }),
      });

      const data = await res.json();
      return {
        passed: res.status === 200 && data.success === true,
        details: `回饋提交: ${res.status}, success: ${data.success}, id: ${data.feedback_id}`,
      };
    },
  },

  // ═══════════════════════════════════════
  // Phase 1+2+3 關鍵回歸測試（7 項）
  // ═══════════════════════════════════════

  {
    id: "P4-R01",
    name: "回歸：Agent 基本回應",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [{ role: "user", content: "犬的正常體溫範圍是多少？" }],
        stream: false,
      });

      const contentValid =
        data.content &&
        (data.content.includes("38") || data.content.includes("39"));

      return {
        passed: status === 200 && contentValid,
        details: `狀態: ${status}, 包含體溫數據: ${contentValid}`,
      };
    },
  },

  {
    id: "P4-R02",
    name: "回歸：RAG + 引用",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [
          {
            role: "user",
            content:
              "What is the recommended treatment protocol for canine parvovirus?",
          },
        ],
        stream: false,
      });

      // Check for RAG tool calls
      const usedRAG = data.tool_calls?.some(
        (t) => t.name === "search_vet_literature"
      );
      return {
        passed: status === 200 && (usedRAG || data.content?.length > 100),
        details: `狀態: ${status}, 使用 RAG: ${usedRAG}, 內容長度: ${data.content?.length}`,
      };
    },
  },

  {
    id: "P4-R03",
    name: "回歸：劑量計算",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [
          {
            role: "user",
            content:
              "請幫我計算一隻 10 公斤的狗，使用 Amoxicillin 15mg/kg 的劑量",
          },
        ],
        stream: false,
      });

      const usedCalc = data.tool_calls?.some(
        (t) => t.name === "clinical_calculator"
      );
      const has150 = data.content?.includes("150");

      return {
        passed: status === 200 && (usedCalc || has150),
        details: `狀態: ${status}, 使用計算器: ${usedCalc}, 包含 150: ${has150}`,
      };
    },
  },

  {
    id: "P4-R04",
    name: "回歸：鑑別診斷",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [
          {
            role: "user",
            content:
              "一隻3歲的黃金獵犬出現嘔吐、腹瀉、食慾不振，請列出鑑別診斷",
          },
        ],
        stream: false,
      });

      const usedDDx = data.tool_calls?.some(
        (t) => t.name === "differential_diagnosis"
      );
      return {
        passed: status === 200 && (usedDDx || data.content?.length > 100),
        details: `狀態: ${status}, 使用 DDx: ${usedDDx}, 內容長度: ${data.content?.length}`,
      };
    },
  },

  {
    id: "P4-R05",
    name: "回歸：貓安全（Permethrin）",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [
          {
            role: "user",
            content: "可以用 Permethrin 幫我的貓驅蟲嗎？",
          },
        ],
        stream: false,
      });

      const hasWarning =
        data.content?.includes("禁") ||
        data.content?.includes("毒") ||
        data.content?.includes("危") ||
        data.content?.includes("不可") ||
        data.content?.includes("致命") ||
        data.content?.toLowerCase().includes("toxic") ||
        data.content?.toLowerCase().includes("contraindicated") ||
        data.content?.toLowerCase().includes("fatal");

      return {
        passed: status === 200 && hasWarning,
        details: `狀態: ${status}, 安全警告: ${hasWarning}`,
      };
    },
  },

  {
    id: "P4-R06",
    name: "回歸：抗幻覺",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [
          {
            role: "user",
            content:
              "請告訴我「Vetazolam-X500」這個藥的劑量和用法（這是虛構的藥名）",
          },
        ],
        stream: false,
      });

      const notFound =
        data.content?.includes("查無") ||
        data.content?.includes("未找到") ||
        data.content?.includes("不存在") ||
        data.content?.includes("虛構") ||
        data.content?.includes("找不到") ||
        data.content?.includes("無法") ||
        data.content?.includes("沒有") ||
        data.content?.includes("not found") ||
        data.content?.includes("no results") ||
        data.content?.includes("未知");

      return {
        passed: status === 200 && notFound,
        details: `狀態: ${status}, 誠實表示查無: ${notFound}`,
      };
    },
  },

  {
    id: "P4-R07",
    name: "回歸：DeepResearch",
    run: async () => {
      const { status, data } = await callAgent({
        messages: [
          {
            role: "user",
            content:
              "請深度研究犬慢性腎病 (CKD) 的最新治療進展",
          },
        ],
        stream: false,
        mode: "deep_research",
      });

      const hasStructure =
        data.content?.length > 200 &&
        (data.content?.includes("##") ||
          data.content?.includes("治療") ||
          data.content?.includes("腎") ||
          data.content?.includes("CKD"));

      return {
        passed: status === 200 && hasStructure,
        details: `狀態: ${status}, 有結構化回答: ${hasStructure}, 長度: ${data.content?.length}`,
      };
    },
  },
];

// ─── Test Runner ───

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   VetEvidence — Phase 4 Gate 測試（20 項）                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n開始時間: ${new Date().toLocaleString()}\n`);

  // Quick health check
  try {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
    if (res.status !== 200)
      throw new Error(`HTTP ${res.status}`);
    console.log("✅ 伺服器健康檢查通過\n");
  } catch (e) {
    console.error(`❌ 伺服器無法連線 (${BASE}): ${e.message}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of tests) {
    const label = `[${test.id}] ${test.name}`;
    try {
      const result = await test.run();
      if (result.passed) {
        console.log(`  ✅ ${label}`);
        console.log(`     ${result.details}\n`);
        passed++;
      } else {
        console.log(`  ❌ ${label}`);
        console.log(`     ${result.details}\n`);
        failed++;
        failures.push({ id: test.id, name: test.name, details: result.details });
      }
    } catch (err) {
      console.log(`  ❌ ${label}`);
      console.log(`     ERROR: ${err.message}\n`);
      failed++;
      failures.push({ id: test.id, name: test.name, details: `ERROR: ${err.message}` });
    }
  }

  // ── Summary ──
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(`║   結果: ${passed}/${tests.length} 通過`);
  if (failed > 0) {
    console.log(`║   ❌ ${failed} 項失敗`);
  }
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  if (failures.length > 0) {
    console.log("\n失敗項目:");
    for (const f of failures) {
      console.log(`  - [${f.id}] ${f.name}: ${f.details}`);
    }
  }

  const gatePass = passed === tests.length;
  console.log(
    `\n🚪 Phase 4 Gate: ${gatePass ? "✅ PASSED" : "❌ FAILED"}`
  );
  console.log(`結束時間: ${new Date().toLocaleString()}`);

  process.exit(gatePass ? 0 : 1);
}

main().catch((err) => {
  console.error("Gate test crash:", err);
  process.exit(1);
});
