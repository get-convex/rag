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
  const [expandedResults, setExpandedResults] = useState<Set<number>>(
    new Set()
  );
  const [showChunks, setShowChunks] = useState(false);
  const [categorySearchGlobal, setCategorySearchGlobal] = useState(true);
  const [searchResultsExpanded, setSearchResultsExpanded] = useState(false);

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
            "x-global-namespace": uploadForm.globalNamespace.toString(),
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

  const toggleResultExpansion = (index: number) => {
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedResults(newExpanded);
  };

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
    setSearchResultsExpanded(false);
  }, [searchType]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Panel - Document List */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Upload Document
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filename (optional)
              </label>
              <input
                type="text"
                value={uploadForm.filename}
                onChange={(e) =>
                  setUploadForm((prev) => ({
                    ...prev,
                    filename: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Override filename"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700">
                Global (shared) file
              </label>
              <button
                type="button"
                onClick={() =>
                  setUploadForm((prev) => ({
                    ...prev,
                    globalNamespace: !prev.globalNamespace,
                  }))
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  uploadForm.globalNamespace ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    uploadForm.globalNamespace
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
            </div>

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
                    className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                      isAdding
                        ? "border-gray-300 bg-gray-50 cursor-not-allowed"
                        : "border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400"
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center pt-2 pb-2">
                      <svg
                        className="w-6 h-6 mb-2 text-gray-400"
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
                      <p className="text-sm text-gray-500">
                        <span className="font-medium">Click to upload</span> or
                        drag and drop
                      </p>
                      <p className="text-xs text-gray-400">Any file type</p>
                    </div>
                  </label>
                </>
              ) : (
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border-2 border-gray-300">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {selectedFile.name}
                      {selectedFile && isPdfFile(selectedFile) && (
                        <span className="ml-2 text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                          PDF
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {selectedFile.type || "Unknown type"}
                    </div>

                    {/* PDF Extraction Status */}
                    {selectedFile && isPdfFile(selectedFile) && (
                      <div className="mt-2">
                        {pdfExtraction.isExtracting && (
                          <div className="flex items-center text-xs text-blue-600">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
                            Extracting text from PDF...
                          </div>
                        )}

                        {pdfExtraction.result && !pdfExtraction.error && (
                          <div className="text-xs text-green-600">
                            ✓ Text extracted ({pdfExtraction.result.pages}{" "}
                            pages, {pdfExtraction.result.text.length}{" "}
                            characters)
                            {pdfExtraction.result.title && (
                              <div className="text-gray-600">
                                Title: {pdfExtraction.result.title}
                              </div>
                            )}
                          </div>
                        )}

                        {pdfExtraction.error && (
                          <div className="text-xs text-red-600">
                            ⚠ {pdfExtraction.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleFileClear}
                    disabled={isAdding || pdfExtraction.isExtracting}
                    className="ml-3 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove file"
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
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleFileUpload}
              disabled={isAdding || !selectedFile || pdfExtraction.isExtracting}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isAdding
                ? "Creating or updating document..."
                : pdfExtraction.isExtracting
                  ? "Processing PDF..."
                  : selectedFile &&
                      isPdfFile(selectedFile) &&
                      pdfExtraction.result &&
                      !pdfExtraction.error
                    ? "Add Document (Text from PDF)"
                    : "Add Document"}
            </button>

            {isAdding && (
              <div className="text-sm text-orange-600 flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600 mr-2"></div>
                Adding...
              </div>
            )}

            {pendingFiles && pendingFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center mb-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600 mr-2"></div>
                  <h4 className="text-sm font-medium text-orange-800">
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

        <div className="flex-1 overflow-y-auto">
          {/* Global Files */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">Global Files</h3>
              <button
                onClick={() => {
                  setSearchType("general");
                  setSearchGlobal(true);
                  setSelectedDocument(null);
                }}
                className="p-1 text-gray-400 hover:text-blue-600"
                title="Search all global documents"
              >
                🔍
              </button>
            </div>
            <div className="space-y-2">
              {globalFiles?.results?.map((doc) => (
                <div
                  key={doc.entryId}
                  className={`group p-2 border rounded transition-colors ${
                    selectedDocument?.filename === doc.filename &&
                    selectedDocument?.global === true
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-gray-50 hover:bg-gray-100"
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
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {doc.filename}
                      </div>
                      {doc.category && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCategory(doc.category!);
                            setSearchType("category");
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          {doc.category}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc);
                      }}
                      className="ml-2 p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete entry"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* User Files */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">User Files</h3>
              <button
                onClick={() => {
                  setSearchType("general");
                  setSearchGlobal(false);
                  setSelectedDocument(null);
                }}
                className="p-1 text-gray-400 hover:text-blue-600"
                title="Search all user documents"
              >
                🔍
              </button>
            </div>
            <div className="space-y-2">
              {userFiles?.results?.map((doc) => (
                <div
                  key={doc.entryId}
                  className={`group p-2 border rounded transition-colors ${
                    selectedDocument?.filename === doc.filename &&
                    selectedDocument?.global === false
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-gray-50 hover:bg-gray-100"
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
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {doc.filename}
                      </div>
                      {doc.category && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCategory(doc.category!);
                            setSearchType("category");
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          {doc.category}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(doc);
                      }}
                      className="ml-2 p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete entry"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Right Panel - Search/Question */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 p-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            RAG Search & Question
          </h1>

          {/* Query Mode Selector */}
          <div className="flex space-x-2 mb-4">
            <button
              onClick={() => setQueryMode("question")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                queryMode === "question"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              ❓ Ask Question
            </button>
            <button
              onClick={() => setQueryMode("search")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                queryMode === "search"
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              🔍 Search
            </button>
          </div>

          {/* Search Type Selector */}
          <div className="flex items-center justify-between space-x-4 mb-4">
            <div className="flex space-x-4">
              {(["general", "category", "file"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setSearchType(type)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    searchType === type
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {type === "general"
                    ? "General"
                    : type === "category"
                      ? "Category"
                      : "File-Specific"}
                </button>
              ))}
              {/* Document Info for File-specific queries */}
              {searchType === "file" && selectedDocument && (
                <div className="flex items-center justify-between">
                  <div className="text-md text-blue-800">
                    {selectedDocument.filename}
                  </div>
                  {searchResults && (
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-blue-700">Results</span>
                      <button
                        type="button"
                        onClick={() => setShowChunks(!showChunks)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          showChunks ? "bg-blue-600" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            showChunks ? "translate-x-5" : "translate-x-1"
                          }`}
                        />
                      </button>
                      <span className="text-xs text-blue-700">Chunks</span>
                    </div>
                  )}
                </div>
              )}

              {/* Global/User Toggle - only show for general and category search */}
              {(searchType === "general" || searchType === "category") && (
                <div className="flex items-center space-x-3">
                  <span className="text-sm text-gray-600">User Files</span>
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
                        ? "bg-blue-600"
                        : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
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
                  <span className="text-sm text-gray-600">Global Files</span>
                </div>
              )}
            </div>
          </div>

          {/* Category Selector for Category Search */}
          {searchType === "category" && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select a category</option>
                {getUniqueCategories().map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Search/Question Input */}
          <div className="flex space-x-2">
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
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className={`px-6 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition ${
                queryMode === "search" ? "bg-blue-600" : "bg-purple-600"
              }`}
            >
              {isSearching
                ? queryMode === "search"
                  ? "Searching..."
                  : "Asking..."
                : queryMode === "search"
                  ? "Search"
                  : "Ask"}
            </button>
          </div>
        </div>

        {/* Question Results */}
        {questionResult &&
          queryMode === "question" &&
          (searchType !== "file" || !showChunks) && (
            <div className="space-y-6">
              {/* Generated Answer */}
              <div className="bg-white rounded-lg border border-purple-200 p-6">
                <h3 className="font-semibold text-purple-900 mb-3 flex items-center">
                  <span className="mr-2">🤖</span>
                  Generated Answer
                </h3>
                <div className="text-gray-800 leading-relaxed">
                  <div className="markdown-content">
                    <MarkdownRenderer>{questionResult.answer}</MarkdownRenderer>
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Document Chunks for File queries */}
          {searchType === "file" &&
            selectedDocument &&
            documentChunks.status !== "LoadingFirstPage" &&
            (showChunks || !searchResults) && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 h-full">
                <h3 className="font-semibold text-gray-900 mb-3">
                  Document Chunks ({documentChunks.results.length || 0})
                </h3>
                {selectedDocument.url &&
                  (selectedDocument.isImage ? (
                    <img
                      src={selectedDocument.url}
                      alt={selectedDocument.filename}
                      className="h-auto max-h-96 object-contain"
                    />
                  ) : (
                    <a
                      href={selectedDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🔗 {selectedDocument.filename}
                    </a>
                  ))}
                <div
                  className="overflow-y-auto space-y-2"
                  style={{ height: "calc(100% - 3rem)" }}
                >
                  {documentChunks.results.map((chunk) => (
                    <div
                      key={chunk.order}
                      className="flex items-start space-x-2"
                    >
                      <div className="text-xs text-gray-400 font-mono mt-1 flex-shrink-0">
                        {chunk.order}
                      </div>
                      <div className="text-sm bg-gray-50 p-3 rounded border border-gray-200 flex-1">
                        <div className="text-gray-800">{chunk.text}</div>
                      </div>
                    </div>
                  ))}
                  {documentChunks.status === "CanLoadMore" && (
                    <div className="flex justify-center mt-4">
                      <button
                        onClick={() => documentChunks.loadMore(10)}
                        className="text-sm px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700"
                      >
                        Load More
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          {/* Search Results */}
          {searchResults && (searchType !== "file" || !showChunks) && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2 mb-6">
                <h4 className="text-sm font-medium text-gray-700 w-full mb-2">
                  Sources:
                </h4>
                {/* Sources */}
                {searchResults.files && searchResults.files.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {searchResults.files.map((doc, index) => (
                      <div
                        key={index}
                        className="inline-flex items-center space-x-2 bg-gray-100 border border-gray-200 rounded-full px-3 py-1.5 text-sm"
                      >
                        {doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-700 hover:text-gray-900"
                          >
                            {doc.title || doc.url}
                          </a>
                        ) : (
                          <span className="text-gray-700">
                            {doc.title || doc.filename}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Results */}
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">
                  Search Results ({searchResults.results.length})
                </h3>
                {searchResults.results.map((result, index) => (
                  <div key={index} className="flex items-start space-x-2">
                    <div className="text-xs text-gray-400 font-mono mt-1 flex-shrink-0">
                      {index + 1}
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-4 flex-1">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-medium text-gray-900">
                          File: {result.entry.title || result.entry.filename}
                        </div>
                        <div className="text-sm text-gray-500">
                          Score: {result.score.toFixed(3)}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {result.content.map((content, contentIndex) => {
                          const isHighlighted =
                            contentIndex + result.startOrder === result.order;
                          const isExpanded = expandedResults.has(
                            index * 1000 + contentIndex
                          );
                          const displayText = isExpanded
                            ? content.text
                            : content.text.slice(0, 150) +
                              (content.text.length > 150 ? "..." : "");

                          return (
                            <div
                              key={contentIndex}
                              className={`p-3 rounded border ${
                                isHighlighted
                                  ? "border-blue-300 bg-blue-50"
                                  : "border-gray-200 bg-gray-50"
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <textarea
                                    value={displayText}
                                    readOnly
                                    rows={
                                      isExpanded
                                        ? Math.max(
                                            3,
                                            Math.min(
                                              displayText.split("\n").length,
                                              10
                                            )
                                          )
                                        : 3
                                    }
                                    className="w-full resize-none border-none bg-transparent focus:outline-none text-sm"
                                  />
                                  {content.text.length > 150 && (
                                    <button
                                      onClick={() =>
                                        toggleResultExpansion(
                                          index * 1000 + contentIndex
                                        )
                                      }
                                      className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                                    >
                                      {isExpanded ? "Show less" : "Show more"}
                                    </button>
                                  )}
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
            </div>
          )}

          {!searchResults &&
            !questionResult &&
            !(
              searchType === "file" &&
              selectedDocument &&
              documentChunks &&
              showChunks
            ) && (
              <div className="text-center text-gray-500 mt-8">
                {queryMode === "search"
                  ? "Enter a search query to see results"
                  : "Ask a question about your documents to get AI-generated answers with context"}
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
    <div className="group p-2 border-2 border-orange-200 bg-orange-50 rounded transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <div className="animate-pulse w-2 h-2 bg-orange-500 rounded-full"></div>
            <div className="text-sm font-medium text-orange-900 truncate">
              {doc.filename}
            </div>
          </div>
          {doc.category && (
            <div className="text-xs text-orange-700 ml-4">{doc.category}</div>
          )}
          <div className="text-xs text-orange-600 ml-4 space-y-1">
            <div>{doc.global ? "Global" : "User"} • Processing...</div>
            {!chunks?.page?.length ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-orange-500"></div>
                <span>⚙️ Generating text...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <span>📝 Added: {progress.added} chunks</span>
                <span>✅ Live: {progress.live} chunks</span>
                {progress.live > 0 && progress.added > progress.live && (
                  <div className="flex items-center space-x-1">
                    <div className="w-16 bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-orange-500 h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${(progress.live / progress.added) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-xs">
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
