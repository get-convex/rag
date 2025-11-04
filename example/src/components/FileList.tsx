import { useCallback, useEffect } from "react";
import { useConvex, useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "../../convex/_generated/api";
import type { PublicFile } from "../../convex/example";

interface FileListProps {
  onFileSelect: (file: PublicFile | null) => void;
  onCategorySelect: (category: string) => void;
  onSearchTypeChange: (type: "general", global: boolean) => void;
  onCategoriesChange: (categories: string[]) => void;
  selectedDocument: PublicFile | null;
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
      (chunk) => chunk.state === "ready",
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
                {doc.global ? "🌍 Shared" : "👤 User"}
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

export function FileList({
  onFileSelect,
  onCategorySelect,
  onSearchTypeChange,
  onCategoriesChange,
  selectedDocument,
}: FileListProps) {
  const convex = useConvex();

  const globalFiles = usePaginatedQuery(
    api.example.listFiles,
    {
      globalNamespace: true,
    },
    { initialNumItems: 10 },
  );

  const userFiles = usePaginatedQuery(
    api.example.listFiles,
    {
      globalNamespace: false,
    },
    { initialNumItems: 10 },
  );

  const pendingFiles = useQuery(api.example.listPendingFiles);

  const handleDelete = useCallback(
    async (doc: PublicFile) => {
      try {
        await convex.mutation(api.example.deleteFile, {
          entryId: doc.entryId,
        });

        // Clear selected entry if it was the one being deleted
        if (selectedDocument?.entryId === doc.entryId) {
          onFileSelect(null);
        }
      } catch (error) {
        console.error("Delete failed:", error);
        alert(
          `Failed to delete entry. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [convex, selectedDocument, onFileSelect],
  );

  useEffect(() => {
    const categories = new Set<string>();
    globalFiles?.results?.forEach(
      (doc) => doc.category && categories.add(doc.category),
    );
    userFiles?.results?.forEach(
      (doc) => doc.category && categories.add(doc.category),
    );
    onCategoriesChange(Array.from(categories).sort());
  }, [globalFiles?.results, userFiles?.results, onCategoriesChange]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Pending Files Status */}
      {pendingFiles && pendingFiles.length > 0 && (
        <div className="p-6 border-b border-gray-200/50">
          <div className="space-y-3">
            <div className="flex items-center mb-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gradient-to-r from-orange-500 to-red-500 mr-3"></div>
              <h4 className="text-sm font-semibold text-orange-800">
                Processing {pendingFiles.length} document
                {pendingFiles.length !== 1 ? "s" : ""}...
              </h4>
            </div>
            {pendingFiles.map((doc) => (
              <PendingDocumentProgress key={doc.entryId} doc={doc} />
            ))}
          </div>
        </div>
      )}

      {/* Shared Files */}
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
            <h3 className="font-bold text-gray-900">Shared Files</h3>
          </div>
          <button
            onClick={() => onSearchTypeChange("general", true)}
            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
            title="Search all shared documents"
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
                  onClick={() => onFileSelect(doc)}
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
                            onCategorySelect(doc.category!);
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
            onClick={() => onSearchTypeChange("general", false)}
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
                  onClick={() => onFileSelect({ ...doc, global: false })}
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
                            onCategorySelect(doc.category!);
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
  );
}
