import type { Design } from "@netdesign/schema";
import type { Finding } from "@netdesign/config-parse";

/**
 * Hand-maintained mirror of supabase/migrations/0001_init.sql +
 * 0002_project_versions.sql + 0003_generation_rate_limit.sql + 0005_config_import.sql +
 * 0004_waitlist.sql. projects.design_json/prompt stay a denormalized copy of
 * whichever project_versions row is "current" (current_version_id) — see
 * 0002_project_versions.sql for why.
 */
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
          /** "prompt" (LLM-generated) or "config-import" — see 0005_config_import.sql. */
          source_kind: string;
          /** Config-import only: the uploaded files, stored verbatim as the source of truth. */
          source_configs: Array<{ name: string; text: string }> | null;
          /** Config-import only: advisory findings. Kept out of design_json, which must stay schema-valid. */
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
          source_configs?: Array<{ name: string; text: string }> | null;
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
