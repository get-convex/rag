import ReactMarkdown from "react-markdown";

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export function MarkdownRenderer({
  children,
  className = "",
}: MarkdownRendererProps) {
  return (
    <div
      className={`prose prose-lg max-w-none prose-gray prose-pre:bg-white prose-pre:text-gray-900 prose-code:bg-blue-50 prose-code:text-blue-900 prose-code:px-2 prose-code:py-1 prose-code:rounded prose-code:text-sm ${className}`}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
