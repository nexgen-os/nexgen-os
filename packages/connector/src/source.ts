// The `sources` row a connector package ships (decision 0011): what exists
// outside, who serves it, its licence and how long what it gives may be kept.
// `registerSource()` of the core writes it.

/**
 * A `sources` row as a connector package ships it (decision 0011): what
 * exists outside, who serves it, its licence and how long what it gives may
 * be kept. The countries a source serves are data of its row, never code.
 */
export interface SourceRow {
  code: string;
  name: string;
  description?: string | null;
  kind?: 'api' | 'file' | 'registry' | 'device' | 'manual' | 'text';
  base_url?: string | null;
  docs_url?: string | null;
  auth?: 'none' | 'api_key' | 'oauth2' | 'certificate' | 'mandate';
  countries?: string[];
  regions?: string[];
  license?: string | null;
  attribution?: string | null;
  retention_days?: number | null;
  redistributable?: boolean;
  /** The package that brings it, `@nexgen-os/<name>`. */
  published_by: string;
}
