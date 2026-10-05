import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { DESK_QUERY_PARAM } from '@application/remote/protocol'
import '@fontsource/archivo/latin-400.css'
import '@fontsource/archivo/latin-600.css'
import '@fontsource/archivo/latin-800.css'
import './styles.css'

// `?pupitre=CODE` turns the page into the desk of a phone: the editor is then not even downloaded
const isDesk = new URLSearchParams(window.location.search).has(DESK_QUERY_PARAM)
const load: Promise<{ default: ComponentType }> = isDesk
  ? import('./presentation/remote/RemoteDesk')
  : import('./App')

void load.then(({ default: Page }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  )
})
