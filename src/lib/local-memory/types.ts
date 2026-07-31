export interface MemoryEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  source: string;
  project: string;
  path: string;
  modifiedAt: string;
}

export interface MemorySnapshot {
  generatedAt: string;
  scannedPaths: string[];
  entries: MemoryEntry[];
  warnings: string[];
}
