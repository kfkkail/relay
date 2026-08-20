"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function FileViewerBackButton() {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  }

  return (
    <button className="file-viewer-back" type="button" onClick={goBack}>
      <ArrowLeft size={19} />
      <span>Go back</span>
    </button>
  );
}
