"use client";

import React from "react";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<{ name: string; input: unknown }>;
  citations?: Array<{ id: number; title: string; source: string }>;
  latencyMs?: number;
  isStreaming?: boolean;
}

export default function MessageBubble({
  role,
  content,
  toolCalls,
  citations,
  latencyMs,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        }`}
      >
        {/* Role label */}
        <div className={`text-xs font-medium mb-1 ${isUser ? "text-blue-200" : "text-gray-500"}`}>
          {isUser ? "你" : "VetEvidence"}
        </div>

        {/* Content */}
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {content}
          {isStreaming && <span className="animate-pulse">▊</span>}
        </div>

        {/* Tool calls indicator */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              🔧 使用工具：{toolCalls.map(t => t.name).join(", ")}
            </div>
          </div>
        )}

        {/* Citations */}
        {citations && citations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 mb-1">📚 引用來源：</div>
            {citations.slice(0, 5).map((c) => (
              <div key={c.id} className="text-xs text-gray-500 ml-2">
                [{c.id}] {c.title}
              </div>
            ))}
          </div>
        )}

        {/* Latency */}
        {latencyMs !== undefined && !isUser && (
          <div className="mt-1 text-xs text-gray-400">
            {(latencyMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    </div>
  );
}
