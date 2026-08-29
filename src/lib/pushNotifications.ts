import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'

export async function registerPushNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return

  const permStatus = await PushNotifications.checkPermissions()
  let granted = permStatus.receive === 'granted'
  if (!granted) {
    const req = await PushNotifications.requestPermissions()
    granted = req.receive === 'granted'
  }
  if (!granted) return

  await PushNotifications.addListener('registration', async (token) => {
    await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token: token.value, platform: 'android' }, { onConflict: 'user_id,token' })
  })

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('Push registration error', err)
  })

  await PushNotifications.register()
}
