import { supabase } from './supabase'

export type EphemeralKind = 'timed' | 'view_once'

export type EphemeralMediaView = {
  id: string
  ephemeral_media_id: string
  user_id: string
  opened_at: string | null
  expired: boolean
}

export type EphemeralMediaRow = {
  id: string
  message_id: string
  storage_path: string
  media_type: string
  file_name: string | null
  kind: EphemeralKind
  storage_deleted: boolean
  ephemeral_media_views?: EphemeralMediaView[]
}

export type EphemeralOpenResult =
  | { url: string; kind: EphemeralKind; mediaType: string; fileName: string | null }
  | { expired: true }

function guessMediaType(file: File): string {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

export async function uploadEphemeralMedia(file: File, conversationId: string, messageId: string) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${conversationId}/${messageId}.${ext}`
  const { error } = await supabase.storage.from('ephemeral').upload(path, file, { upsert: true })
  if (error) throw error
  return { storagePath: path, mediaType: guessMediaType(file), fileName: file.name }
}

export async function openEphemeralMedia(id: string): Promise<EphemeralOpenResult> {
  const { data, error } = await supabase.functions.invoke('ephemeral-media', {
    body: { action: 'open', ephemeralMediaId: id },
  })
  if (error) throw error
  return data
}

export async function checkExpireEphemeralMedia(id: string): Promise<{ expired: boolean }> {
  const { data, error } = await supabase.functions.invoke('ephemeral-media', {
    body: { action: 'expire', ephemeralMediaId: id },
  })
  if (error) throw error
  return data
}
