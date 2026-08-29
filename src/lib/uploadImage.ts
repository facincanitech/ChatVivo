import { supabase } from './supabase'

export async function uploadImage(file: File, userId: string, prefix: string): Promise<string> {
  const path = `${userId}/${prefix}-${Date.now()}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, { cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}
