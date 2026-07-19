import type { Design } from "@netdesign/schema";

/**
 * Hand-maintained mirror of supabase/migrations/0001_init.sql. Kept minimal
 * (one table) deliberately — see BUILD_PLAN Sessions 7-8 for versioning,
 * which is explicitly out of scope right now.
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          prompt: string;
          design_json?: Design | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
