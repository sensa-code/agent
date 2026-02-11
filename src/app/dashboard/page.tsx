// ============================================================================
// VetEvidence — Admin Dashboard
// ============================================================================

"use client";

import React, { useEffect, useState } from "react";

interface DashboardData {
  usage: {
    totalRequests: number;
    totalTokens: number;
    avgLatency: number;
  };
  cost: {
    totalCostUsd: number;
    avgCostPerRequest: number;
  };
  quality: {
    avgOverall: number;
    avgSafety: number;
    totalEvaluated: number;
  };
  feedback: {
    totalFeedback: number;
    satisfactionRate: number;
    thumbsUp: number;
    thumbsDown: number;
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [feedbackRes] = await Promise.all([
          fetch("/api/feedback?days=30"),
        ]);

        const feedbackData = feedbackRes.ok ? await feedbackRes.json() : null;

        setData({
          usage: {
            totalRequests: 0,
            totalTokens: 0,
            avgLatency: 0,
          },
          cost: {
            totalCostUsd: 0,
            avgCostPerRequest: 0,
          },
          quality: {
            avgOverall: 0,
            avgSafety: 0,
            totalEvaluated: 0,
          },
          feedback: feedbackData || {
            totalFeedback: 0,
            satisfactionRate: 0,
            thumbsUp: 0,
            thumbsDown: 0,
          },
        });
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 animate-pulse text-lg">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          VetEvidence 管理儀表板
        </h1>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <KPICard
            title="總請求數"
            value={data?.usage.totalRequests.toLocaleString() || "0"}
            subtitle="過去 30 天"
            color="blue"
          />
          <KPICard
            title="總成本"
            value={`$${data?.cost.totalCostUsd.toFixed(2) || "0.00"}`}
            subtitle="過去 30 天"
            color="green"
          />
          <KPICard
            title="品質分數"
            value={`${data?.quality.avgOverall.toFixed(1) || "0"}/100`}
            subtitle={`${data?.quality.totalEvaluated || 0} 次評估`}
            color="purple"
          />
          <KPICard
            title="滿意度"
            value={`${data?.feedback.satisfactionRate || 0}%`}
            subtitle={`👍 ${data?.feedback.thumbsUp || 0} / 👎 ${data?.feedback.thumbsDown || 0}`}
            color="orange"
          />
        </div>

        {/* Detail Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Usage Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              用量統計
            </h2>
            <div className="space-y-4">
              <StatRow
                label="總 Token 使用量"
                value={data?.usage.totalTokens.toLocaleString() || "0"}
              />
              <StatRow
                label="平均回應延遲"
                value={`${data?.usage.avgLatency || 0}ms`}
              />
              <StatRow
                label="每請求成本"
                value={`$${data?.cost.avgCostPerRequest.toFixed(4) || "0"}`}
              />
            </div>
          </div>

          {/* Quality Metrics */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              品質指標
            </h2>
            <div className="space-y-4">
              <StatRow
                label="引用分數"
                value={`${data?.quality.avgOverall ? "—" : "N/A"}`}
              />
              <StatRow
                label="安全分數"
                value={`${data?.quality.avgSafety.toFixed(1) || "0"}/25`}
              />
              <StatRow
                label="回饋數量"
                value={data?.feedback.totalFeedback.toString() || "0"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function KPICard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  color: "blue" | "green" | "purple" | "orange";
}) {
  const colorClasses = {
    blue: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
    green:
      "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
    purple:
      "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800",
    orange:
      "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800",
  };

  return (
    <div
      className={`rounded-xl border p-6 ${colorClasses[color]}`}
    >
      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {title}
      </div>
      <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {subtitle}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-white">
        {value}
      </span>
    </div>
  );
}
