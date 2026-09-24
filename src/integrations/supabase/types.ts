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
  public: {
    Tables: {
      ride_group_members: {
        Row: {
          group_id: string
          id: string
          joined_at: string
          meeting_point_agreed: boolean
          request_id: string
          student_id: string
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string
          meeting_point_agreed?: boolean
          request_id: string
          student_id: string
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string
          meeting_point_agreed?: boolean
          request_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ride_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_group_members_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "ride_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_groups: {
        Row: {
          created_at: string
          created_by: string
          departure_time: string
          destination_text: string
          id: string
          meeting_point_text: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          departure_time: string
          destination_text: string
          id?: string
          meeting_point_text: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          departure_time?: string
          destination_text?: string
          id?: string
          meeting_point_text?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ride_requests: {
        Row: {
          created_at: string
          departure_time: string
          destination_latitude: number | null
          destination_longitude: number | null
          destination_text: string
          group_id: string | null
          id: string
          meeting_point_text: string | null
          origin_latitude: number | null
          origin_longitude: number | null
          origin_text: string
          status: Database["public"]["Enums"]["ride_request_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          departure_time: string
          destination_latitude?: number | null
          destination_longitude?: number | null
          destination_text: string
          group_id?: string | null
          id?: string
          meeting_point_text?: string | null
          origin_latitude?: number | null
          origin_longitude?: number | null
          origin_text: string
          status?: Database["public"]["Enums"]["ride_request_status"]
          student_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          departure_time?: string
          destination_latitude?: number | null
          destination_longitude?: number | null
          destination_text?: string
          group_id?: string | null
          id?: string
          meeting_point_text?: string | null
          origin_latitude?: number | null
          origin_longitude?: number | null
          origin_text?: string
          status?: Database["public"]["Enums"]["ride_request_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_requests_group_fk"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ride_groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_group_member: { Args: { p_group_id: string }; Returns: Json }
      agree_meeting_point: { Args: { p_group_id: string }; Returns: undefined }
      destinations_compatible: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      get_ride_group: { Args: { p_group_id: string }; Returns: Json }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      match_ride_request: { Args: { p_request_id: string }; Returns: Json }
      normalize_place: { Args: { _t: string }; Returns: string }
      pick_compatible_requests: {
        Args: { _exclude: string[]; _limit: number; _ref: string }
        Returns: string[]
      }
      refresh_group_status: { Args: { _group_id: string }; Returns: undefined }
    }
    Enums: {
      ride_request_status: "draft" | "searching" | "cancelled"
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
  public: {
    Enums: {
      ride_request_status: ["draft", "searching", "cancelled"],
    },
  },
} as const
