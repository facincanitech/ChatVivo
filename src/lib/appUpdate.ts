import { registerPlugin, Capacitor } from '@capacitor/core'

interface AppUpdatePlugin {
  downloadAndInstall(options: { url: string }): Promise<void>
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate')

export async function downloadAndInstallUpdate(url: string) {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank')
    return
  }
  await AppUpdate.downloadAndInstall({ url })
}
