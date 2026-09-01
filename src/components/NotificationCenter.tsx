import { useEffect, useState } from 'react'
import { IconBell } from './icons'
import { checkForUpdate } from '../lib/updateCheck'
import { APP_VERSION, APK_DOWNLOAD_URL } from '../version'

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  useEffect(() => {
    checkForUpdate(APP_VERSION).then((info) => {
      if (info.available) setUpdateVersion(info.version || null)
    })
  }, [])

  const hasBadge = !!updateVersion

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" title="Novidades do app" onClick={() => setOpen((v) => !v)}>
        <IconBell size={20} />
      </button>
      {hasBadge && <span className="rail-badge" />}
      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-panel">
            {updateVersion && (
              <a
                className="notif-item notif-update"
                href={APK_DOWNLOAD_URL}
              >
                <span className="notif-update-bang">!</span>
                <span>Nova versão disponível (v{updateVersion}) — baixar atualização</span>
              </a>
            )}
            {!updateVersion && <p className="notif-empty">nenhuma novidade do app no momento</p>}
          </div>
        </>
      )}
    </div>
  )
}
