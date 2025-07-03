import "./Example.css";
import { useQuery, useConvex } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "../convex/_generated/api";
import { useCallback, useState, useEffect } from "react";
import type { EntryFilter, SearchResult } from "@convex-dev/rag";
import type { Filters, PublicFile } from "../convex/example";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  extractTextFromPdf,
  isPdfFile,
  type PdfExtractionResult,
} from "./pdfUtils";

type SearchType = "general" | "category" | "file";
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
  const [isAdding, setIsAdding] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfExtraction, setPdfExtraction] = useState<{
    isExtracting: boolean;
    result: PdfExtractionResult | null;
    error: string | null;
  }>({
    isExtracting: false,
    result: null,
    error: null,
  });
  const [uploadForm, setUploadForm] = useState({
    globalNamespace: false,
    category: "",
    filename: "",
  });

  const [queryMode, setQueryMode] = useState<QueryMode>("question");
  const [searchType, setSearchType] = useState<SearchType>("general");
  const [searchGlobal, setSearchGlobal] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<PublicFile | null>(
    null
  );
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchResults, setSearchResults] = useState<UISearchResult | null>(
    null
  );
  const [questionResult, setQuestionResult] = useState<UIQuestionResult | null>(
    null
  );
  const [isSearching, setIsSearching] = useState(false);
  const [showChunks, setShowChunks] = useState(false);
  const [categorySearchGlobal, setCategorySearchGlobal] = useState(true);
  const [showFullText, setShowFullText] = useState(false);

  // Convex functions
  const convex = useConvex();

  const globalFiles = usePaginatedQuery(
    api.example.listFiles,
    {
      globalNamespace: true,
    },
    { initialNumItems: 10 }
  );

  const userFiles = usePaginatedQuery(
    api.example.listFiles,
    {
      globalNamespace: false,
    },
    { initialNumItems: 10 }
  );

  const pendingFiles = useQuery(api.example.listPendingFiles);

  const documentChunks = usePaginatedQuery(
    api.example.listChunks,
    selectedDocument?.entryId
      ? {
          entryId: selectedDocument.entryId,
          order: "asc",
        }
      : "skip",
    { initialNumItems: 10 }
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setUploadForm((prev) => ({ ...prev, filename: file.name }));

      // Reset PDF extraction state
      setPdfExtraction({
        isExtracting: false,
        result: null,
        error: null,
      });

      // If it's a PDF, extract text
      if (isPdfFile(file)) {
        setPdfExtraction((prev) => ({ ...prev, isExtracting: true }));

        try {
          const extractionResult = await extractTextFromPdf(file);
          setPdfExtraction({
            isExtracting: false,
            result: extractionResult,
            error: null,
          });

          // Auto-populate title from PDF metadata if available
          if (extractionResult.title && !uploadForm.filename) {
            setUploadForm((prev) => ({
              ...prev,
              filename: extractionResult.title || file.name,
            }));
          }
        } catch (error) {
          console.error("PDF extraction failed:", error);
          setPdfExtraction({
            isExtracting: false,
            result: null,
            error:
              error instanceof Error
                ? error.message
                : "Failed to extract PDF text",
          });
        }
      }
    },
    [uploadForm.filename]
  );

  const handleFileClear = useCallback(() => {
    setSelectedFile(null);
    setUploadForm((prev) => ({ ...prev, filename: "" }));
    setPdfExtraction({
      isExtracting: false,
      result: null,
      error: null,
    });
    // Clear file input
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  }, []);

  const handleFileUpload = useCallback(async () => {
    if (!selectedFile) {
      alert("Please select a file first");
      return;
    }

    // For PDFs with extraction errors, ask user if they want to proceed
    if (selectedFile && isPdfFile(selectedFile) && pdfExtraction.error) {
      const proceed = confirm(
        `PDF text extraction failed: ${pdfExtraction.error}\n\nDo you want to upload the PDF file directly instead?`
      );
      if (!proceed) return;
    }

    setIsAdding(true);
    try {
      // Use extracted text for PDFs if available, otherwise use the file
      const pdfResult = pdfExtraction.result;
      const shouldUseExtractedText =
        selectedFile &&
        isPdfFile(selectedFile) &&
        pdfResult &&
        !pdfExtraction.error;

      const filename = uploadForm.filename || selectedFile.name;
      const blob = shouldUseExtractedText
        ? new Blob([new TextEncoder().encode(pdfResult!.text)], {
            type: "text/plain",
          })
        : selectedFile;
      // Upload original file
      if (selectedFile.size > 512 * 1024) {
        // For big files let's do it asynchronously
        await fetch(`${import.meta.env.VITE_CONVEX_SITE_URL}/upload`, {
          method: "POST",
          headers: {
            "x-filename": filename,
            "x-category": uploadForm.category,
            ...(uploadForm.globalNamespace && {
              "x-global-namespace": "true",
            }),
          },
          body: blob,
        });
      } else {
        await convex.action(api.example.addFile, {
          bytes: await blob.arrayBuffer(),
          filename,
          mimeType: blob.type || "text/plain",
          category: uploadForm.category,
          globalNamespace: uploadForm.globalNamespace,
        });
      }

      // Reset form and file
      setUploadForm((prev) => ({
        ...prev,
        filename: "",
      }));
      setSelectedFile(null);
      setPdfExtraction({
        isExtracting: false,
        result: null,
        error: null,
      });

      // Clear file input
      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadForm((prev) => ({
        ...prev,
        filename: prev.filename,
      }));
      setSelectedFile(selectedFile);
      alert(
        `Upload failed. ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsAdding(false);
    }
  }, [convex, uploadForm, selectedFile, pdfExtraction]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    if (searchType === "file" && !selectedDocument) {
      alert("Please select a file to search");
      return;
    }

    if (searchType === "category" && !selectedCategory.trim()) {
      alert("Please select a category for category search");
      return;
    }

    setIsSearching(true);
    setSearchResults(null);
    setQuestionResult(null);

    try {
      if (queryMode === "question") {
        let filter: EntryFilter<Filters> | undefined;

        if (searchType === "category") {
          filter = {
            name: "category" as const,
            value: selectedCategory,
          };
        } else if (searchType === "file" && selectedDocument) {
          filter = {
            name: "filename" as const,
            value: selectedDocument.filename,
          };
        }

        const globalNamespace =
          searchType === "general"
            ? searchGlobal
            : searchType === "category"
              ? categorySearchGlobal
              : searchType === "file" && selectedDocument
                ? selectedDocument.global
                : searchGlobal;

        const questionResults = await convex.action(api.example.askQuestion, {
          prompt: searchQuery,
          globalNamespace: globalNamespace || false,
          filter,
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
        switch (searchType) {
          case "general":
            results = await convex.action(api.example.search, {
              query: searchQuery,
              globalNamespace: searchGlobal,
            });
            break;
          case "category":
            results = await convex.action(api.example.searchCategory, {
              query: searchQuery,
              globalNamespace: categorySearchGlobal,
              category: selectedCategory,
            });
            break;
          case "file":
            results = await convex.action(api.example.searchFile, {
              query: searchQuery,
              globalNamespace: selectedDocument!.global || false,
              filename: selectedDocument!.filename || "",
            });
            break;
          default:
            throw new Error(`Unknown search type: ${searchType}`);
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
        `${queryMode === "question" ? "Question" : "Search"} failed. ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsSearching(false);
    }
  }, [
    searchQuery,
    queryMode,
    searchType,
    searchGlobal,
    selectedDocument,
    selectedCategory,
    convex,
    categorySearchGlobal,
  ]);

  const getUniqueCategories = () => {
    const categories = new Set<string>();
    globalFiles?.results?.forEach(
      (doc) => doc.category && categories.add(doc.category)
    );
    userFiles?.results?.forEach(
      (doc) => doc.category && categories.add(doc.category)
    );
    return Array.from(categories).sort();
  };

  const handleDelete = useCallback(
    async (doc: PublicFile) => {
      try {
        await convex.mutation(api.example.deleteFile, {
          entryId: doc.entryId,
        });

        // Clear selected entry if it was the one being deleted
        if (selectedDocument?.entryId === doc.entryId) {
          setSelectedDocument(null);
        }
      } catch (error) {
        console.error("Delete failed:", error);
        alert(
          `Failed to delete entry. ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [convex, selectedDocument]
  );

  useEffect(() => {
    setSearchResults(null);
    setQuestionResult(null);
  }, [searchType]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex">
      {/* Left Panel - Document List */}
      <div className="w-80 bg-white/90 backdrop-blur-sm border-r border-gray-200/50 flex flex-col shadow-xl">
        {/* Upload Section */}
        <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-blue-50 to-indigo-50">
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
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
              Upload Document
            </h2>
          </div>

          <div className="space-y-4">
            {/* Category Input */}
            <div className="group">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Category
              </label>
              <div className="relative">
                <input
                  id="category"
                  type="text"
                  value={uploadForm.category}
                  onChange={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      category: e.target.value,
                    }))
                  }
                  placeholder="Enter category"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/80 backdrop-blur-sm transition-all duration-200 placeholder-gray-400"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              </div>
            </div>

            {/* Filename Input */}
            <div className="group">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filename{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={uploadForm.filename}
                  onChange={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      filename: e.target.value,
                    }))
                  }
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/80 backdrop-blur-sm transition-all duration-200 placeholder-gray-400"
                  placeholder="Override filename"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              </div>
            </div>

            {/* Global Toggle */}
            <div className="flex items-center justify-between p-4 bg-white/60 rounded-xl border border-gray-200/50">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
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
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-700">
                  Global (shared) file
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setUploadForm((prev) => ({
                    ...prev,
                    globalNamespace: !prev.globalNamespace,
                  }))
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  uploadForm.globalNamespace
                    ? "bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg"
                    : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md ${
                    uploadForm.globalNamespace
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* File Upload Area */}
            <div className="relative">
              {!selectedFile ? (
                <>
                  <input
                    type="file"
                    id="file-upload"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFileSelect(file);
                      }
                    }}
                    disabled={isAdding}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <label
                    htmlFor="file-upload"
                    className={`group flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ${
                      isAdding
                        ? "border-gray-300 bg-gray-50 cursor-not-allowed"
                        : "border-gray-300 bg-gradient-to-br from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 hover:border-blue-400 hover:shadow-lg"
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center pt-4 pb-4">
                      <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-200">
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
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-600">
                        <span className="text-blue-600 font-semibold">
                          Click to upload
                        </span>{" "}
                        or drag and drop
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Any file type supported
                      </p>
                    </div>
                  </label>
                </>
              ) : (
                <div className="relative p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-md">
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
                        <div>
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {selectedFile.name}
                            {selectedFile && isPdfFile(selectedFile) && (
                              <span className="ml-2 text-xs text-white bg-gradient-to-r from-rose-500 to-pink-500 px-2 py-1 rounded-full font-medium">
                                PDF
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {selectedFile.type || "Unknown type"}
                          </div>
                        </div>
                      </div>

                      {/* PDF Extraction Status */}
                      {selectedFile && isPdfFile(selectedFile) && (
                        <div className="mt-3 p-3 bg-white/60 rounded-xl">
                          {pdfExtraction.isExtracting && (
                            <div className="flex items-center text-sm text-blue-600">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
                              <span className="font-medium">
                                Extracting text from PDF...
                              </span>
                            </div>
                          )}

                          {pdfExtraction.result && !pdfExtraction.error && (
                            <div className="space-y-2">
                              <div className="flex items-center text-sm text-emerald-600">
                                <svg
                                  className="w-4 h-4 mr-2"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                                <span className="font-medium">
                                  Text extracted successfully
                                </span>
                              </div>
                              <div className="text-xs text-gray-600 bg-white/50 p-2 rounded-lg">
                                <div>📄 {pdfExtraction.result.pages} pages</div>
                                <div>
                                  📝{" "}
                                  {pdfExtraction.result.text.length.toLocaleString()}{" "}
                                  characters
                                </div>
                                {pdfExtraction.result.title && (
                                  <div className="mt-1 text-gray-700">
                                    <span className="font-medium">Title:</span>{" "}
                                    {pdfExtraction.result.title}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {pdfExtraction.error && (
                            <div className="flex items-center text-sm text-red-600">
                              <svg
                                className="w-4 h-4 mr-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                                />
                              </svg>
                              <span className="font-medium">
                                {pdfExtraction.error}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleFileClear}
                      disabled={isAdding || pdfExtraction.isExtracting}
                      className="ml-3 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group"
                      title="Remove file"
                    >
                      <svg
                        className="w-5 h-5 group-hover:scale-110 transition-transform duration-200"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Upload Button */}
            <button
              onClick={handleFileUpload}
              disabled={isAdding || !selectedFile || pdfExtraction.isExtracting}
              className={`w-full px-6 py-4 font-semibold rounded-xl transition-all duration-300 shadow-lg ${
                isAdding || !selectedFile || pdfExtraction.isExtracting
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white hover:shadow-xl hover:scale-105"
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                {isAdding ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Adding Document...</span>
                  </>
                ) : pdfExtraction.isExtracting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Processing PDF...</span>
                  </>
                ) : selectedFile &&
                  isPdfFile(selectedFile) &&
                  pdfExtraction.result &&
                  !pdfExtraction.error ? (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                    <span>Add Document (Text from PDF)</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                    <span>Add Document</span>
                  </>
                )}
              </div>
            </button>

            {/* Pending Files Status */}
            {pendingFiles && pendingFiles.length > 0 && (
              <div className="space-y-3 mt-6">
                <div className="flex items-center mb-4">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gradient-to-r from-orange-500 to-red-500 mr-3"></div>
                  <h4 className="text-sm font-semibold text-orange-800">
                    Processing {pendingFiles.length} document
                    {pendingFiles.length !== 1 ? "s" : ""}...
                  </h4>
                </div>
                {pendingFiles.map((doc, index) => (
                  <PendingDocumentProgress key={doc.entryId} doc={doc} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* File Lists */}
        <div className="flex-1 overflow-y-auto">
          {/* Global Files */}
          <div className="p-6">
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
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h3 className="font-bold text-gray-900">Global Files</h3>
              </div>
              <button
                onClick={() => {
                  setSearchType("general");
                  setSearchGlobal(true);
                  setSelectedDocument(null);
                }}
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
                title="Search all global documents"
              >
                <svg
                  className="w-5 h-5"
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
              </button>
            </div>
            <div className="space-y-3">
              {globalFiles?.results?.map((doc) => (
                <div
                  key={doc.entryId}
                  className={`group relative p-4 rounded-xl transition-all duration-300 hover:shadow-md ${
                    selectedDocument?.filename === doc.filename &&
                    selectedDocument?.global === true
                      ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 shadow-lg"
                      : "bg-white/60 backdrop-blur-sm border border-gray-200/50 hover:bg-white/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        setSelectedDocument(doc);
                        setSearchType("file");
                      }}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gradient-to-r from-gray-500 to-gray-600 rounded-lg flex items-center justify-center flex-shrink-0">
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
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {doc.filename}
                          </div>
                          {doc.category && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCategory(doc.category!);
                                setSearchType("category");
                              }}
                              className="inline-flex items-center text-xs text-blue-600 hover:text-blue-800 bg-blue-100 hover:bg-blue-200 px-2 py-1 rounded-full transition-colors duration-200 mt-1"
                            >
                              <svg
                                className="w-3 h-3 mr-1"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                                />
                              </svg>
                              {doc.category}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc);
                      }}
                      className="ml-3 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200"
                      title="Delete entry"
                    >
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* User Files */}
          <div className="p-6 border-t border-gray-200/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
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
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
                <h3 className="font-bold text-gray-900">User Files</h3>
              </div>
              <button
                onClick={() => {
                  setSearchType("general");
                  setSearchGlobal(false);
                  setSelectedDocument(null);
                }}
                className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all duration-200"
                title="Search all user documents"
              >
                <svg
                  className="w-5 h-5"
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
              </button>
            </div>
            <div className="space-y-3">
              {userFiles?.results?.map((doc) => (
                <div
                  key={doc.entryId}
                  className={`group relative p-4 rounded-xl transition-all duration-300 hover:shadow-md ${
                    selectedDocument?.filename === doc.filename &&
                    selectedDocument?.global === false
                      ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-200 shadow-lg"
                      : "bg-white/60 backdrop-blur-sm border border-gray-200/50 hover:bg-white/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        setSelectedDocument({ ...doc, global: false });
                        setSearchType("file");
                      }}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gradient-to-r from-gray-500 to-gray-600 rounded-lg flex items-center justify-center flex-shrink-0">
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
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {doc.filename}
                          </div>
                          {doc.category && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCategory(doc.category!);
                                setSearchType("category");
                              }}
                              className="inline-flex items-center text-xs text-emerald-600 hover:text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-2 py-1 rounded-full transition-colors duration-200 mt-1"
                            >
                              <svg
                                className="w-3 h-3 mr-1"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                                />
                              </svg>
                              {doc.category}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc);
                      }}
                      className="ml-3 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200"
                      title="Delete entry"
                    >
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
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

          {/* Query Mode Selector */}
          <div className="flex space-x-2 mb-6">
            <button
              onClick={() => setQueryMode("question")}
              className={`group px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
                queryMode === "question"
                  ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg"
                  : "bg-white/80 text-gray-700 hover:bg-white shadow-sm hover:shadow-md"
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-lg">❓</span>
                <span>Ask Question</span>
              </div>
            </button>
            <button
              onClick={() => setQueryMode("search")}
              className={`group px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
                queryMode === "search"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg"
                  : "bg-white/80 text-gray-700 hover:bg-white shadow-sm hover:shadow-md"
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-lg">🔍</span>
                <span>Search</span>
              </div>
            </button>
          </div>

          {/* Search Type Selector */}
          <div className="flex items-center justify-between space-x-4 mb-6">
            <div className="flex space-x-2">
              {(["general", "category", "file"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setSearchType(type)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                    searchType === type
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
              {searchType === "file" && selectedDocument && (
                <div className="flex items-center space-x-4">
                  <div className="px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                    <div className="text-sm font-semibold text-blue-800">
                      {selectedDocument.filename}
                    </div>
                  </div>
                  {searchResults && (
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-gray-700 font-medium">
                        Results
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowChunks(!showChunks)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          showChunks
                            ? "bg-gradient-to-r from-blue-500 to-indigo-500"
                            : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md ${
                            showChunks ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                      <span className="text-sm text-gray-700 font-medium">
                        Chunks
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Global/User Toggle */}
              {(searchType === "general" || searchType === "category") && (
                <div className="flex items-center space-x-3 bg-white/80 px-4 py-2 rounded-xl border border-gray-200">
                  <span className="text-sm text-gray-600 font-medium">
                    User Files
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (searchType === "general") {
                        setSearchGlobal(!searchGlobal);
                      } else if (searchType === "category") {
                        setCategorySearchGlobal(!categorySearchGlobal);
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      (
                        searchType === "general"
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
                          searchType === "general"
                            ? searchGlobal
                            : categorySearchGlobal
                        )
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-gray-600 font-medium">
                    Global Files
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Category Selector for Category Search */}
          {searchType === "category" && (
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
                  {getUniqueCategories().map((category) => (
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
                  handleSearch();
                }
              }}
              placeholder={
                queryMode === "search"
                  ? "Enter your search query..."
                  : "Ask a question about your documents..."
              }
              className="w-full px-6 py-4 pr-20 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/80 backdrop-blur-sm text-gray-900 placeholder-gray-500 text-lg"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className={`absolute right-2 top-2 bottom-2 px-6 text-white rounded-lg font-semibold transition-all duration-300 ${
                isSearching || !searchQuery.trim()
                  ? "bg-gray-300 cursor-not-allowed"
                  : queryMode === "search"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg hover:shadow-xl"
                    : "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg hover:shadow-xl"
              }`}
            >
              <div className="flex items-center space-x-2">
                {isSearching ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>
                      {queryMode === "search" ? "Searching..." : "Asking..."}
                    </span>
                  </>
                ) : (
                  <>
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
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <span>{queryMode === "search" ? "Search" : "Ask"}</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Question Results */}
          {questionResult &&
            queryMode === "question" &&
            (searchType !== "file" || !showChunks) && (
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
                      <MarkdownRenderer>
                        {questionResult.answer}
                      </MarkdownRenderer>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Document Chunks for File queries */}
          {searchType === "file" &&
            selectedDocument &&
            documentChunks.status !== "LoadingFirstPage" &&
            (showChunks || !searchResults) && (
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
          {searchResults && (searchType !== "file" || !showChunks) && (
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
          {!searchResults &&
            !questionResult &&
            !(
              searchType === "file" &&
              selectedDocument &&
              documentChunks &&
              showChunks
            ) && (
              <div className="text-center py-16">
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
                  {queryMode === "search"
                    ? "Ready to Search"
                    : "Ready to Answer"}
                </h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  {queryMode === "search"
                    ? "Enter a search query to explore your documents and find relevant content"
                    : "Ask a question about your documents to get AI-generated answers with context"}
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function PendingDocumentProgress({ doc }: { doc: PublicFile }) {
  const chunks = useQuery(api.example.listChunks, {
    entryId: doc.entryId,
    order: "desc",
    paginationOpts: { cursor: null, numItems: 100 },
  });

  // Calculate progress info
  const progress = (() => {
    if (!chunks?.page?.length) return { added: 0, live: 0 };

    // Total chunks added (highest order number + 1, since order is 0-based)
    const added = chunks.page[0].order + 1;

    // Find first chunk with state "ready" to get live count
    const firstReadyChunk = chunks.page.find(
      (chunk) => chunk.state === "ready"
    );
    const live = firstReadyChunk ? firstReadyChunk.order + 1 : 0;

    return { added, live };
  })();

  return (
    <div className="group relative p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-2xl shadow-lg transition-all duration-300 hover:shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg flex items-center justify-center">
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
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse"></div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-orange-900 truncate">
                {doc.filename}
              </div>
              {doc.category && (
                <div className="text-xs text-orange-700 font-medium bg-orange-100 px-2 py-1 rounded-full inline-block mt-1">
                  {doc.category}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center text-xs text-orange-600">
              <span className="mr-2">
                {doc.global ? "🌍 Global" : "👤 User"}
              </span>
              <span className="px-2 py-1 bg-orange-100 rounded-full font-medium">
                Processing...
              </span>
            </div>
            {!chunks?.page?.length ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-orange-500"></div>
                <span className="text-xs text-orange-600">
                  ⚙️ Generating text...
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center space-x-4 text-xs text-orange-700">
                  <span className="flex items-center">
                    <span className="w-2 h-2 bg-orange-400 rounded-full mr-1"></span>
                    📝 Added: {progress.added} chunks
                  </span>
                  <span className="flex items-center">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full mr-1"></span>
                    ✅ Live: {progress.live} chunks
                  </span>
                </div>
                {progress.live > 0 && progress.added > progress.live && (
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 bg-orange-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-orange-500 to-amber-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${(progress.live / progress.added) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-xs text-orange-700 font-medium">
                      {Math.round((progress.live / progress.added) * 100)}%
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Example;
