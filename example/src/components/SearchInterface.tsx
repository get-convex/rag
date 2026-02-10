import type { SearchType } from "@convex-dev/rag";
import { useState } from "react";

type SearchScope = "general" | "category" | "file";
type QueryMode = "search" | "question";

interface SearchInterfaceProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onSearch: (mode: QueryMode) => void;
  isSearching: boolean;
  searchScope: SearchScope;
  setSearchScope: (type: SearchScope) => void;
  searchGlobal: boolean;
  setSearchGlobal: (global: boolean) => void;
  categorySearchGlobal: boolean;
  setCategorySearchGlobal: (global: boolean) => void;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  selectedDocument: any;
  limit: number;
  setLimit: (limit: number) => void;
  chunksBefore: number;
  setChunksBefore: (chunks: number) => void;
  chunksAfter: number;
  setChunksAfter: (chunks: number) => void;
  categories: string[];
  searchType: SearchType;
  setSearchType: (type: SearchType) => void;
}

export function SearchInterface({
  searchQuery,
  setSearchQuery,
  onSearch,
  isSearching,
  searchScope,
  setSearchScope,
  searchGlobal,
  setSearchGlobal,
  categorySearchGlobal,
  setCategorySearchGlobal,
  selectedCategory,
  setSelectedCategory,
  selectedDocument,
  limit,
  setLimit,
  chunksBefore,
  setChunksBefore,
  chunksAfter,
  setChunksAfter,
  categories,
  searchType,
  setSearchType,
}: SearchInterfaceProps) {
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  return (
    <div className="bg-white/90 backdrop-blur-sm border-b border-gray-200/50 p-6 shadow-sm">
      <div className="flex items-center space-x-4 mb-6">
        <div className="w-12 h-12 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl flex items-center justify-center shadow-lg">
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Convex RAG Component
          </h1>
          <p className="text-gray-600 mt-1">
            Intelligent search and question answering for your documents
          </p>
        </div>
      </div>

      {/* Search Type Selector */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex space-x-2">
          {(["general", "category", "file"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setSearchScope(type)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                searchScope === type
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
                  : "bg-white/80 text-gray-700 hover:bg-white shadow-sm hover:shadow-md"
              }`}
            >
              {type === "general"
                ? "General"
                : type === "category"
                  ? "Category"
                  : "File-Specific"}
            </button>
          ))}
        </div>

        {/* Document Info and toggles */}
        <div className="flex items-center space-x-4">
          {/* Document Info for File-specific queries */}
          {searchScope === "file" && selectedDocument && (
            <div className="flex items-center space-x-4">
              <div className="px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                <div className="text-sm font-semibold text-blue-800">
                  {selectedDocument.filename}
                </div>
              </div>
            </div>
          )}

          {/* Global/User Toggle */}
          {(searchScope === "general" || searchScope === "category") && (
            <div className="flex items-center space-x-3 bg-white/80 px-4 py-2 rounded-xl border border-gray-200">
              <span className="text-sm text-gray-600 font-medium">
                User Files
              </span>
              <button
                type="button"
                onClick={() => {
                  if (searchScope === "general") {
                    setSearchGlobal(!searchGlobal);
                  } else if (searchScope === "category") {
                    setCategorySearchGlobal(!categorySearchGlobal);
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  (
                    searchScope === "general"
                      ? searchGlobal
                      : categorySearchGlobal
                  )
                    ? "bg-gradient-to-r from-blue-500 to-indigo-500"
                    : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md ${
                    (
                      searchScope === "general"
                        ? searchGlobal
                        : categorySearchGlobal
                    )
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-sm text-gray-600 font-medium">
                Shared Files
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Category Selector for Category Search */}
      {searchScope === "category" && (
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Category
          </label>
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/80 backdrop-blur-sm text-gray-900 appearance-none"
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Search/Question Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch("search");
            }
          }}
          placeholder="Enter your search query or question..."
          className="w-full px-6 py-4 pr-32 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/80 backdrop-blur-sm text-gray-900 placeholder-gray-500 text-lg"
        />
        <div className="absolute right-2 top-2 bottom-2 flex space-x-2">
          <button
            onClick={() => onSearch("search")}
            disabled={isSearching || !searchQuery.trim()}
            className={`px-4 text-white rounded-lg font-semibold transition-all duration-300 ${
              isSearching || !searchQuery.trim()
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg hover:shadow-xl"
            }`}
          >
            <span>🔍</span>
          </button>
          <button
            onClick={() => onSearch("question")}
            disabled={isSearching || !searchQuery.trim()}
            className={`px-4 text-white rounded-lg font-semibold transition-all duration-300 ${
              isSearching || !searchQuery.trim()
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg hover:shadow-xl"
            }`}
          >
            <span className="text-sm">Ask</span>
          </button>
        </div>
      </div>

      {/* Advanced Options Dropdown */}
      <div className="mt-4">
        <button
          onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors duration-200"
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${
              showAdvancedOptions ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <span className="text-sm font-medium">Advanced Options</span>
        </button>

        {showAdvancedOptions && (
          <div className="mt-3 p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-4">
              <label className="text-sm font-semibold text-gray-700">
                Search Mode
              </label>
              <div className="flex space-x-1">
                {(["vector", "text", "hybrid"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSearchType(mode)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 ${
                      searchType === mode
                        ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {mode === "vector"
                      ? "Vector"
                      : mode === "text"
                        ? "Text"
                        : "Hybrid"}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Results Limit
                </label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) =>
                    setLimit(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  min="1"
                  max="50"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Context Before
                </label>
                <input
                  type="number"
                  value={chunksBefore}
                  onChange={(e) =>
                    setChunksBefore(Math.max(0, parseInt(e.target.value) || 0))
                  }
                  min="0"
                  max="5"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Context After
                </label>
                <input
                  type="number"
                  value={chunksAfter}
                  onChange={(e) =>
                    setChunksAfter(Math.max(0, parseInt(e.target.value) || 0))
                  }
                  min="0"
                  max="5"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
