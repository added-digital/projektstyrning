export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      customers: {
        Row: {
          client: string
          doc: Json
          id: string
          slug: string
          updated_at: string
        }
        Insert: {
          client: string
          doc?: Json
          id?: string
          slug: string
          updated_at?: string
        }
        Update: {
          client?: string
          doc?: Json
          id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      fortnox_connection: {
        Row: {
          consented_at: string
          consented_by: string | null
          id: boolean
          last_sync_at: string | null
          last_sync_status: string | null
          scopes: string[]
          tenant_id: string
        }
        Insert: {
          consented_at?: string
          consented_by?: string | null
          id?: boolean
          last_sync_at?: string | null
          last_sync_status?: string | null
          scopes?: string[]
          tenant_id: string
        }
        Update: {
          consented_at?: string
          consented_by?: string | null
          id?: boolean
          last_sync_at?: string | null
          last_sync_status?: string | null
          scopes?: string[]
          tenant_id?: string
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          entries_deleted: number
          entries_upserted: number
          error: string | null
          finished_at: string | null
          from_date: string
          id: string
          started_at: string
          status: string
          to_date: string
          trigger: string
        }
        Insert: {
          entries_deleted?: number
          entries_upserted?: number
          error?: string | null
          finished_at?: string | null
          from_date: string
          id?: string
          started_at?: string
          status?: string
          to_date: string
          trigger: string
        }
        Update: {
          entries_deleted?: number
          entries_upserted?: number
          error?: string | null
          finished_at?: string | null
          from_date?: string
          id?: string
          started_at?: string
          status?: string
          to_date?: string
          trigger?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          charge_hours: number
          document_id: number | null
          document_type: string | null
          fortnox_created_at: string | null
          fortnox_customer_id: string | null
          fortnox_customer_name: string | null
          fortnox_id: string
          fortnox_project_id: string | null
          fortnox_project_name: string | null
          fortnox_service_id: string | null
          fortnox_service_name: string | null
          fortnox_updated_by: string | null
          fortnox_user_id: string | null
          invoice_basis_id: number | null
          invoice_text: string | null
          non_invoiceable: boolean
          note: string | null
          raw: Json
          registration_code: string
          synced_at: string
          unit_cost: number | null
          unit_price: number | null
          worked_date: string
          worked_hours: number
          worker_id: string | null
        }
        Insert: {
          charge_hours?: number
          document_id?: number | null
          document_type?: string | null
          fortnox_created_at?: string | null
          fortnox_customer_id?: string | null
          fortnox_customer_name?: string | null
          fortnox_id: string
          fortnox_project_id?: string | null
          fortnox_project_name?: string | null
          fortnox_service_id?: string | null
          fortnox_service_name?: string | null
          fortnox_updated_by?: string | null
          fortnox_user_id?: string | null
          invoice_basis_id?: number | null
          invoice_text?: string | null
          non_invoiceable?: boolean
          note?: string | null
          raw: Json
          registration_code: string
          synced_at?: string
          unit_cost?: number | null
          unit_price?: number | null
          worked_date: string
          worked_hours?: number
          worker_id?: string | null
        }
        Update: {
          charge_hours?: number
          document_id?: number | null
          document_type?: string | null
          fortnox_created_at?: string | null
          fortnox_customer_id?: string | null
          fortnox_customer_name?: string | null
          fortnox_id?: string
          fortnox_project_id?: string | null
          fortnox_project_name?: string | null
          fortnox_service_id?: string | null
          fortnox_service_name?: string | null
          fortnox_updated_by?: string | null
          fortnox_user_id?: string | null
          invoice_basis_id?: number | null
          invoice_text?: string | null
          non_invoiceable?: boolean
          note?: string | null
          raw?: Json
          registration_code?: string
          synced_at?: string
          unit_cost?: number | null
          unit_price?: number | null
          worked_date?: string
          worked_hours?: number
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          active: boolean
          created_at: string
          fortnox_user_id: string | null
          id: string
          name: string
          sort: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          fortnox_user_id?: string | null
          id?: string
          name: string
          sort?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          fortnox_user_id?: string | null
          id?: string
          name?: string
          sort?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_task: {
        Args: { p_project_id: string; p_slug: string; p_task: Json }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
