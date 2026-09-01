import { registerPlugin, Capacitor } from '@capacitor/core'

interface AudioRoutePlugin {
  setSpeakerphoneOn(options: { on: boolean }): Promise<void>
}

const AudioRoute = registerPlugin<AudioRoutePlugin>('AudioRoute')

export async function setSpeakerphoneOn(on: boolean) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await AudioRoute.setSpeakerphoneOn({ on })
  } catch {
    // plugin indisponivel - nao critico
  }
}
