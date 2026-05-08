"use client";

import { useRouter } from "next/navigation";
import { UploadDropzone, type UploadResult } from "./UploadDropzone";

export function UploadLanding() {
  const router = useRouter();

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground leading-tight">
            Upload a contract.
            <br />
            <span className="text-accent">Define what to extract.</span>
          </h1>
          <p className="mt-4 text-text-secondary max-w-lg mx-auto">
            Drop a PDF and tell the AI which data points you want. We&apos;ll search
            the document carefully for each one and let you edit, search, or ask
            for more.
          </p>
        </div>
        <UploadDropzone
          onUploaded={(result: UploadResult) => {
            router.push(`/report/${encodeURIComponent(result.reportId)}`);
          }}
        />
      </div>
    </main>
  );
}
