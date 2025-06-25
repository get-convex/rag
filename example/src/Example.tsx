import "./Example.css";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useCallback, useState } from "react";

type SearchType = "global" | "user" | "category" | "document";

interface SearchResult {
  results: {
    content: Array<{
      metadata?: { [x: string]: any };
      text: string;
    }>;
    documentId: string;
    order: number;
    score: number;
    startOrder: number;
  }[];
  text: string[];
  sources: Array<{
    url?: string;
    title?: string;
    documentId?: string;
    storageId?: string;
  }>;
}

function Example() {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    globalNamespace: false,
    category: "",
    filename: "",
  });

  const [searchType, setSearchType] = useState<SearchType>("global");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Set<number>>(
    new Set()
  );

  // Actions and queries
  const uploadFile = useAction(api.example.uploadFile);
  const search = useAction(api.example.search);
  const searchDocument = useAction(api.example.searchDocument);
  const searchCategory = useAction(api.example.searchCategory);

  const globalDocuments = useQuery(api.example.listDocuments, {
    globalNamespace: true,
    paginationOpts: { numItems: 50, cursor: null },
  });

  const userDocuments = useQuery(api.example.listDocuments, {
    globalNamespace: false,
    paginationOpts: { numItems: 50, cursor: null },
  });

  const handleFileSelect = useCallback(
    (file: File) => {
      setSelectedFile(file);
      // Auto-populate filename if it's empty
      if (!uploadForm.filename.trim()) {
        setUploadForm((prev) => ({ ...prev, filename: file.name }));
      }
    },
    [uploadForm.filename]
  );

  const handleFileUpload = useCallback(async () => {
    if (!selectedFile) {
      alert("Please select a file first");
      return;
    }

    if (!uploadForm.category.trim()) {
      alert("Please enter a category");
      return;
    }

    setIsUploading(true);
    try {
      const result = await uploadFile({
        bytes: await selectedFile.arrayBuffer(),
        filename: uploadForm.filename || selectedFile.name,
        mimeType: selectedFile.type,
        category: uploadForm.category,
        globalNamespace: uploadForm.globalNamespace,
      });

      // Reset form and file
      setUploadForm({
        globalNamespace: false,
        category: "",
        filename: "",
      });
      setSelectedFile(null);

      // Clear file input
      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile, uploadForm, selectedFile]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    if (searchType === "document" && !selectedDocument) {
      alert("Please select a document for document search");
      return;
    }

    if (searchType === "category" && !selectedCategory.trim()) {
      alert("Please select a category for category search");
      return;
    }

    setIsSearching(true);
    try {
      let results;
      switch (searchType) {
        case "global":
          results = await search({
            query: searchQuery,
            globalNamespace: true,
          });
          break;
        case "user":
          results = await search({
            query: searchQuery,
            globalNamespace: false,
          });
          break;
        case "category":
          // searchCategory returns {}, so we'll use regular search with filters
          results = await search({
            query: searchQuery,
            globalNamespace: true,
          });
          // Filter results by category on the client side for now
          if (results && results.results) {
            results.results = results.results.filter(
              (result: any) =>
                result.document && result.document.category === selectedCategory
            );
          }
          break;
        case "document":
          results = await searchDocument({
            query: searchQuery,
            globalNamespace: selectedDocument.global || false,
            filename: selectedDocument.filename || "",
          });
          break;
      }
      setSearchResults(results || null);
    } catch (error) {
      console.error("Search failed:", error);
      alert("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  }, [
    searchQuery,
    searchType,
    selectedDocument,
    selectedCategory,
    search,
    searchDocument,
    searchCategory,
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
    globalDocuments?.page?.forEach((doc) => categories.add(doc.category));
    userDocuments?.page?.forEach((doc) => categories.add(doc.category));
    return Array.from(categories).sort();
  };

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
                type="text"
                value={uploadForm.category}
                onChange={(e) =>
                  setUploadForm((prev) => ({
                    ...prev,
                    category: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter category"
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

            <div className="flex items-center">
              <input
                type="checkbox"
                id="globalNamespace"
                checked={uploadForm.globalNamespace}
                onChange={(e) =>
                  setUploadForm((prev) => ({
                    ...prev,
                    globalNamespace: e.target.checked,
                  }))
                }
                className="mr-2"
              />
              <label
                htmlFor="globalNamespace"
                className="text-sm text-gray-700"
              >
                Global (shared) document
              </label>
            </div>

            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleFileSelect(file);
                }
              }}
              disabled={isUploading}
              className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition disabled:opacity-50"
            />

            {selectedFile && (
              <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                Selected: {selectedFile.name}
              </div>
            )}

            <button
              onClick={handleFileUpload}
              disabled={
                isUploading || !selectedFile || !uploadForm.category.trim()
              }
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isUploading ? "Uploading..." : "Upload Document"}
            </button>

            {isUploading && (
              <div className="text-sm text-blue-600 flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Uploading...
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Global Documents */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">Global Documents</h3>
              <button
                onClick={() => {
                  setSearchType("global");
                  setSelectedDocument(null);
                }}
                className="p-1 text-gray-400 hover:text-blue-600"
                title="Search all global documents"
              >
                🔍
              </button>
            </div>
            <div className="space-y-2">
              {globalDocuments?.page?.map((doc) => (
                <div
                  key={doc._id}
                  className="p-2 border border-gray-200 rounded bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {doc.filename}
                      </div>
                      <button
                        onClick={() => {
                          setSelectedCategory(doc.category);
                          setSearchType("category");
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        {doc.category}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedDocument({ ...doc, global: true });
                        setSearchType("document");
                      }}
                      className="ml-2 p-1 text-gray-400 hover:text-blue-600"
                      title="Search this document"
                    >
                      🔍
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* User Documents */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">User Documents</h3>
              <button
                onClick={() => {
                  setSearchType("user");
                  setSelectedDocument(null);
                }}
                className="p-1 text-gray-400 hover:text-blue-600"
                title="Search all user documents"
              >
                🔍
              </button>
            </div>
            <div className="space-y-2">
              {userDocuments?.page?.map((doc) => (
                <div
                  key={doc._id}
                  className="p-2 border border-gray-200 rounded bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {doc.filename}
                      </div>
                      <button
                        onClick={() => {
                          setSelectedCategory(doc.category);
                          setSearchType("category");
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        {doc.category}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedDocument({ ...doc, global: false });
                        setSearchType("document");
                      }}
                      className="ml-2 p-1 text-gray-400 hover:text-blue-600"
                      title="Search this document"
                    >
                      🔍
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      ;{/* Right Panel - Search */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 p-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Document Search
          </h1>

          {/* Search Type Selector */}
          <div className="flex space-x-4 mb-4">
            {(["global", "user", "category", "document"] as SearchType[]).map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setSearchType(type)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    searchType === type
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)} Search
                </button>
              )
            )}
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

          {/* Document Info for Document Search */}
          {searchType === "document" && selectedDocument && (
            <div className="mb-4 p-3 bg-blue-50 rounded-md">
              <div className="text-sm text-blue-800">
                Searching in: {selectedDocument.filename}
              </div>
            </div>
          )}

          {/* Search Input */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Enter your search query..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {searchResults && (
            <div className="space-y-6">
              {/* Sources */}
              {searchResults.sources && searchResults.sources.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Sources</h3>
                  <div className="space-y-2">
                    {searchResults.sources.map((source, index) => (
                      <div key={index} className="flex items-center">
                        {source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            {source.title || source.url}
                          </a>
                        ) : (
                          <span className="text-gray-700">{source.title}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Results */}
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">
                  Results ({searchResults.results.length})
                </h3>
                {searchResults.results.map((result, index) => (
                  <div
                    key={index}
                    className="bg-white rounded-lg border border-gray-200 p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-medium text-gray-900">
                        Document: {result.documentId || "Unknown"}
                      </div>
                      <div className="text-sm text-gray-500">
                        Overall Score: {result.score.toFixed(3)}
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
                                ? "border-yellow-300 bg-yellow-50"
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
                                      ? Math.min(
                                          displayText.split("\n").length,
                                          10
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
                              <div className="ml-3 text-xs text-gray-500">
                                Position: {contentIndex + result.startOrder}
                                {isHighlighted && (
                                  <div className="text-yellow-700 font-medium mt-1">
                                    Score: {result.score.toFixed(3)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!searchResults && (
            <div className="text-center text-gray-500 mt-8">
              Enter a search query to see results
            </div>
          )}
        </div>
      </div>
      ;
    </div>
  );
}

export default Example;
