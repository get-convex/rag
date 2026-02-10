import "./Example.css";
import { useConvex } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "../convex/_generated/api";
import { useCallback, useState, useEffect } from "react";
import type { EntryFilter, SearchResult, SearchType } from "@convex-dev/rag";
import type { Filters, PublicFile } from "../convex/example";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { UploadSection } from "./components/UploadSection";
import { FileList } from "./components/FileList";
import { SearchInterface } from "./components/SearchInterface";

type SearchScope = "general" | "category" | "file";
type QueryMode = "search" | "question";

interface UISearchResult {
  results: (SearchResult & {
    entry: PublicFile;
  })[];
  text: string;
  files: Array<PublicFile>;
}

interface UIQuestionResult {
  answer: string;
  results: (SearchResult & {
    entry: PublicFile;
  })[];
  files: Array<PublicFile>;
}

function Example() {
  const [searchScope, setSearchScope] = useState<SearchScope>("general");
  const [searchGlobal, setSearchGlobal] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<PublicFile | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchResults, setSearchResults] = useState<UISearchResult | null>(
    null,
  );
  const [questionResult, setQuestionResult] = useState<UIQuestionResult | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [categorySearchGlobal, setCategorySearchGlobal] = useState(true);
  const [showFullText, setShowFullText] = useState(false);

  // New state for search parameters
  const [limit, setLimit] = useState(10);
  const [chunksBefore, setChunksBefore] = useState(1);
  const [chunksAfter, setChunksAfter] = useState(1);
  const [categories, setCategories] = useState<string[]>([]);
  const [searchType, setSearchType] = useState<SearchType>("vector");

  // Convex functions
  const convex = useConvex();

  const documentChunks = usePaginatedQuery(
    api.example.listChunks,
    selectedDocument?.entryId
      ? {
          entryId: selectedDocument.entryId,
          order: "asc",
        }
      : "skip",
    { initialNumItems: 10 },
  );

  const handleSearch = useCallback(
    async (mode: QueryMode) => {
      if (!searchQuery.trim()) return;

      if (searchScope === "file" && !selectedDocument) {
        alert("Please select a file to search");
        return;
      }

      if (searchScope === "category" && !selectedCategory.trim()) {
        alert("Please select a category for category search");
        return;
      }

      setIsSearching(true);
      setSearchResults(null);
      setQuestionResult(null);

      try {
        const chunkContext = { before: chunksBefore, after: chunksAfter };

        if (mode === "question") {
          let filter: EntryFilter<Filters> | undefined;

          if (searchScope === "category") {
            filter = {
              name: "category" as const,
              value: selectedCategory,
            };
          } else if (searchScope === "file" && selectedDocument) {
            filter = {
              name: "filename" as const,
              value: selectedDocument.filename,
            };
          }

          const globalNamespace =
            searchScope === "general"
              ? searchGlobal
              : searchScope === "category"
                ? categorySearchGlobal
                : searchScope === "file" && selectedDocument
                  ? selectedDocument.global
                  : searchGlobal;

          const questionResults = await convex.action(api.example.askQuestion, {
            prompt: searchQuery,
            globalNamespace: globalNamespace || false,
            filter,
            limit,
            chunkContext,
            searchType,
          });

          const questionSources = questionResults?.files || [];

          const formattedSearchResults = {
            ...questionResults,
            results: questionResults.results.map((result) => ({
              ...result,
              entry: questionSources.find((s) => s.entryId === result.entryId)!,
            })),
          };

          // Set search results
          setSearchResults(formattedSearchResults);
          setQuestionResult({
            answer: questionResults.answer,
            results: questionResults.results.map((result) => ({
              ...result,
              entry: questionSources.find((s) => s.entryId === result.entryId)!,
            })),
            files: questionSources,
          });
        } else {
          // Handle search mode (existing logic)
          let results;
          switch (searchScope) {
            case "general":
              results = await convex.action(api.example.search, {
                query: searchQuery,
                globalNamespace: searchGlobal,
                limit,
                chunkContext,
                searchType,
              });
              break;
            case "category":
              results = await convex.action(api.example.searchCategory, {
                query: searchQuery,
                globalNamespace: categorySearchGlobal,
                category: selectedCategory,
                limit,
                chunkContext,
                searchType,
              });
              break;
            case "file":
              results = await convex.action(api.example.searchFile, {
                query: searchQuery,
                globalNamespace: selectedDocument!.global || false,
                filename: selectedDocument!.filename || "",
                limit,
                chunkContext,
                searchType,
              });
              break;
            default:
              throw new Error(`Unknown search scope: ${searchScope}`);
          }
          const sources = results?.files || [];
          setSearchResults({
            ...results,
            results: results.results.map((result: any) => ({
              ...result,
              entry: sources.find((s: any) => s.entryId === result.entryId)!,
            })),
          });
        }
      } catch (error) {
        console.error("Search/Question failed:", error);
        alert(
          `${mode === "question" ? "Question" : "Search"} failed. ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setIsSearching(false);
      }
    },
    [
      searchQuery,
      searchScope,
      searchGlobal,
      selectedDocument,
      selectedCategory,
      convex,
      categorySearchGlobal,
      limit,
      chunksBefore,
      chunksAfter,
      searchType,
    ],
  );

  const handleFileSelect = (file: PublicFile | null) => {
    setSelectedDocument(file);
    if (file) {
      setSearchScope("file");
    }
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSearchScope("category");
  };

  const handleSearchTypeChange = (type: SearchScope, global: boolean) => {
    setSearchScope(type);
    setSearchGlobal(global);
    setSelectedDocument(null);
  };

  useEffect(() => {
    setSearchResults(null);
    setQuestionResult(null);
  }, [searchScope]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex">
      {/* Left Panel - Document List */}
      <div className="w-80 bg-white/90 backdrop-blur-sm border-r border-gray-200/50 flex flex-col shadow-xl">
        <UploadSection />
        <FileList
          onFileSelect={handleFileSelect}
          onCategorySelect={handleCategorySelect}
          onSearchTypeChange={handleSearchTypeChange}
          selectedDocument={selectedDocument}
          onCategoriesChange={setCategories}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        <SearchInterface
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearch={handleSearch}
          isSearching={isSearching}
          searchScope={searchScope}
          setSearchScope={setSearchScope}
          searchGlobal={searchGlobal}
          setSearchGlobal={setSearchGlobal}
          categorySearchGlobal={categorySearchGlobal}
          setCategorySearchGlobal={setCategorySearchGlobal}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          selectedDocument={selectedDocument}
          limit={limit}
          setLimit={setLimit}
          chunksBefore={chunksBefore}
          setChunksBefore={setChunksBefore}
          chunksAfter={chunksAfter}
          setChunksAfter={setChunksAfter}
          categories={categories}
          searchType={searchType}
          setSearchType={setSearchType}
        />

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Question Results */}
          {questionResult && (
            <div className="space-y-6">
              {/* Generated Answer */}
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl border border-purple-200 p-8 shadow-lg">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl flex items-center justify-center shadow-lg">
                    <span className="text-white text-lg">🤖</span>
                  </div>
                  <h3 className="text-xl font-bold text-purple-900">
                    Generated Answer
                  </h3>
                </div>
                <div className="max-w-none text-gray-900 leading-relaxed">
                  <div className="markdown-content text-gray-900">
                    <MarkdownRenderer>{questionResult.answer}</MarkdownRenderer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Document Chunks for File queries */}
          {searchScope === "file" &&
            selectedDocument &&
            documentChunks.status !== "LoadingFirstPage" &&
            !searchResults && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6 h-full shadow-lg">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-blue-900">
                    Document Chunks ({documentChunks.results.length || 0})
                  </h3>
                </div>
                {selectedDocument.url && (
                  <div className="mb-6">
                    {selectedDocument.isImage ? (
                      <div className="bg-white rounded-2xl p-4 shadow-lg">
                        <img
                          src={selectedDocument.url}
                          alt={selectedDocument.filename}
                          className="h-auto max-h-96 object-contain rounded-xl w-full"
                        />
                      </div>
                    ) : (
                      <a
                        href={selectedDocument.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-2 bg-white hover:bg-gray-50 px-4 py-3 rounded-xl border border-gray-200 transition-all duration-200 hover:shadow-md"
                      >
                        <svg
                          className="w-5 h-5 text-blue-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                        <span className="text-blue-600 font-medium">
                          {selectedDocument.filename}
                        </span>
                      </a>
                    )}
                  </div>
                )}
                <div
                  className="overflow-y-auto space-y-4"
                  style={{ height: "calc(100% - 8rem)" }}
                >
                  {documentChunks.results.map((chunk) => (
                    <div
                      key={chunk.order}
                      className="flex items-start space-x-4 group"
                    >
                      <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-md">
                        {chunk.order}
                      </div>
                      <div className="flex-1 bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200/50 shadow-sm group-hover:shadow-md transition-all duration-200">
                        <div className="text-sm text-gray-900 leading-relaxed font-medium">
                          {chunk.text}
                        </div>
                      </div>
                    </div>
                  ))}
                  {documentChunks.status === "CanLoadMore" && (
                    <div className="flex justify-center mt-6">
                      <button
                        onClick={() => documentChunks.loadMore(10)}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-300"
                      >
                        <div className="flex items-center space-x-2">
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Load More</span>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

          {/* Search Results */}
          {searchResults && (
            <div className="space-y-6">
              {/* Sources Section */}
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl border border-gray-200 p-6 shadow-lg">
                <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <div className="w-8 h-8 bg-gradient-to-r from-gray-600 to-gray-700 rounded-lg flex items-center justify-center mr-3">
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  Sources
                </h4>
                {searchResults.files && searchResults.files.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {searchResults.files.map((doc, index) => (
                      <div
                        key={index}
                        className="inline-flex items-center space-x-3 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-xl px-4 py-3 shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        <div className="w-6 h-6 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                        </div>
                        {doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors duration-200"
                          >
                            {doc.title || doc.url}
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-gray-700">
                            {doc.title || doc.filename}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Results Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">
                      Search Results ({searchResults.results.length})
                    </h3>
                  </div>
                  <div className="flex items-center space-x-4 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-xl border border-gray-200">
                    <span className="text-sm text-gray-700 font-medium">
                      Individual Results
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowFullText(!showFullText)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                        showFullText
                          ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                          : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md ${
                          showFullText ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <span className="text-sm text-gray-700 font-medium">
                      Combined Context
                    </span>
                  </div>
                </div>

                {showFullText && searchResults.text ? (
                  <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-6 shadow-lg">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-8 h-8 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-lg flex items-center justify-center">
                        <svg
                          className="w-4 h-4 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                      </div>
                      <h4 className="text-lg font-bold text-emerald-900">
                        Complete Search Text
                      </h4>
                    </div>
                    <div
                      className="text-sm text-gray-900 whitespace-pre-line leading-relaxed bg-white/60 backdrop-blur-sm p-4 rounded-xl border border-emerald-200/50 font-medium"
                      style={{ whiteSpace: "pre-line" }}
                    >
                      {searchResults.text}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {searchResults.results.map((result, index) => (
                      <div
                        key={index}
                        className="flex items-start space-x-4 group"
                      >
                        <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-md">
                          {index + 1}
                        </div>
                        <div className="flex-1 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-6 shadow-sm group-hover:shadow-lg transition-all duration-300">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
                                <svg
                                  className="w-4 h-4 text-white"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                              </div>
                              <div className="text-sm font-bold text-gray-900">
                                {result.entry.title || result.entry.filename}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500">
                                Score:
                              </span>
                              <div className="px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-white text-xs font-bold rounded-full">
                                {result.score.toFixed(3)}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {result.content.map((content, contentIndex) => {
                              const isHighlighted =
                                contentIndex + result.startOrder ===
                                result.order;

                              return (
                                <div
                                  key={contentIndex}
                                  className={`p-4 rounded-xl border transition-all duration-200 ${
                                    isHighlighted
                                      ? "border-yellow-300 bg-gradient-to-r from-yellow-50 to-amber-50 shadow-md"
                                      : "border-gray-200 bg-gray-50/80"
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="w-full text-sm leading-relaxed text-gray-900 font-medium whitespace-pre-wrap">
                                        {content.text}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!searchResults && !questionResult && (
            <div className="text-center py-16">
              {isSearching ? (
                <div className="flex flex-col items-center space-y-4">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <h3 className="text-xl font-bold text-gray-600">
                    Searching...
                  </h3>
                  <p className="text-gray-500">
                    Please wait while we search your documents
                  </p>
                </div>
              ) : (
                <>
                  <div className="w-24 h-24 bg-gradient-to-r from-gray-200 to-gray-300 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <svg
                      className="w-12 h-12 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-600 mb-2">
                    Ready to Search or Ask
                  </h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Use the 🔍 button to search your documents or the Ask button
                    to get AI-generated answers using search context.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Example;
