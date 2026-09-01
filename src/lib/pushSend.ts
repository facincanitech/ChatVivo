import { supabase } from './supabase'

export async function sendPush(
  userIds: string[],
  title: string,
  body: string,
  conversationId?: string,
  type?: 'call',
) {
  if (userIds.length === 0) return
  try {
    const { data, error } = await supabase.functions.invoke('send-push', { body: { userIds, title, body, conversationId, type } })
    if (error) console.error('sendPush error', error)
    else console.log('sendPush ok', data)
  } catch (e) {
    console.error('sendPush threw', e)
  }
}
