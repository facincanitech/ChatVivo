import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { supabase } from './supabase'

let currentConversationId: string | null = null

export function setCurrentConversationId(id: string | null) {
  currentConversationId = id
}

export async function registerPushNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return

  const permStatus = await PushNotifications.checkPermissions()
  let granted = permStatus.receive === 'granted'
  if (!granted) {
    const req = await PushNotifications.requestPermissions()
    granted = req.receive === 'granted'
  }
  if (!granted) return

  await LocalNotifications.requestPermissions().catch(() => {})

  await LocalNotifications.createChannel({
    id: 'flux_messages',
    name: 'Mensagens do Flux',
    description: 'Mensagens, sininho e winks',
    importance: 5,
    visibility: 1,
    sound: undefined,
    vibration: true,
    lights: true,
  }).catch(() => {})

  await PushNotifications.addListener('registration', async (token) => {
    await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token: token.value, platform: 'android' }, { onConflict: 'user_id,token' })
  })

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('Push registration error', err)
  })

  // Quando o app ainda esta "vivo" (mesmo em segundo plano), o FCM entrega
  // direto pro codigo em vez de mostrar sozinho na bandeja - tem que mostrar na mao.
  await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
    const conversationId = (notification.data as { conversationId?: string } | undefined)?.conversationId
    if (conversationId && conversationId === currentConversationId) return

    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Math.random() * 1000000),
          title: notification.title || 'Flux',
          body: notification.body || '',
          channelId: 'flux_messages',
        },
      ],
    }).catch(() => {})
  })

  await PushNotifications.register()
}
