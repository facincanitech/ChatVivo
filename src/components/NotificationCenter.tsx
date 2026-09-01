import { useEffect, useState } from 'react'
import { IconBell } from './icons'
import { checkForUpdate } from '../lib/updateCheck'
import { downloadAndInstallUpdate } from '../lib/appUpdate'
import { APP_VERSION, APK_DOWNLOAD_URL } from '../version'

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  function recheckUpdate() {
    checkForUpdate(APP_VERSION).then((info) => {
      setUpdateVersion(info.available ? info.version || null : null)
    })
  }

  useEffect(() => {
    recheckUpdate()
  }, [])

  useEffect(() => {
    if (open) recheckUpdate()
  }, [open])

  async function handleUpdateClick() {
    setUpdateError(null)
    setUpdating(true)
    try {
      await downloadAndInstallUpdate(APK_DOWNLOAD_URL)
    } catch (err) {
      console.error('update failed', err)
      setUpdateError('Não consegui baixar a atualização. Tenta de novo.')
    } finally {
      setUpdating(false)
    }
  }

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
              <button
                type="button"
                className="notif-item notif-update"
                disabled={updating}
                onClick={handleUpdateClick}
              >
                <span className="notif-update-bang">!</span>
                <span>{updating ? 'Baixando atualização...' : `Nova versão disponível (v${updateVersion}) — toque pra atualizar`}</span>
              </button>
            )}
            {updateError && <p className="notif-empty error">{updateError}</p>}
            {!updateVersion && <p className="notif-empty">nenhuma novidade do app no momento</p>}
          </div>
        </>
      )}
    </div>
  )
}
