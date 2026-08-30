import { supabase } from './supabase'

export async function sendPush(userIds: string[], title: string, body: string) {
  if (userIds.length === 0) return
  try {
    await supabase.functions.invoke('send-push', { body: { userIds, title, body } })
  } catch {
    // best-effort, nao trava o envio se a notificacao falhar
  }
}
