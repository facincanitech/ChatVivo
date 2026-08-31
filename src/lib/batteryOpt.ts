import { registerPlugin, Capacitor } from '@capacitor/core'

interface BatteryOptPlugin {
  isIgnoringOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreOptimizations(): Promise<void>
  openAutoStartSettings(): Promise<{ opened: boolean }>
}

const BatteryOpt = registerPlugin<BatteryOptPlugin>('BatteryOpt')

const ASKED_KEY = 'flux-battery-opt-asked'

export async function promptDisableBatteryOptimization() {
  if (!Capacitor.isNativePlatform()) return
  try {
    if (localStorage.getItem(ASKED_KEY)) return
    localStorage.setItem(ASKED_KEY, '1')

    const { ignoring } = await BatteryOpt.isIgnoringOptimizations()
    if (!ignoring) {
      await BatteryOpt.requestIgnoreOptimizations()
    }
  } catch {
    // plugin indisponivel - nao critico
  }
}
