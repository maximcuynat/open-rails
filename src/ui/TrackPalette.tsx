import type { EditorStore } from './store'
import { CURVE_RADII, STRAIGHT_LENGTHS } from '../core/profiles'

export function TrackPalette({ store }: { store: EditorStore }) {
  const isCatalog = store.trackMode === 'catalog'
  const isPlace = store.tool === 'place'
  const isCurve = store.tool === 'curve'

  const standardRadii = CURVE_RADII.filter((r) => r !== Infinity)
  const standardAngles = [15, 22.5, 30, 45]

  return (
    <div className="track-palette">
      {/* Top row: Mode selector (Catalogue vs Voie Libre) & Tool Switcher */}
      <div className="tp-header">
        <div className="tp-modes">
          <button
            className={`tp-mode-btn ${isCatalog ? 'active' : ''}`}
            onClick={() => store.setTrackMode('catalog')}
            title="Catalogue Kato Unitrack HO (coupons normés rigides)"
          >
            <svg className="tp-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="3" y1="17" x2="21" y2="17" />
              <line x1="7" y1="4" x2="7" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
              <line x1="17" y1="4" x2="17" y2="20" />
            </svg>
            <span>Catalogue Kato</span>
          </button>
          <button
            className={`tp-mode-btn ${!isCatalog ? 'active free' : ''}`}
            onClick={() => store.setTrackMode('freeform')}
            title="Voie Libre / Flexible (courbes et longueurs libres, décalquage)"
          >
            <svg className="tp-svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17c3.5 0 5.5-10 9-10s5.5 10 9 10" />
              <circle cx="3" cy="17" r="1.5" fill="currentColor" />
              <circle cx="21" cy="17" r="1.5" fill="currentColor" />
            </svg>
            <span>Voie Libre</span>
          </button>
        </div>

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
            <span>Droite</span>
          </button>
          <button
            className={`tp-tab-btn ${isCurve ? 'active' : ''}`}
            onClick={() => store.setTool('curve')}
            title="Poser courbe (Raccourci C)"
          >
            <svg className="tp-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19C4 19 8 5 20 5" />
              <path d="M7 21C7 21 11 8 22 8" />
            </svg>
            <span>Courbe</span>
          </button>
        </div>
      </div>

      {/* Second row: Specific options depending on mode and tool */}
      <div className="tp-body">
        {isCatalog ? (
          <>
            {isPlace && (
              <div className="tp-group">
                <span className="tp-label">Longueur :</span>
                <div className="tp-chips">
                  <button
                    className={`tp-chip ${store.selectedStraightLength === 'auto' ? 'active' : ''}`}
                    onClick={() => store.setSelectedStraightLength('auto')}
                    title="Détection automatique selon la distance de la souris"
                  >
                    <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                    </svg>
                    <span>Auto</span>
                  </button>
                  {STRAIGHT_LENGTHS.map((len) => (
                    <button
                      key={len}
                      className={`tp-chip ${store.selectedStraightLength === len ? 'active' : ''}`}
                      onClick={() => store.setSelectedStraightLength(len)}
                      title={`Coupon droit Kato ${len} mm`}
                    >
                      {len} mm
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isCurve && (
              <div className="tp-curve-row">
                <div className="tp-group">
                  <span className="tp-label">Rayon :</span>
                  <div className="tp-chips">
                    {standardRadii.map((r) => (
                      <button
                        key={r}
                        className={`tp-chip ${store.selectedCurveRadius === r ? 'active' : ''}`}
                        onClick={() => store.setSelectedCurveRadius(r)}
                        title={`Rayon de courbe R${r} mm (Raccourci [ / ])`}
                      >
                        R{r}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tp-group">
                  <span className="tp-label">Angle :</span>
                  <div className="tp-chips">
                    {standardAngles.map((ang) => (
                      <button
                        key={ang}
                        className={`tp-chip ${store.selectedCurveAngle === ang ? 'active' : ''}`}
                        onClick={() => store.setSelectedCurveAngle(ang)}
                        title={`Angle de courbe ${ang}°`}
                      >
                        {ang}°
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tp-group">
                  <span className="tp-label">Côté :</span>
                  <div className="tp-chips">
                    <button
                      className={`tp-chip ${store.autoCurveSide ? 'active' : ''}`}
                      onClick={() => store.toggleAutoCurveSide()}
                      title="Détection automatique du côté selon la position de la souris"
                    >
                      <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                      </svg>
                      <span>Auto</span>
                    </button>
                    {!store.autoCurveSide && (
                      <button
                        className="tp-chip active"
                        onClick={() => store.flipCurveSide()}
                        title="Inverser le sens de la courbe (Raccourci Tab)"
                      >
                        {store.curveSide === 1 ? (
                          <>
                            <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M15 14l5-5-5-5" />
                              <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5V20" />
                            </svg>
                            <span>Droite</span>
                          </>
                        ) : (
                          <>
                            <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 14L4 9l5-5" />
                              <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v5.5" />
                            </svg>
                            <span>Gauche</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!isPlace && !isCurve && (
              <div className="tp-info">
                <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Sélectionnez Droite ou Courbe pour poser des voies. Les aiguillages et croisements sont créés automatiquement.</span>
              </div>
            )}
          </>
        ) : (
          /* Mode Voie Libre */
          <div className="tp-freeform-info">
            <span className="tp-badge">
              <svg className="tp-svg-icon-inline" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Voie Flexible</span>
            </span>
            <span className="tp-desc">
              {isCurve
                ? 'Courbe libre : point de départ, puis orientez la souris pour définir rayon et angle avec tangence fluide.'
                : isPlace
                ? 'Droite libre : cliquez et tirez pour tracer un rail à la longueur exacte de votre choix.'
                : 'Cliquez sur un nœud pour prolonger ou déplacer librement un raccordement.'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
