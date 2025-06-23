import "./Example.css";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useCallback } from "react";

function Example() {
  const uploadFile = useAction(api.example.uploadFile);

  const handleFileUpload = useCallback(
    async (file: File) => {
      const { fileId, url } = await uploadFile({
        bytes: await file.arrayBuffer(),
        filename: file.name,
        mimeType: file.type,
      });
      setFile({ fileId, url });
    },
    [uploadFile]
  );

  return (
    <>
      <h1>Document Search Component Example</h1>
      <input
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileUpload(file);
        }}
        className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition"
      />
      <div className="card">
        <p>
          See <code>example/convex/example.ts</code> for all the ways to use
          this component
        </p>
      </div>
    </>
  );
}

export default App;
