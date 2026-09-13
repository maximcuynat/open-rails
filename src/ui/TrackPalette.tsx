import type { EditorStore } from './store'

export function TrackPalette({ store }: { store: EditorStore }) {
  const isPlace = store.tool === 'place'
  const isCurve = store.tool === 'curve'

  return (
    <div className="track-palette">
      {/* Tool tabs: Droite / Courbe */}
      <div className="tp-header">
        <div className="tp-tool-tabs">
          <button
            className={`tp-tab-btn ${isPlace ? 'active' : ''}`}
            onClick={() => store.setTool('place')}
            title="Poser voie droite (Raccourci N)"
          >
            <svg className="tp-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" y1="9" x2="22" y2="9" />
              <line x1="2" y1="15" x2="22" y2="15" />
              <line x1="7" y1="6" x2="7" y2="18" />
              <line x1="12" y1="6" x2="12" y2="18" />
              <line x1="17" y1="6" x2="17" y2="18" />
            </svg>
            <span>Ligne droite</span>
          </button>
          <button
            className={`tp-tab-btn ${isCurve ? 'active' : ''}`}
            onClick={() => store.setTool('curve')}
            title="Poser courbe libre (Raccourci C)"
          >
            <svg className="tp-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19C4 19 8 5 20 5" />
              <path d="M7 21C7 21 11 8 22 8" />
            </svg>
            <span>Courbe</span>
          </button>
        </div>

        {/* Optional curve side flip if not auto */}
        {isCurve && (
          <div className="tp-group">
            <span className="tp-label">Côté :</span>
            <div className="tp-chips">
              <button
                className={`tp-chip ${store.autoCurveSide ? 'active' : ''}`}
                onClick={() => store.toggleAutoCurveSide()}
                title="Détection automatique selon la position de la souris"
              >
                Auto
              </button>
              {!store.autoCurveSide && (
                <button
                  className="tp-chip active"
                  onClick={() => store.flipCurveSide()}
                  title="Inverser le sens de courbure (Tab)"
                >
                  {store.curveSide === 1 ? 'Droite' : 'Gauche'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Info contextuelle simplifiée */}
      <div className="tp-body">
        <div className="tp-freeform-info">
          <span className="tp-badge">
            <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Voie libre</span>
          </span>
          <span className="tp-desc">
            {isCurve
              ? 'Courbe libre : départ tangent, orientez pour définir rayon et angle en continu.'
              : isPlace
              ? 'Ligne droite libre : cliquez et tirez pour tracer à la longueur exacte.'
              : 'Sélectionnez Droite ou Courbe pour tracer votre voie ferrée.'}
          </span>
        </div>
      </div>
    </div>
  )
}
