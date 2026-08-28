export type Profile = {
  id: string
  username: string
  email: string
}

export type Conversation = {
  id: string
  type: 'dm' | 'group'
  name: string | null
  created_by: string
  created_at: string
}

export type Message = {
  id: string
  conversation_id: string
  author_id: string
  content: string
  created_at: string
}

export type TypingPayload = {
  userId: string
  text: string
}

export type PanelView = 'root' | 'contact' | 'group' | 'join' | 'friends'
