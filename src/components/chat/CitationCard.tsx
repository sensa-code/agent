"use client";

import React from "react";

interface CitationCardProps {
  id: number;
  title: string;
  source: string;
  year?: number;
  excerpt?: string;
  similarity?: number;
}

export default function CitationCard({
  id,
  title,
  source,
  year,
  excerpt,
  similarity,
}: CitationCardProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
      <div className="flex items-start gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-bold flex-shrink-0">
          {id}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {title}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {source}
            {year && ` (${year})`}
            {similarity !== undefined && (
              <span className="ml-2 text-blue-500">
                相似度: {(similarity * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {excerpt && (
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
              {excerpt}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
