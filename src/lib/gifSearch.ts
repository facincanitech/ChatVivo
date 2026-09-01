import { supabase } from './supabase'

export type GifResult = {
  id: string
  url: string
  previewUrl: string
}

export async function searchGifs(query: string): Promise<GifResult[]> {
  const { data, error } = await supabase.functions.invoke('gif-search', { body: { query } })
  if (error) throw error
  return data.results as GifResult[]
}
