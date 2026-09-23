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
      borrow_request_serials: {
        Row: {
          id: string
          lent_at: string
          lent_by: string | null
          product_id: string
          request_id: string
          returned_at: string | null
          returned_by: string | null
          serial: string
        }
        Insert: {
          id?: string
          lent_at?: string
          lent_by?: string | null
          product_id: string
          request_id: string
          returned_at?: string | null
          returned_by?: string | null
          serial: string
        }
        Update: {
          id?: string
          lent_at?: string
          lent_by?: string | null
          product_id?: string
          request_id?: string
          returned_at?: string | null
          returned_by?: string | null
          serial?: string
        }
        Relationships: [
          {
            foreignKeyName: "borrow_request_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_request_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_request_serials_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "borrow_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      borrow_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          fulfilled_at: string | null
          id: string
          needed_by: string | null
          product_id: string
          qty_approved: number | null
          qty_requested: number
          qty_returned: number
          reason: string | null
          requested_by: string | null
          return_note: string | null
          returned_at: string | null
          returned_by: string | null
          source_project_id: string
          status: Database["public"]["Enums"]["borrow_status"]
          target_project_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fulfilled_at?: string | null
          id?: string
          needed_by?: string | null
          product_id: string
          qty_approved?: number | null
          qty_requested: number
          qty_returned?: number
          reason?: string | null
          requested_by?: string | null
          return_note?: string | null
          returned_at?: string | null
          returned_by?: string | null
          source_project_id: string
          status?: Database["public"]["Enums"]["borrow_status"]
          target_project_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fulfilled_at?: string | null
          id?: string
          needed_by?: string | null
          product_id?: string
          qty_approved?: number | null
          qty_requested?: number
          qty_returned?: number
          reason?: string | null
          requested_by?: string | null
          return_note?: string | null
          returned_at?: string | null
          returned_by?: string | null
          source_project_id?: string
          status?: Database["public"]["Enums"]["borrow_status"]
          target_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "borrow_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_requests_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_requests_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_requests_target_project_id_fkey"
            columns: ["target_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borrow_requests_target_project_id_fkey"
            columns: ["target_project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      build_line_serials: {
        Row: {
          consumed_at: string
          consumed_by: string | null
          entered_manually: boolean
          id: string
          line_id: string
          product_id: string
          returned_at: string | null
          returned_by: string | null
          serial: string
        }
        Insert: {
          consumed_at?: string
          consumed_by?: string | null
          entered_manually?: boolean
          id?: string
          line_id: string
          product_id: string
          returned_at?: string | null
          returned_by?: string | null
          serial: string
        }
        Update: {
          consumed_at?: string
          consumed_by?: string | null
          entered_manually?: boolean
          id?: string
          line_id?: string
          product_id?: string
          returned_at?: string | null
          returned_by?: string | null
          serial?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_line_serials_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "build_request_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_line_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_line_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
        ]
      }
      build_request_events: {
        Row: {
          actor: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          payload: Json | null
          request_id: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          payload?: Json | null
          request_id: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          payload?: Json | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "build_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      build_request_lines: {
        Row: {
          id: string
          is_key_part: boolean
          line_no: number
          notes: string | null
          origin: string
          product_id: string
          qty_consumed: number
          qty_held: number
          qty_per_unit: number
          qty_required: number
          request_id: string
        }
        Insert: {
          id?: string
          is_key_part?: boolean
          line_no: number
          notes?: string | null
          origin?: string
          product_id: string
          qty_consumed?: number
          qty_held?: number
          qty_per_unit: number
          qty_required: number
          request_id: string
        }
        Update: {
          id?: string
          is_key_part?: boolean
          line_no?: number
          notes?: string | null
          origin?: string
          product_id?: string
          qty_consumed?: number
          qty_held?: number
          qty_per_unit?: number
          qty_required?: number
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_request_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_request_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_request_lines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "build_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      build_requests: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          request_number: string
          request_sequence: number
          requested_by?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["build_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          project_number?: string
          qty?: number
          reject_note?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          request_number?: string
          request_sequence?: number
          requested_by?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["build_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_requests_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "system_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      build_units: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          project_id: string
          request_id: string
          seq: number
          template_id: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          project_id: string
          request_id: string
          seq: number
          template_id: string
          unit_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          project_id?: string
          request_id?: string
          seq?: number
          template_id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_units_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "build_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "build_units_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "system_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustments: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          product_id: string
          project_id: string
          reason: string | null
          source_id: string | null
          source_type: Database["public"]["Enums"]["ledger_source"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          product_id: string
          project_id: string
          reason?: string | null
          source_id?: string | null
          source_type: Database["public"]["Enums"]["ledger_source"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          product_id?: string
          project_id?: string
          reason?: string | null
          source_id?: string | null
          source_type?: Database["public"]["Enums"]["ledger_source"]
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          recipient_user_id: string
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_user_id: string
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_user_id?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      packing_slip_item_serials: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string | null
          serial: string
          slip_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          serial: string
          slip_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          serial?: string
          slip_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_slip_item_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slip_item_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slip_item_serials_slip_item_id_fkey"
            columns: ["slip_item_id"]
            isOneToOne: false
            referencedRelation: "packing_slip_items"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_slip_items: {
        Row: {
          condition: string
          description: string
          id: string
          po_item_id: string | null
          product_id: string | null
          qty_ordered: number
          qty_received: number
          slip_id: string
        }
        Insert: {
          condition?: string
          description: string
          id?: string
          po_item_id?: string | null
          product_id?: string | null
          qty_ordered?: number
          qty_received?: number
          slip_id: string
        }
        Update: {
          condition?: string
          description?: string
          id?: string
          po_item_id?: string | null
          product_id?: string | null
          qty_ordered?: number
          qty_received?: number
          slip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_slip_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slip_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slip_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slip_items_slip_id_fkey"
            columns: ["slip_id"]
            isOneToOne: false
            referencedRelation: "packing_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_slips: {
        Row: {
          attachment_url: string | null
          carrier: string | null
          created_at: string
          id: string
          notes: string | null
          po_id: string
          project_id: string
          project_number: string
          ps_sequence: number
          received_by: string | null
          received_date: string
          slip_number: string
          status: string
          vendor_slip_number: string | null
        }
        Insert: {
          attachment_url?: string | null
          carrier?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          po_id: string
          project_id: string
          project_number: string
          ps_sequence: number
          received_by?: string | null
          received_date?: string
          slip_number: string
          status?: string
          vendor_slip_number?: string | null
        }
        Update: {
          attachment_url?: string | null
          carrier?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          po_id?: string
          project_id?: string
          project_number?: string
          ps_sequence?: number
          received_by?: string | null
          received_date?: string
          slip_number?: string
          status?: string
          vendor_slip_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packing_slips_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_slips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      po_request_lines: {
        Row: {
          custom_description: string | null
          id: string
          line_no: number
          product_id: string | null
          qty: number
          request_id: string
          unit: string
        }
        Insert: {
          custom_description?: string | null
          id?: string
          line_no: number
          product_id?: string | null
          qty: number
          request_id: string
          unit?: string
        }
        Update: {
          custom_description?: string | null
          id?: string
          line_no?: number
          product_id?: string | null
          qty?: number
          request_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_request_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_request_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_request_lines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "po_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      po_requests: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          request_number: string
          request_sequence: number
          requested_by: string | null
          status: Database["public"]["Enums"]["po_request_status"]
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          po_reference?: string | null
          project_id: string
          project_number: string
          request_number: string
          request_sequence: number
          requested_by?: string | null
          status?: Database["public"]["Enums"]["po_request_status"]
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          po_reference?: string | null
          project_id?: string
          project_number?: string
          request_number?: string
          request_sequence?: number
          requested_by?: string | null
          status?: Database["public"]["Enums"]["po_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string
          id: string
          is_serialized: boolean
          part_number: string
          reorder_point: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_serialized?: boolean
          part_number: string
          reorder_point?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_serialized?: boolean
          part_number?: string
          reorder_point?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_engineers: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_engineers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_engineers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      project_managers: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_managers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_managers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          contract_number: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          mkj_number: string
          name: string
          project_manager_id: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          mkj_number: string
          name: string
          project_manager_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          mkj_number?: string
          name?: string
          project_manager_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_project_manager_id_fkey"
            columns: ["project_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          budget_code: string | null
          description: string
          id: string
          line_no: number
          po_id: string
          product_id: string | null
          qty: number
          unit: string
          unit_cost: number
        }
        Insert: {
          budget_code?: string | null
          description: string
          id?: string
          line_no: number
          po_id: string
          product_id?: string | null
          qty: number
          unit?: string
          unit_cost?: number
        }
        Update: {
          budget_code?: string | null
          description?: string
          id?: string
          line_no?: number
          po_id?: string
          product_id?: string | null
          qty?: number
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_pdfs: {
        Row: {
          content_hash: string
          generated_at: string
          generated_by: string | null
          po_id: string
          storage_path: string
        }
        Insert: {
          content_hash: string
          generated_at?: string
          generated_by?: string | null
          po_id: string
          storage_path: string
        }
        Update: {
          content_hash?: string
          generated_at?: string
          generated_by?: string | null
          po_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_pdfs_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: true
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          additional_freight: number | null
          assignee: string | null
          bill_to: string | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          description: string | null
          id: string
          payment_terms: string | null
          po_number: string
          po_sequence: number
          pre_receipt_status: Database["public"]["Enums"]["po_status"] | null
          project_id: string
          project_number: string
          ship_to: string | null
          ship_via: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          terms_conditions: string | null
          updated_at: string
        }
        Insert: {
          additional_freight?: number | null
          assignee?: string | null
          bill_to?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          description?: string | null
          id?: string
          payment_terms?: string | null
          po_number: string
          po_sequence: number
          pre_receipt_status?: Database["public"]["Enums"]["po_status"] | null
          project_id: string
          project_number: string
          ship_to?: string | null
          ship_via?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          terms_conditions?: string | null
          updated_at?: string
        }
        Update: {
          additional_freight?: number | null
          assignee?: string | null
          bill_to?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          description?: string | null
          id?: string
          payment_terms?: string | null
          po_number?: string
          po_sequence?: number
          pre_receipt_status?: Database["public"]["Enums"]["po_status"] | null
          project_id?: string
          project_number?: string
          ship_to?: string | null
          ship_via?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          terms_conditions?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_ticket_item_serials: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string | null
          serial: string
          ticket_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          serial: string
          ticket_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          serial?: string
          ticket_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_ticket_item_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_ticket_item_serials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_ticket_item_serials_ticket_item_id_fkey"
            columns: ["ticket_item_id"]
            isOneToOne: false
            referencedRelation: "shipping_ticket_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_ticket_items: {
        Row: {
          description: string
          id: string
          product_id: string | null
          qty_backordered: number
          qty_shipped: number
          ticket_id: string
        }
        Insert: {
          description: string
          id?: string
          product_id?: string | null
          qty_backordered?: number
          qty_shipped?: number
          ticket_id: string
        }
        Update: {
          description?: string
          id?: string
          product_id?: string | null
          qty_backordered?: number
          qty_shipped?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_ticket_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_ticket_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "shipping_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_ticket_pdfs: {
        Row: {
          content_hash: string
          generated_at: string
          generated_by: string | null
          storage_path: string
          ticket_id: string
        }
        Insert: {
          content_hash: string
          generated_at?: string
          generated_by?: string | null
          storage_path: string
          ticket_id: string
        }
        Update: {
          content_hash?: string
          generated_at?: string
          generated_by?: string | null
          storage_path?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_ticket_pdfs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "shipping_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_tickets: {
        Row: {
          contact_name: string | null
          contact_phone: string | null
          contract_number: string | null
          created_at: string
          created_by: string | null
          deliver_to_address: string | null
          deliver_to_name: string | null
          delivered_by: string | null
          id: string
          pass_number: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          received_by: string | null
          received_date: string | null
          ship_by: string | null
          ship_date: string
          signature_url: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          ticket_number: string
          ticket_sequence: number
          updated_at: string
        }
        Insert: {
          contact_name?: string | null
          contact_phone?: string | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          deliver_to_address?: string | null
          deliver_to_name?: string | null
          delivered_by?: string | null
          id?: string
          pass_number?: string | null
          po_reference?: string | null
          project_id: string
          project_number: string
          received_by?: string | null
          received_date?: string | null
          ship_by?: string | null
          ship_date?: string
          signature_url?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          ticket_number: string
          ticket_sequence: number
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          contact_phone?: string | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          deliver_to_address?: string | null
          deliver_to_name?: string | null
          delivered_by?: string | null
          id?: string
          pass_number?: string | null
          po_reference?: string | null
          project_id?: string
          project_number?: string
          received_by?: string | null
          received_date?: string | null
          ship_by?: string | null
          ship_date?: string
          signature_url?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          ticket_number?: string
          ticket_sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_price_history: {
        Row: {
          id: string
          previous_unit_cost: number | null
          product_id: string
          recorded_at: string
          recorded_by: string | null
          source_name: string | null
          supplier_id: string | null
          supplier_price_id: string | null
          unit: string
          unit_cost: number
        }
        Insert: {
          id?: string
          previous_unit_cost?: number | null
          product_id: string
          recorded_at?: string
          recorded_by?: string | null
          source_name?: string | null
          supplier_id?: string | null
          supplier_price_id?: string | null
          unit?: string
          unit_cost: number
        }
        Update: {
          id?: string
          previous_unit_cost?: number | null
          product_id?: string
          recorded_at?: string
          recorded_by?: string | null
          source_name?: string | null
          supplier_id?: string | null
          supplier_price_id?: string | null
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_price_history_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_price_history_supplier_price_id_fkey"
            columns: ["supplier_price_id"]
            isOneToOne: false
            referencedRelation: "supplier_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_prices: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_preferred: boolean
          notes: string | null
          price_updated_at: string
          product_id: string
          source_label: string | null
          supplier_id: string | null
          supplier_sku: string | null
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_preferred?: boolean
          notes?: string | null
          price_updated_at?: string
          product_id: string
          source_label?: string | null
          supplier_id?: string | null
          supplier_sku?: string | null
          unit?: string
          unit_cost: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_preferred?: boolean
          notes?: string | null
          price_updated_at?: string
          product_id?: string
          source_label?: string | null
          supplier_id?: string | null
          supplier_sku?: string | null
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_prices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_template_parts: {
        Row: {
          id: string
          is_key_part: boolean
          line_no: number
          notes: string | null
          product_id: string
          qty_per_system: number
          template_id: string
        }
        Insert: {
          id?: string
          is_key_part?: boolean
          line_no: number
          notes?: string | null
          product_id: string
          qty_per_system: number
          template_id: string
        }
        Update: {
          id?: string
          is_key_part?: boolean
          line_no?: number
          notes?: string | null
          product_id?: string
          qty_per_system?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_template_parts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_template_parts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_template_parts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "system_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      system_templates: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["system_category"]
          created_at: string
          created_by: string | null
          description: string | null
          finished_product_id: string
          id: string
          name: string
          system_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["system_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          finished_product_id: string
          id?: string
          name: string
          system_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["system_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          finished_product_id?: string
          id?: string
          name?: string
          system_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_templates_finished_product_id_fkey"
            columns: ["finished_product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_templates_finished_product_id_fkey"
            columns: ["finished_product_id"]
            isOneToOne: true
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
        ]
      }
      user_directory: {
        Row: {
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_directory_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
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
    }
    Views: {
      v_products_with_cost: {
        Row: {
          cost_updated_at: string | null
          created_at: string | null
          default_cost: number | null
          default_cost_unit: string | null
          default_is_preferred: boolean | null
          default_source: string | null
          default_supplier_id: string | null
          description: string | null
          id: string | null
          is_serialized: boolean | null
          max_cost: number | null
          min_cost: number | null
          part_number: string | null
          price_count: number | null
          reorder_point: number | null
          unit: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_prices_supplier_id_fkey"
            columns: ["default_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_directory: {
        Row: {
          id: string | null
          mkj_number: string | null
          name: string | null
        }
        Insert: {
          id?: string | null
          mkj_number?: string | null
          name?: string | null
        }
        Update: {
          id?: string | null
          mkj_number?: string | null
          name?: string | null
        }
        Relationships: []
      }
      v_project_inventory: {
        Row: {
          available: number | null
          held: number | null
          on_hand: number | null
          product_id: string | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_cost"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_last_updated: {
        Row: {
          last_updated: string | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_serials: {
        Row: {
          product_id: string | null
          project_id: string | null
          serial: string | null
          status: string | null
        }
        Relationships: []
      }
      v_user_roles: {
        Row: {
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string | null
        }
        Insert: {
          role?: Database["public"]["Enums"]["app_role"] | null
          user_id?: string | null
        }
        Update: {
          role?: Database["public"]["Enums"]["app_role"] | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      allocate_held_stock: {
        Args: { _product_id: string; _project_id: string }
        Returns: undefined
      }
      borrow_notify_recipients: {
        Args: { _project_id: string }
        Returns: string[]
      }
      build_request_assert_rule: { Args: { _res: Json }; Returns: undefined }
      build_request_audience: {
        Args: {
          _audience: string
          _r: Database["public"]["Tables"]["build_requests"]["Row"]
        }
        Returns: string[]
      }
      build_request_consume: {
        Args: { _request_id: string; _serials: Json }
        Returns: Json
      }
      build_request_pending_text: {
        Args: { _request_id: string }
        Returns: string
      }
      build_request_take_holds: { Args: { _request_id: string }; Returns: Json }
      build_request_write_lines: {
        Args: {
          _lines: Json
          _qty: number
          _request_id: string
          _template_id: string
        }
        Returns: Json
      }
      can_modify_po: {
        Args: {
          _status: Database["public"]["Enums"]["po_status"]
          _user_id: string
        }
        Returns: boolean
      }
      can_request_build: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_request_po: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_see_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_write: { Args: { _user_id: string }; Returns: boolean }
      can_write_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      cancel_build_request: {
        Args: { _reason: string; _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_po_request: {
        Args: { _reason: string; _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          request_number: string
          request_sequence: number
          requested_by: string | null
          status: Database["public"]["Enums"]["po_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "po_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_build_request: { Args: { _request_id: string }; Returns: Json }
      complete_po_request: {
        Args: { _po_reference: string; _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          request_number: string
          request_sequence: number
          requested_by: string | null
          status: Database["public"]["Enums"]["po_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "po_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_build_request: {
        Args: {
          _lines: Json
          _notes: string
          _project_id: string
          _qty: number
          _template_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_packing_slip: {
        Args: {
          _carrier: string
          _notes: string
          _po_id: string
          _project_id: string
          _received_date: string
          _status: string
          _vendor_slip_number: string
        }
        Returns: {
          attachment_url: string | null
          carrier: string | null
          created_at: string
          id: string
          notes: string | null
          po_id: string
          project_id: string
          project_number: string
          ps_sequence: number
          received_by: string | null
          received_date: string
          slip_number: string
          status: string
          vendor_slip_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "packing_slips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_po_request: {
        Args: { _lines: Json; _notes: string; _project_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          request_number: string
          request_sequence: number
          requested_by: string | null
          status: Database["public"]["Enums"]["po_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "po_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_purchase_order: {
        Args: {
          _additional_freight?: number
          _assignee?: string
          _bill_to: string
          _delivery_date: string
          _description: string
          _new_supplier_name?: string
          _payment_terms: string
          _project_id: string
          _ship_to: string
          _ship_via: string
          _supplier_id: string
          _terms_conditions?: string
        }
        Returns: {
          additional_freight: number | null
          assignee: string | null
          bill_to: string | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          description: string | null
          id: string
          payment_terms: string | null
          po_number: string
          po_sequence: number
          pre_receipt_status: Database["public"]["Enums"]["po_status"] | null
          project_id: string
          project_number: string
          ship_to: string | null
          ship_via: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          terms_conditions: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_shipping_ticket: {
        Args: {
          _contact_name: string
          _contact_phone: string
          _deliver_to_address: string
          _deliver_to_name: string
          _project_id: string
          _ship_by: string
          _ship_date: string
        }
        Returns: {
          contact_name: string | null
          contact_phone: string | null
          contract_number: string | null
          created_at: string
          created_by: string | null
          deliver_to_address: string | null
          deliver_to_name: string | null
          delivered_by: string | null
          id: string
          pass_number: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          received_by: string | null
          received_date: string | null
          ship_by: string | null
          ship_date: string
          signature_url: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          ticket_number: string
          ticket_sequence: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shipping_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_borrow_request: {
        Args: {
          _note: string
          _qty_approved: number
          _request_id: string
          _serials?: string[]
          _status: string
        }
        Returns: undefined
      }
      delete_packing_slip: { Args: { _slip_id: string }; Returns: undefined }
      delete_purchase_order: { Args: { _po_id: string }; Returns: undefined }
      delete_shipping_ticket: {
        Args: { _ticket_id: string }
        Returns: undefined
      }
      gen_ticket_number: { Args: never; Returns: string }
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      held_stock_qty: {
        Args: { _product_id: string; _project_id: string }
        Returns: number
      }
      import_system_templates: {
        Args: { _dry_run?: boolean; _parts: Json; _systems: Json }
        Returns: Json
      }
      install_build_parts: {
        Args: { _request_id: string; _serials?: Json }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_warehouse_or_admin: { Args: { _user_id: string }; Returns: boolean }
      manages_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      mark_build_partially_built: {
        Args: { _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notify_build_request: {
        Args: { _detail?: string; _event: string; _request_id: string }
        Returns: undefined
      }
      notify_po_request: {
        Args: { _event: string; _request_id: string }
        Returns: undefined
      }
      po_request_write_lines: {
        Args: { _lines: Json; _request_id: string }
        Returns: undefined
      }
      pull_back_build_request: {
        Args: { _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_po_status: { Args: { _po_id: string }; Returns: undefined }
      reject_build_request: {
        Args: { _note: string; _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_build_holds: { Args: { _request_id: string }; Returns: undefined }
      return_borrowed_stock: {
        Args: {
          _note?: string
          _qty: number
          _request_id: string
          _serials?: string[]
        }
        Returns: undefined
      }
      reverse_shipping_ticket_inventory: {
        Args: { _ticket_id: string }
        Returns: undefined
      }
      set_system_template_active: {
        Args: { _active: boolean; _template_id: string }
        Returns: {
          active: boolean
          category: Database["public"]["Enums"]["system_category"]
          created_at: string
          created_by: string | null
          description: string | null
          finished_product_id: string
          id: string
          name: string
          system_code: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "system_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      ship_shipping_ticket_inventory: {
        Args: { _ticket_id: string }
        Returns: undefined
      }
      start_build_request: {
        Args: { _request_id: string; _serials?: Json }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_build_request: { Args: { _request_id: string }; Returns: Json }
      sync_packing_slip_inventory: {
        Args: { _slip_id: string }
        Returns: undefined
      }
      update_build_request: {
        Args: {
          _lines: Json
          _notes: string
          _qty: number
          _request_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          project_number: string
          qty: number
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          request_number: string
          request_sequence: number
          requested_by: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["build_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "build_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_po_request: {
        Args: { _lines: Json; _notes: string; _request_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          po_reference: string | null
          project_id: string
          project_number: string
          request_number: string
          request_sequence: number
          requested_by: string | null
          status: Database["public"]["Enums"]["po_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "po_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "warehouse_manager" | "manager" | "engineer"
      borrow_status:
        | "pending"
        | "approved"
        | "partially_approved"
        | "denied"
        | "fulfilled"
        | "returned"
        | "cancelled"
        | "partially_returned"
      build_status:
        | "draft"
        | "submitted"
        | "in_progress"
        | "partially_built"
        | "completed"
        | "rejected"
        | "cancelled"
      ledger_source:
        | "packing_slip"
        | "shipping_ticket"
        | "manual_adjustment"
        | "borrow_out"
        | "borrow_in"
        | "borrow_return_out"
        | "borrow_return_in"
        | "initial"
        | "manufacturing_consume"
        | "manufacturing_return"
        | "manufacturing_output"
      po_request_status: "pending" | "completed" | "cancelled"
      po_status:
        | "draft"
        | "approved"
        | "executed"
        | "partially_received"
        | "received"
      project_status: "active" | "on_hold" | "closed"
      system_category:
        | "cctv_cabinet"
        | "data_cabinet"
        | "access_control"
        | "fiber_enclosure"
        | "other"
      ticket_status: "draft" | "ready" | "shipped" | "delivered" | "closed"
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
      app_role: ["admin", "warehouse_manager", "manager", "engineer"],
      borrow_status: [
        "pending",
        "approved",
        "partially_approved",
        "denied",
        "fulfilled",
        "returned",
        "cancelled",
        "partially_returned",
      ],
      build_status: [
        "draft",
        "submitted",
        "in_progress",
        "partially_built",
        "completed",
        "rejected",
        "cancelled",
      ],
      ledger_source: [
        "packing_slip",
        "shipping_ticket",
        "manual_adjustment",
        "borrow_out",
        "borrow_in",
        "borrow_return_out",
        "borrow_return_in",
        "initial",
        "manufacturing_consume",
        "manufacturing_return",
        "manufacturing_output",
      ],
      po_request_status: ["pending", "completed", "cancelled"],
      po_status: [
        "draft",
        "approved",
        "executed",
        "partially_received",
        "received",
      ],
      project_status: ["active", "on_hold", "closed"],
      system_category: [
        "cctv_cabinet",
        "data_cabinet",
        "access_control",
        "fiber_enclosure",
        "other",
      ],
      ticket_status: ["draft", "ready", "shipped", "delivered", "closed"],
    },
  },
} as const
