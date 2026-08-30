import { registerPlugin, Capacitor } from '@capacitor/core'

interface BatteryOptPlugin {
  isIgnoringOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreOptimizations(): Promise<void>
}

const BatteryOpt = registerPlugin<BatteryOptPlugin>('BatteryOpt')

const ASKED_KEY = 'flux-battery-opt-asked'

export async function promptDisableBatteryOptimization() {
  if (!Capacitor.isNativePlatform()) return
  try {
    if (localStorage.getItem(ASKED_KEY)) return
    const { ignoring } = await BatteryOpt.isIgnoringOptimizations()
    if (!ignoring) {
      await BatteryOpt.requestIgnoreOptimizations()
    }
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    // plugin indisponivel - nao critico
  }
}
