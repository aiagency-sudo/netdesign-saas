import type { Design, Finding } from "@netdesign/schema";

/**
 * Hand-maintained mirror of supabase/migrations/0001_init.sql +
 * 0002_project_versions.sql + 0003_generation_rate_limit.sql + 0005_config_import.sql +
 * 0004_waitlist.sql + 0006_sketch_import.sql. projects.design_json/prompt stay a denormalized copy of
 * whichever project_versions row is "current" (current_version_id) — see
 * 0002_project_versions.sql for why.
 */
/** A config-import upload (text kept verbatim) or a sketch-import file manifest entry. */
export type SourceConfigRow = { name: string; text: string } | { name: string; bytes: number };

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          prompt: string;
          design_json: Design | null;
          current_version_id: string | null;
          /** "prompt" (LLM-generated), "config-import", or "sketch-import" — see 0005/0006. */
          source_kind: string;
          /**
           * Config-import: the uploaded config files, stored verbatim as the source of truth.
           * Sketch-import: a manifest of the uploaded diagram files (binary bytes belong in
           * object storage, which is a follow-up) — hence the union.
           */
          source_configs: SourceConfigRow[] | null;
          /**
           * Config-import: advisory findings about the uploaded configuration.
           * Sketch-import: recommended corrections for the diagram. Same shape, same column;
           * kept out of design_json, which must stay valid against design-schema.json.
           */
          findings: Finding[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          prompt: string;
          design_json?: Design | null;
          current_version_id?: string | null;
          source_kind?: string;
          source_configs?: SourceConfigRow[] | null;
          findings?: Finding[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      project_versions: {
        Row: {
          id: string;
          project_id: string;
          design_json: Design;
          prompt: string;
          findings: Finding[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          design_json: Design;
          prompt: string;
          findings?: Finding[] | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_versions"]["Insert"]>;
        Relationships: [];
      };
      generation_events: {
        Row: {
          id: string;
          owner_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["generation_events"]["Insert"]>;
        Relationships: [];
      };
      waitlist: {
        Row: {
          id: string;
          email: string;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          source?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["waitlist"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
