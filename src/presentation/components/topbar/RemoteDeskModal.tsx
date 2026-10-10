import { useMemo, useSyncExternalStore } from 'react'
import type { EditorStore } from '@application/state/editorStore'
import type { RemoteHostSnapshot } from '@application/remote/remoteHost'
import type { RemoteSession } from '@application/remote/remoteSession'
import { pairingAddress } from '@application/remote/pairingAddress'
import { isDirectLink } from '@infrastructure/remote/remoteLinks'
import { MAX_DESKS } from '@application/remote/protocol'
import { encodeQr } from '@domain/qr/encodeQr'
import { qrSvgPath } from '@domain/qr/qrSvgPath'
import { showToast } from '../common/Toast'
import { Modal } from '../common/Modal'

/** Nothing keeps a page from opening a room any more: served over HTTPS, it reaches the desks directly */
export function remoteDeskUnavailable(): boolean {
  return false
}

type StatusTone = 'waiting' | 'connected' | 'error'

function sessionStatus(snapshot: RemoteHostSnapshot, direct: boolean): { tone: StatusTone; text: string; detail?: string } {
  if (snapshot.error === 'version') {
    return { tone: 'error', text: 'Le relais et cette page n’ont pas la même version', detail: 'Rechargez la page, puis rouvrez le pupitre.' }
  }
  if (snapshot.error) return { tone: 'error', text: 'Le relais a refusé d’ouvrir le salon', detail: 'Coupez, puis rouvrez le pupitre.' }
  if (snapshot.deskConnected) {
    const count = snapshot.desks.length
    return { tone: 'connected', text: `${count} / ${MAX_DESKS} ${count > 1 ? 'pupitres reliés' : 'pupitre relié'}`, detail: count < MAX_DESKS ? 'D’autres téléphones peuvent rejoindre avec le même code.' : undefined }
  }
  if (snapshot.ready) return { tone: 'waiting', text: 'En attente d’un téléphone' }
  if (snapshot.link === 'open') {
    return direct
      ? { tone: 'waiting', text: 'Ouverture du salon…', detail: 'Le service de mise en relation est contacté ; s’il ne répond pas, vérifiez la connexion Internet du PC.' }
      : { tone: 'waiting', text: 'Ouverture du salon…' }
  }
  return {
    tone: 'error',
    text: 'Relais injoignable, nouvel essai en cours…',
    detail: 'Le relais fait partie du serveur de l’application : il faut qu’elle soit servie par « npm run dev » ou « npm run preview ».',
  }
}

/** The QR code of a text, always black on white whatever the theme, with its quiet zone */
function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(text))
    } catch {
      // Longer than the largest symbol we draw
      return null
    }
  }, [text])
  if (!path) return <div className="remote-qr is-empty">Adresse trop longue pour un QR code : saisissez-la sur le téléphone.</div>
  return (
    <svg className="remote-qr" viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code de l’adresse du pupitre">
      <rect width={path.size} height={path.size} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  )
}

async function copyAddress(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    showToast('Adresse copiée', 'success')
  } catch {
    // No clipboard on a page that is not a secure context: the field is selectable
    showToast('Copie impossible : sélectionnez l’adresse à la main', 'warning')
  }
}

interface RemoteDeskModalProps {
  store: EditorStore
  remote: RemoteSession
  isOpen: boolean
  onClose: () => void
}

/**
 * Pairing window of the phone desk: where the phone has to go (QR code, address, room code) and
 * whether it got there. Closing the window keeps the session; « Couper » ends it.
 */
export function RemoteDeskModal({ store, remote, isOpen, onClose }: RemoteDeskModalProps) {
  const snapshot = useSyncExternalStore(remote.subscribe, remote.getSnapshot)
  if (!isOpen) return null

  if (!snapshot) {
    return (
      <Modal isOpen title="Pupitre sur téléphone" closeLabel="Fermer" onClose={onClose}>
        <div className="remote-pairing">
          <p>La liaison avec les téléphones est coupée. Rouvrez « Pupitre sur téléphone… » pour tirer un nouveau code.</p>
        </div>
      </Modal>
    )
  }

  const address = pairingAddress({
    pageUrl: window.location.href,
    baseUrl: import.meta.env.BASE_URL,
    room: snapshot.room,
    relayHosts: snapshot.hosts,
    typedHost: store.remoteDeskHost,
  })
  const direct = isDirectLink()
  const status = sessionStatus(snapshot, direct)

  return (
    <Modal
      isOpen
      title="Pupitre sur téléphone"
      closeLabel="Fermer"
      confirmLabel="Couper"
      confirmVariant="danger"
      onConfirm={remote.close}
      onClose={onClose}
      dialogClassName="remote-dialog"
    >
      <div className="remote-pairing">
        <div className={`remote-status is-${status.tone}`} role="status">
          <span className="remote-status-dot" />
          <b>{status.text}</b>
          {status.detail && <span className="remote-status-detail">{status.detail}</span>}
        </div>

        {snapshot.desks.length > 0 && (
          <ul className="remote-desks" aria-label="Pupitres reliés">
            {snapshot.desks.map((seat) => {
              const train = store.deskTrain(seat.desk)
              const rank = train ? store.trains.indexOf(train) + 1 : 0
              return (
                <li key={seat.desk}>
                  <b>{store.driverName(seat.desk)}</b>
                  <span>{train ? `Train ${rank}` : 'Aucun train'}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="remote-main">
          <QrCode text={address.url} />
          <div className="remote-side">
            <p className="remote-step">
              {direct
                ? 'Scannez le code ou ouvrez l’adresse sur le téléphone. Le PC et le téléphone doivent avoir accès à Internet ; la conduite passe ensuite en direct entre eux.'
                : 'Sur le même réseau wifi, scannez le code ou ouvrez l’adresse sur le téléphone.'}
            </p>
            <div className="remote-label">Code du salon</div>
            <div className="remote-code" aria-label={`Code du salon : ${snapshot.room.split('').join(' ')}`}>{snapshot.room}</div>
            <div className="remote-label">Adresse</div>
            <div className="remote-url-row">
              <input
                className="remote-url"
                readOnly
                value={address.url}
                aria-label="Adresse du pupitre"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="modal-btn modal-btn-secondary" onClick={() => void copyAddress(address.url)}>
                Copier
              </button>
            </div>
          </div>
        </div>

        {direct ? (
          <p className="remote-hint">
            Cet onglet doit rester ouvert et visible sur le PC : c’est lui qui relie les pupitres. Sans réseau commun, une connexion peut
            échouer (téléphone en 4G, wifi d’entreprise) : essayez alors sur le même wifi que le PC.
          </p>
        ) : (
          <>
        <div className="remote-host">
          <label className="remote-label" htmlFor="remote-host-input">Adresse IP du PC sur le réseau local</label>
          <input
            id="remote-host-input"
            className="remote-host-input"
            value={store.remoteDeskHost}
            placeholder={address.choices[0] ?? '192.168.1.42'}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => store.setRemoteDeskHost(e.target.value)}
          />
          {address.choices.length > 0 && (
            <div className="remote-choices">
              <span>Adresses connues du serveur :</span>
              {address.choices.map((host) => (
                <button
                  key={host}
                  type="button"
                  className={`remote-choice${host === address.host ? ' is-active' : ''}`}
                  title="Utiliser cette adresse"
                  onClick={() => store.setRemoteDeskHost(host)}
                >
                  {host}
                </button>
              ))}
            </div>
          )}
          {address.typedInvalid && <p className="remote-hint is-warning">Ce n’est pas une adresse : elle est ignorée.</p>}
          {address.localOnly && (
            <p className="remote-hint is-warning">
              Aucune adresse du réseau local n’est connue : l’adresse ci-dessus ne fonctionne que sur ce PC. Saisissez l’adresse IP du PC.
            </p>
          )}
          <p className="remote-hint">
            Le téléphone doit être sur le même réseau que le PC, et le PC doit laisser entrer le port{' '}
            {window.location.port || '80'}.
          </p>
        </div>

        <details className="remote-help">
          <summary>Le téléphone n’atteint pas le PC (Windows avec WSL2)</summary>
          <p>
            Sous WSL2, les adresses connues du serveur sont internes à Windows : un téléphone ne les atteint pas. Saisissez
            ci-dessus l’adresse de Windows sur le wifi (commande <code>ipconfig</code>, ligne « Adresse IPv4 »), puis au choix :
          </p>
          <ul>
            <li>
              <b>Mode réseau « mirrored »</b> — dans <code>%UserProfile%\.wslconfig</code>, section <code>[wsl2]</code>,
              ajoutez <code>networkingMode=mirrored</code>, puis relancez WSL (<code>wsl --shutdown</code>).
            </li>
            <li>
              <b>Redirection de port</b> — dans un PowerShell administrateur :{' '}
              <code>netsh interface portproxy add v4tov4 listenport={window.location.port || '80'} listenaddress=0.0.0.0 connectport={window.location.port || '80'} connectaddress=&lt;adresse WSL&gt;</code>,
              où l’adresse WSL est l’une des adresses connues du serveur.
            </li>
          </ul>
          <p>
            Dans les deux cas, le pare-feu de Windows doit laisser entrer le port {window.location.port || '80'}. En mode
            « mirrored », c’est le pare-feu Hyper-V qui bloque par défaut ; dans un PowerShell administrateur :{' '}
            <code>
              New-NetFirewallHyperVRule -Name OpenRails{window.location.port || '80'} -DisplayName "Open Rails{' '}
              {window.location.port || '80'}" -Direction Inbound -VMCreatorId
              '&#123;40E0AC32-46A5-438A-A0B2-2B479E8F2E90&#125;' -Protocol TCP -LocalPorts {window.location.port || '80'}
            </code>
          </p>
        </details>
          </>
        )}
      </div>
    </Modal>
  )
}
