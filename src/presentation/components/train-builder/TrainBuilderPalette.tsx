import type { EditorStore } from '@application/state/editorStore'

export function TrainBuilderPalette({ store }: { store: EditorStore }) {
  const hasTrain = store.locomotive !== null

  const handleDragStart = (e: React.DragEvent, itemType: 'tgv_loco' | 'tgv_wagon') => {
    e.dataTransfer.setData('application/open-rails-train', itemType)
    e.dataTransfer.setData('text/plain', itemType)
    e.dataTransfer.effectAllowed = 'copy'

    // Si on commence à glisser, assurer que le store est dans le mode approprié
    if (itemType === 'tgv_loco' && store.tool !== 'locomotive') {
      store.setTool('locomotive')
    }
  }

  return (
    <div
      className="train-builder-palette"
      style={{
        pointerEvents: 'auto',
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '12px',
        padding: '10px 14px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minWidth: '320px',
        maxWidth: '460px',
        color: '#f8fafc',
        animation: 'hud-pop 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header avec titre et statut */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12.5px', color: '#38bdf8' }}>
          <span>🚄</span>
          <span>Atelier Train · Glisser-Déposer</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {hasTrain && (
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                fontWeight: 600,
              }}
            >
              Train sur voie ({store.trainWagonCount} v.)
            </span>
          )}
        </div>
      </div>

      {/* Cartes Draggable : Motrice & Wagon */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {/* Carte 1 : Motrice TGV */}
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, 'tgv_loco')}
          onPointerDown={(e) => {
            if (e.button === 0) {
              store.startTrainDrag('tgv_loco', { x: e.clientX, y: e.clientY })
            }
          }}
          onClick={() => {
            if (store.locomotive) {
              store.selectTrain(true)
            } else {
              store.setTool('locomotive')
            }
          }}
          style={{
            background: store.tool === 'locomotive' ? 'rgba(37, 99, 235, 0.25)' : 'rgba(30, 41, 59, 0.7)',
            border: `1.5px ${store.tool === 'locomotive' ? 'solid #3b82f6' : 'dashed #475569'}`,
            borderRadius: '8px',
            padding: '8px',
            cursor: 'grab',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            userSelect: 'none',
          }}
          title="Glisser sur les rails pour poser la motrice TGV"
        >
          {/* Miniature stylisée Motrice TGV */}
          <svg viewBox="0 0 100 36" width="100" height="36" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
            {/* Corps profilé */}
            <path
              d="M 5,26 L 15,26 L 24,10 L 88,10 L 95,14 L 95,26 Z"
              fill="#e2e8f0"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
            {/* Bande bleue TGV */}
            <path
              d="M 17,20 L 26,12 L 95,12 L 95,17 L 22,23 Z"
              fill="#2563eb"
            />
            {/* Pare-brise */}
            <polygon points="26,11 36,11 32,18 24,18" fill="#0f172a" />
            {/* Phares */}
            <circle cx="8" cy="22" r="2" fill="#fbbf24" />
            {/* Pantographe */}
            <polyline points="75,10 70,3 80,3" fill="none" stroke="#ef4444" strokeWidth="1.5" />
            {/* Bogies & roues */}
            <rect x="25" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="28" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="38" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <rect x="72" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="75" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="85" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
          </svg>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>Motrice TGV</div>
            <div style={{ fontSize: '9.5px', color: '#94a3b8' }}>Glisser sur la voie</div>
          </div>
        </div>

        {/* Carte 2 : Voiture Voyageur (Wagon) */}
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, 'tgv_wagon')}
          onPointerDown={(e) => {
            if (e.button === 0) {
              store.startTrainDrag('tgv_wagon', { x: e.clientX, y: e.clientY })
            }
          }}
          onClick={() => {
            if (hasTrain) {
              store.addTrainWagon()
            } else {
              store.trainWagonCount = 1
              store.setTool('locomotive')
            }
          }}
          style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1.5px dashed #475569',
            borderRadius: '8px',
            padding: '8px',
            cursor: 'grab',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            userSelect: 'none',
          }}
          title={hasTrain ? 'Glisser sur le train pour ajouter un wagon' : 'Glisser sur la voie pour créer un train avec wagon'}
        >
          {/* Miniature stylisée Wagon Voyageur avec accordéon */}
          <svg viewBox="0 0 100 36" width="100" height="36" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
            {/* Soufflet accordéon gauche */}
            <rect x="2" y="12" width="6" height="14" fill="#1e293b" stroke="#475569" strokeWidth="1" />
            {/* Caisse centrale */}
            <rect x="8" y="10" width="84" height="16" rx="2" fill="#e2e8f0" stroke="#0f172a" strokeWidth="1.5" />
            {/* Bande bleue */}
            <rect x="8" y="14" width="84" height="5" fill="#2563eb" />
            {/* Baies vitrées */}
            <rect x="14" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="28" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="42" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="56" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="70" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            {/* Soufflet accordéon droit */}
            <rect x="92" y="12" width="6" height="14" fill="#1e293b" stroke="#475569" strokeWidth="1" />
            {/* Bogie Jacobs intermédiaire */}
            <rect x="42" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="45" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="55" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
          </svg>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>Voiture Voyageur</div>
            <div style={{ fontSize: '9.5px', color: '#94a3b8' }}>Glisser sur le train</div>
          </div>
        </div>
      </div>

      {/* Rangée de contrôle du train (Wagons, Inverser, Squelette, Piloter) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Compteur de wagons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Voitures :</span>
          <button
            onClick={() => store.removeTrainWagon()}
            disabled={store.trainWagonCount <= 0}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #475569',
              borderRadius: '3px',
              color: store.trainWagonCount <= 0 ? '#475569' : '#f8fafc',
              width: '22px',
              height: '22px',
              cursor: store.trainWagonCount <= 0 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 'bold',
            }}
            title="Retirer une voiture"
          >
            -
          </button>
          <span style={{ fontWeight: 700, minWidth: '18px', textAlign: 'center', fontSize: '12px', color: '#f8fafc' }}>
            {store.trainWagonCount}
          </span>
          <button
            onClick={() => store.addTrainWagon()}
            disabled={store.trainWagonCount >= 8}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #475569',
              borderRadius: '3px',
              color: store.trainWagonCount >= 8 ? '#475569' : '#f8fafc',
              width: '22px',
              height: '22px',
              cursor: store.trainWagonCount >= 8 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 'bold',
            }}
            title="Ajouter une voiture"
          >
            +
          </button>
        </div>

        {/* Boutons d'actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {hasTrain && (
            <>
              <button
                onClick={() => store.flipLocomotiveDirection()}
                style={{
                  background: 'transparent',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  color: '#c084fc',
                  fontSize: '11px',
                  padding: '3px 6px',
                  cursor: 'pointer',
                }}
                title="Changer de motrice active / Inverser le sens (Touche R)"
              >
                ⇄ Sens
              </button>

              <button
                onClick={() => store.toggleTrainDebug()}
                style={{
                  background: store.showTrainDebug ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  border: `1px solid ${store.showTrainDebug ? '#38bdf8' : '#475569'}`,
                  borderRadius: '4px',
                  color: store.showTrainDebug ? '#38bdf8' : '#94a3b8',
                  fontSize: '11px',
                  padding: '3px 6px',
                  cursor: 'pointer',
                }}
                title="Afficher les points d'attache et pivots en mode squelette (Touche D)"
              >
                ⚙ Squelette
              </button>
            </>
          )}

          {/* Bouton Prendre le contrôle */}
          {hasTrain && (
            <button
              onClick={() => store.togglePlayMode()}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: '1px solid #34d399',
                borderRadius: '5px',
                color: '#ffffff',
                fontSize: '11.5px',
                fontWeight: 700,
                padding: '4px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35)',
              }}
              title="Prendre les commandes du train (Espace)"
            >
              <span>🎮</span>
              <span>Prendre le contrôle</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
