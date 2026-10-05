import { Modal } from '../common/Modal'

export const REPO_URL = 'https://github.com/maximcuynat/open-rails'
export const RELEASE_NOTES_URL = `${REPO_URL}/releases/tag/v${__APP_VERSION__}`

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  return (
    <Modal isOpen={isOpen} title="À propos d'Open Rails" closeLabel="Fermer" onClose={onClose}>
      <div className="about-body">
        <p>
          <strong>Open Rails v{__APP_VERSION__}</strong> — éditeur et simulateur de voies ferrées.
        </p>
        <p>Copyright © 2026 Maxim Cuynat.</p>
        <p>
          Open Rails est un <strong>logiciel libre</strong>, distribué sous licence{' '}
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            GNU Affero General Public License v3.0
          </a>{' '}
          (AGPL-3.0). Vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer ; toute version modifiée
          distribuée ou mise à disposition sur un réseau doit être publiée sous la même licence, avec son code source.
        </p>
        <p>Ce logiciel est fourni sans aucune garantie.</p>
        <p>
          Les réseaux d'exemple tirés de gares réelles viennent d'OpenStreetMap : ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            les contributeurs d'OpenStreetMap
          </a>
          , sous licence ODbL.
        </p>
        <p>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Code source sur GitHub</a>
          {' · '}
          <a href={RELEASE_NOTES_URL} target="_blank" rel="noopener noreferrer">
            Notes de version
          </a>
        </p>
      </div>
    </Modal>
  )
}
