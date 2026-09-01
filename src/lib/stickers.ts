import { supabase } from './supabase'

export type CustomSticker = {
  id: string
  label: string
  imageData: string
}

const DB_NAME = 'ferus-custom-stickers'
const STORE = 'stickers'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getCustomStickers(): Promise<CustomSticker[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as CustomSticker[])
    req.onerror = () => reject(req.error)
  })
}

export async function saveCustomSticker(sticker: CustomSticker): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(sticker)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteCustomSticker(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function uploadStickerImage(dataUrl: string, userId: string): Promise<string> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const ext = blob.type.split('/')[1] || 'png'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('stickers').upload(path, blob, { cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('stickers').getPublicUrl(path)
  return data.publicUrl
}
