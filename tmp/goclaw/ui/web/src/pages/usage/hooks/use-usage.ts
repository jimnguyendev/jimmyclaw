import { useState, useEffect, useCallback } from "react";
import { useWs } from "@/hooks/use-ws";
import { Methods } from "@/api/protocol";

export interface UsageRecord {
  agentId: string;
  sessionKey: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface UsageSummary {
  byAgent: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      sessions: number;
    }
  >;
  totalRecords: number;
}

export function useUsage() {
  const ws = useWs();
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRecords = useCallback(
    async (opts?: { agentId?: string; limit?: number; offset?: number }) => {
      if (!ws.isConnected) return;
      setLoading(true);
      try {
        const res = await ws.call<{ records: UsageRecord[]; total?: number }>(Methods.USAGE_GET, {
          agentId: opts?.agentId || undefined,
          limit: opts?.limit,
          offset: opts?.offset,
        });
        setRecords(res.records ?? []);
        setTotal(res.total ?? 0);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [ws],
  );

  const loadSummary = useCallback(async () => {
    if (!ws.isConnected) return;
    try {
      const res = await ws.call<UsageSummary>(Methods.USAGE_SUMMARY);
      setSummary(res);
    } catch {
      // ignore
    }
  }, [ws]);

  useEffect(() => {
    loadRecords();
    loadSummary();
  }, [loadRecords, loadSummary]);

  return { records, total, summary, loading, loadRecords, loadSummary };
}
