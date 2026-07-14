"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { InterviewSession } from "@/components/session/interview-session";
import { CONNECTION_STORAGE_KEY, parseConnectionDetails } from "@/lib/connection";

const noopSubscribe = () => () => {};

export default function SessionPage() {
  const router = useRouter();
  const rawConnection = useSyncExternalStore(
    noopSubscribe,
    () => sessionStorage.getItem(CONNECTION_STORAGE_KEY),
    () => null,
  );
  const connection = useMemo(
    () => parseConnectionDetails(rawConnection),
    [rawConnection],
  );

  useEffect(() => {
    if (!connection) {
      router.replace("/");
    }
  }, [connection, router]);

  if (!connection) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-neutral-400">Loading session…</p>
      </main>
    );
  }
  return <InterviewSession connection={connection} />;
}
