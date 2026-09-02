export type Profile = {
  id: string
  username: string
  email: string
  status?: string | null
  last_seen_at?: string | null
  display_name?: string | null
  avatar_url?: string | null
  is_idle?: boolean
  age?: number | null
  city?: string | null
  banner_color?: string | null
  banner_image_url?: string | null
  banner_image_position?: string | null
  app_bg_color?: string | null
  app_sidebar_color?: string | null
  app_button_color?: string | null
  app_card_color?: string | null
  app_incoming_color?: string | null
  app_outgoing_color?: string | null
  app_text_size?: 'small' | 'normal' | 'large' | null
  name_style_font?: string | null
  name_style_effect?: 'solid' | 'gradient' | 'neon' | 'prism' | null
  name_style_color?: string | null
}

export type Conversation = {
  id: string
  type: 'dm' | 'group'
  name: string | null
  description?: string | null
  image_url?: string | null
  invite_permission?: 'all' | 'owner'
  created_by: string
  created_at: string
}

export type Message = {
  id: string
  conversation_id: string
  author_id: string
  content: string
  created_at: string
  kind: 'text' | 'system' | 'ephemeral' | 'contact' | 'sticker' | 'gif'
  reply_to_id: string | null
}

export type TypingPayload = {
  userId: string
  text: string
}

export type PanelView = 'root' | 'contact' | 'group' | 'friends'

export type Community = {
  id: string
  name: string
  description: string | null
  category: string | null
  image_url: string | null
  language: string | null
  is_private: boolean
  created_by: string
  created_at: string
}
