import { useState, useCallback } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  extractTextFromPdf,
  isPdfFile,
  type PdfExtractionResult,
} from "../pdfUtils";

interface UploadSectionProps {
  onFileUploaded?: () => void;
}

export function UploadSection({ onFileUploaded }: UploadSectionProps) {
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

  const convex = useConvex();

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
    [uploadForm.filename],
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
      'input[type="file"]',
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
        `PDF text extraction failed: ${pdfExtraction.error}\n\nDo you want to upload the PDF file directly instead?`,
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
        'input[type="file"]',
      ) as HTMLInputElement;
      if (fileInput) fileInput.value = "";

      onFileUploaded?.();
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadForm((prev) => ({
        ...prev,
        filename: prev.filename,
      }));
      setSelectedFile(selectedFile);
      alert(
        `Upload failed. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsAdding(false);
    }
  }, [convex, uploadForm, selectedFile, pdfExtraction, onFileUploaded]);

  return (
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
              Shared file
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
                uploadForm.globalNamespace ? "translate-x-6" : "translate-x-1"
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
      </div>
    </div>
  );
}
