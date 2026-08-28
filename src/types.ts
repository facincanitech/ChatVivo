export type Profile = {
  id: string
  username: string
  email: string
  status?: string | null
  last_seen_at?: string | null
  display_name?: string | null
  avatar_url?: string | null
  is_idle?: boolean
}

export type Conversation = {
  id: string
  type: 'dm' | 'group'
  name: string | null
  description?: string | null
  created_by: string
  created_at: string
}

export type Message = {
  id: string
  conversation_id: string
  author_id: string
  content: string
  created_at: string
  kind: 'text' | 'system'
}

export type TypingPayload = {
  userId: string
  text: string
}

export type PanelView = 'root' | 'contact' | 'group' | 'join' | 'friends'
