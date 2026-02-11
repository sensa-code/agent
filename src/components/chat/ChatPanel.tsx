"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import MessageBubble from "./MessageBubble";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; input: unknown }>;
  citations?: Array<{ id: number; title: string; source: string }>;
  latencyMs?: number;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    try {
      // Build message history for API
      const apiMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, stream: true }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullContent = "";
      let toolCalls: Array<{ name: string; input: unknown }> = [];
      let citations: Array<{ id: number; title: string; source: string }> = [];
      let latencyMs: number | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n").filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "text_delta":
                fullContent += event.data;
                setStreamingContent(fullContent);
                break;
              case "tool_call":
                toolCalls.push(event.data);
                break;
              case "tool_calls":
                toolCalls = event.data;
                break;
              case "citations":
                citations = event.data;
                break;
              case "done":
                latencyMs = event.data?.latencyMs;
                break;
              case "error":
                fullContent += `\n\n⚠️ 錯誤: ${event.data}`;
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        citations: citations.length > 0 ? citations : undefined,
        latencyMs,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setStreamingContent("");
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "抱歉，發生錯誤。請稍後再試。",
        },
      ]);
      setStreamingContent("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          🏥 VetEvidence
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          獸醫 AI 臨床決策支援
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-center text-gray-400 dark:text-gray-500 mt-20">
            <div className="text-4xl mb-4">🐕 🐈 🐇</div>
            <div className="text-lg font-medium mb-2">歡迎使用 VetEvidence</div>
            <div className="text-sm">
              輸入您的臨床問題，我會搜尋文獻並提供循證建議
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            toolCalls={msg.toolCalls}
            citations={msg.citations}
            latencyMs={msg.latencyMs}
          />
        ))}

        {/* Streaming message */}
        {isLoading && streamingContent && (
          <MessageBubble
            role="assistant"
            content={streamingContent}
            isStreaming
          />
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                搜尋文獻中...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入臨床問題... (Shift+Enter 換行)"
            className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "..." : "送出"}
          </button>
        </form>
        <div className="text-xs text-gray-400 mt-1 text-center">
          ⚠️ AI 建議僅供參考，臨床決策請以獸醫師專業判斷為準
        </div>
      </div>
    </div>
  );
}
