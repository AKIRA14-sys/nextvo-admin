export type ImportHistoryItem = {
  id: string;
  source_url: string;
  supplier_host: string;
  status: string;
  imported_title: string;
  error_summary: string;
  created_at: string;
};

export function mergeImportHistory(current: ImportHistoryItem[], incoming: ImportHistoryItem[], limit = 10): ImportHistoryItem[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return Array.from(byId.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, limit);
}
