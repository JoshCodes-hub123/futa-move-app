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
      locations: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["location_category"]
          created_at: string
          description: string | null
          display_order: number
          google_place_id: string | null
          id: string
          image_url: string | null
          latitude: number | null
          location_type: string
          longitude: number | null
          name: string
          official_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["location_category"]
          created_at?: string
          description?: string | null
          display_order?: number
          google_place_id?: string | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          location_type: string
          longitude?: number | null
          name: string
          official_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["location_category"]
          created_at?: string
          description?: string | null
          display_order?: number
          google_place_id?: string | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          location_type?: string
          longitude?: number | null
          name?: string
          official_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ride_group_members: {
        Row: {
          confirmed_version: number | null
          group_id: string
          id: string
          joined_at: string
          meeting_point_agreed: boolean
          request_id: string
          student_id: string
        }
        Insert: {
          confirmed_version?: number | null
          group_id: string
          id?: string
          joined_at?: string
          meeting_point_agreed?: boolean
          request_id: string
          student_id: string
        }
        Update: {
          confirmed_version?: number | null
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
          meeting_point_location_id: string | null
          meeting_point_note: string | null
          meeting_point_text: string
          meeting_point_version: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          departure_time: string
          destination_text: string
          id?: string
          meeting_point_location_id?: string | null
          meeting_point_note?: string | null
          meeting_point_text: string
          meeting_point_version?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          departure_time?: string
          destination_text?: string
          id?: string
          meeting_point_location_id?: string | null
          meeting_point_note?: string | null
          meeting_point_text?: string
          meeting_point_version?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_groups_meeting_point_location_id_fkey"
            columns: ["meeting_point_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_requests: {
        Row: {
          created_at: string
          departure_time: string
          destination_latitude: number | null
          destination_location_id: string | null
          destination_longitude: number | null
          destination_point_id: string | null
          destination_text: string
          group_id: string | null
          id: string
          meeting_point_text: string | null
          origin_latitude: number | null
          origin_location_id: string | null
          origin_longitude: number | null
          origin_point_id: string | null
          origin_text: string
          party_size: number
          ride_type: string
          status: Database["public"]["Enums"]["ride_request_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          departure_time: string
          destination_latitude?: number | null
          destination_location_id?: string | null
          destination_longitude?: number | null
          destination_point_id?: string | null
          destination_text: string
          group_id?: string | null
          id?: string
          meeting_point_text?: string | null
          origin_latitude?: number | null
          origin_location_id?: string | null
          origin_longitude?: number | null
          origin_point_id?: string | null
          origin_text: string
          party_size?: number
          ride_type?: string
          status?: Database["public"]["Enums"]["ride_request_status"]
          student_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          departure_time?: string
          destination_latitude?: number | null
          destination_location_id?: string | null
          destination_longitude?: number | null
          destination_point_id?: string | null
          destination_text?: string
          group_id?: string | null
          id?: string
          meeting_point_text?: string | null
          origin_latitude?: number | null
          origin_location_id?: string | null
          origin_longitude?: number | null
          origin_point_id?: string | null
          origin_text?: string
          party_size?: number
          ride_type?: string
          status?: Database["public"]["Enums"]["ride_request_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_requests_destination_location_id_fkey"
            columns: ["destination_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_requests_group_fk"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ride_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_requests_origin_location_id_fkey"
            columns: ["origin_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      student_profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          current_submission_id: string | null
          faculty: string | null
          full_name: string | null
          id: string
          matric_number: string | null
          rejection_reason: string | null
          submitted_at: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["student_verification_status"]
          verified_at: string | null
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          current_submission_id?: string | null
          faculty?: string | null
          full_name?: string | null
          id: string
          matric_number?: string | null
          rejection_reason?: string | null
          submitted_at?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["student_verification_status"]
          verified_at?: string | null
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          current_submission_id?: string | null
          faculty?: string | null
          full_name?: string | null
          id?: string
          matric_number?: string | null
          rejection_reason?: string | null
          submitted_at?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["student_verification_status"]
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_current_submission_fk"
            columns: ["current_submission_id"]
            isOneToOne: false
            referencedRelation: "verification_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_submissions: {
        Row: {
          avatar_path: string
          created_at: string
          faculty: string
          full_name: string
          id: string
          id_card_path: string
          matric_number: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["student_verification_status"]
          student_id: string
        }
        Insert: {
          avatar_path: string
          created_at?: string
          faculty: string
          full_name: string
          id?: string
          id_card_path: string
          matric_number: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["student_verification_status"]
          student_id: string
        }
        Update: {
          avatar_path?: string
          created_at?: string
          faculty?: string
          full_name?: string
          id?: string
          id_card_path?: string
          matric_number?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["student_verification_status"]
          student_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_group_member: { Args: { p_group_id: string }; Returns: Json }
      agree_meeting_point: { Args: { p_group_id: string }; Returns: undefined }
      claim_student_role: { Args: never; Returns: string }
      confirm_meeting_point: {
        Args: { p_group_id: string; p_version?: number }
        Returns: undefined
      }
      destinations_compatible: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      dropoff_radius_m: { Args: never; Returns: number }
      geo_distance_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      get_my_role: { Args: never; Returns: string }
      get_ride_group: { Args: { p_group_id: string }; Returns: Json }
      group_organizer: { Args: { _group_id: string }; Returns: string }
      group_passenger_count: { Args: { _group_id: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_verified_student: { Args: { _user_id: string }; Returns: boolean }
      leave_ride_group: { Args: { p_group_id: string }; Returns: undefined }
      match_ride_request: { Args: { p_request_id: string }; Returns: Json }
      match_time_tolerance: { Args: never; Returns: string }
      normalize_place: { Args: { _t: string }; Returns: string }
      pick_compatible_requests: {
        Args: {
          _exclude: string[]
          _group_id: string
          _ref: string
          _seats: number
        }
        Returns: string[]
      }
      pickup_radius_m: { Args: never; Returns: number }
      places_compatible: {
        Args: {
          a_id: string
          a_lat: number
          a_lng: number
          a_text: string
          b_id: string
          b_lat: number
          b_lng: number
          b_text: string
          radius_m: number
        }
        Returns: boolean
      }
      refresh_group_status: { Args: { _group_id: string }; Returns: undefined }
      release_request_from_group: {
        Args: { _group_id: string; _request_id: string }
        Returns: undefined
      }
      requests_compatible: {
        Args: {
          a: Database["public"]["Tables"]["ride_requests"]["Row"]
          b: Database["public"]["Tables"]["ride_requests"]["Row"]
        }
        Returns: boolean
      }
      review_verification: {
        Args: { p_approve: boolean; p_reason?: string; p_submission_id: string }
        Returns: undefined
      }
      ride_capacity: { Args: never; Returns: number }
      set_meeting_point: {
        Args: { p_group_id: string; p_location_id: string; p_note?: string }
        Returns: undefined
      }
      submit_verification: {
        Args: {
          p_avatar_path: string
          p_faculty: string
          p_full_name: string
          p_id_card_path: string
          p_matric: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user" | "student" | "rider"
      location_category: "GATE" | "ACADEMIC" | "HOSTEL"
      ride_request_status: "draft" | "searching" | "cancelled"
      student_verification_status: "pending" | "verified" | "rejected"
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
      app_role: ["admin", "user", "student", "rider"],
      location_category: ["GATE", "ACADEMIC", "HOSTEL"],
      ride_request_status: ["draft", "searching", "cancelled"],
      student_verification_status: ["pending", "verified", "rejected"],
    },
  },
} as const
