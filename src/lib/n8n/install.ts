// Detects or installs Invenstory's data tables and core workflows in the user's n8n.
// (Phase 2 fills this in.)

export interface InstallInfo {
  base: string;
  projectId: string;
  version: number;
  apiUrl: string;
  tables: Record<string, string>;
  workflows: Record<string, string>;
}
