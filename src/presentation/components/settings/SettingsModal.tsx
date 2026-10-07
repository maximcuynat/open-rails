import { useState, useEffect } from 'react'
import { Modal } from '../common/Modal'
import type { EditorStore } from '@application/state/editorStore'
import {
  SCALE_PRESETS,
  BOARD_PRESETS,
  type ScalePresetId,
  type Unit,
  formatDistance,
  toUnitValue,
  parseDistance,
} from '@domain/models/units'
import { showToast } from '../common/Toast'
import { KeybindingsSection } from './KeybindingsSection'
import type { Keybindings } from '@application/keybindings/keybindings'
import { LINE_SPEED_RANGE, type LineType } from '@domain/models/speedLimits'
import { LINE_CHOICES, applyLineChoice, lineChoiceId, parseLineSpeed } from './lineSettingsModel'
import type { SignallingLevel } from '@domain/models/signals'
import { SIGNALLING_LEVEL_CHOICES } from './signallingSettingsModel'

/** A length as typed in a field of the modal: in the display unit, without float noise */
const unitField = (meters: number, unit: Unit): string => Number(toUnitValue(meters, unit).toFixed(4)).toString()

interface SettingsModalProps {
  store: EditorStore
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ store, isOpen, onClose }: SettingsModalProps) {
  const [selectedScale, setSelectedScale] = useState<ScalePresetId>(store.scalePreset)
  const [selectedUnit, setSelectedUnit] = useState<Unit>(store.unit)
  const [gaugeVal, setGaugeVal] = useState<string>(
    toUnitValue(store.gauge, store.unit).toString()
  )
  const [spacingVal, setSpacingVal] = useState<string>(
    toUnitValue(store.trackSpacing, store.unit).toString()
  )
  const [levelHeightVal, setLevelHeightVal] = useState<string>(unitField(store.levelHeight, store.unit))
  const [maxGradientVal, setMaxGradientVal] = useState<string>(store.maxGradient.toString())
  const [flatLevels, setFlatLevels] = useState<boolean>(store.flatLevels)
  const [lineType, setLineType] = useState<LineType>(store.lineSettings.lineType)
  const [lineSpeedVal, setLineSpeedVal] = useState<string>(store.lineSettings.lineSpeed.toString())
  const [signallingLevel, setSignallingLevel] = useState<SignallingLevel>(store.signallingLevel)
  const [signalStopEnforced, setSignalStopEnforced] = useState<boolean>(store.signalStopEnforced)
  const [showDimensions, setShowDimensions] = useState<boolean>(store.showDimensions)
  const [boardEnabled, setBoardEnabled] = useState<boolean>(store.boardEnabled)
  const [boardWidthVal, setBoardWidthVal] = useState<string>(
    toUnitValue(store.boardWidth, store.unit).toString()
  )
  const [boardHeightVal, setBoardHeightVal] = useState<string>(
    toUnitValue(store.boardHeight, store.unit).toString()
  )
  const [draftKeys, setDraftKeys] = useState<Keybindings>(store.keybindings)

  // Sync state when modal opens or store changes
  useEffect(() => {
    if (isOpen) {
      setSelectedScale(store.scalePreset)
      setSelectedUnit(store.unit)
      setGaugeVal(toUnitValue(store.gauge, store.unit).toString())
      setSpacingVal(toUnitValue(store.trackSpacing, store.unit).toString())
      setLevelHeightVal(unitField(store.levelHeight, store.unit))
      setMaxGradientVal(store.maxGradient.toString())
      setFlatLevels(store.flatLevels)
      setLineType(store.lineSettings.lineType)
      setLineSpeedVal(store.lineSettings.lineSpeed.toString())
      setSignallingLevel(store.signallingLevel)
      setSignalStopEnforced(store.signalStopEnforced)
      setShowDimensions(store.showDimensions)
      setBoardEnabled(store.boardEnabled)
      setBoardWidthVal(toUnitValue(store.boardWidth, store.unit).toString())
      setBoardHeightVal(toUnitValue(store.boardHeight, store.unit).toString())
      setDraftKeys(store.keybindings)
    }
  }, [isOpen, store.scalePreset, store.unit, store.gauge, store.trackSpacing, store.levelHeight, store.maxGradient, store.flatLevels, store.lineSettings.lineType, store.lineSettings.lineSpeed, store.signallingLevel, store.signalStopEnforced, store.showDimensions, store.boardEnabled, store.boardWidth, store.boardHeight, store.keybindings])

  // When changing scale preset in the modal
  const handleScaleChange = (presetId: ScalePresetId) => {
    setSelectedScale(presetId)
    const preset = SCALE_PRESETS[presetId]
    if (preset) {
      setSelectedUnit(preset.defaultUnit)
      setGaugeVal(toUnitValue(preset.defaultGauge, preset.defaultUnit).toString())
      setSpacingVal(toUnitValue(preset.defaultTrackSpacing, preset.defaultUnit).toString())
      setLevelHeightVal(unitField(preset.defaultLevelHeight, preset.defaultUnit))
      setMaxGradientVal(preset.defaultMaxGradient.toString())
      if (preset.defaultBoardWidth && preset.defaultBoardHeight) {
        setBoardEnabled(true)
        setBoardWidthVal(toUnitValue(preset.defaultBoardWidth, preset.defaultUnit).toString())
        setBoardHeightVal(toUnitValue(preset.defaultBoardHeight, preset.defaultUnit).toString())
      } else if (presetId === '1:1') {
        setBoardEnabled(false)
      }
    }
  }

  // When changing unit directly
  const handleUnitChange = (newUnit: Unit) => {
    const currentGaugeMeters = parseDistance(gaugeVal, selectedUnit)
    const currentSpacingMeters = parseDistance(spacingVal, selectedUnit)
    const currentLevelHeightMeters = parseDistance(levelHeightVal, selectedUnit)
    const currentBWMeters = parseDistance(boardWidthVal, selectedUnit)
    const currentBHMeters = parseDistance(boardHeightVal, selectedUnit)
    setSelectedUnit(newUnit)
    setGaugeVal(toUnitValue(currentGaugeMeters, newUnit).toFixed(newUnit === 'mm' ? 1 : 2))
    setSpacingVal(toUnitValue(currentSpacingMeters, newUnit).toFixed(newUnit === 'mm' ? 1 : 2))
    setLevelHeightVal(unitField(currentLevelHeightMeters, newUnit))
    setBoardWidthVal(toUnitValue(currentBWMeters, newUnit).toFixed(newUnit === 'mm' ? 0 : 2))
    setBoardHeightVal(toUnitValue(currentBHMeters, newUnit).toFixed(newUnit === 'mm' ? 0 : 2))
  }

  const handleSave = () => {
    const parsedGauge = parseDistance(gaugeVal, selectedUnit)
    const parsedSpacing = parseDistance(spacingVal, selectedUnit)

    const parsedLevelHeight = parseDistance(levelHeightVal, selectedUnit)
    const parsedMaxGradient = parseFloat(maxGradientVal.replace(',', '.'))

    if (parsedGauge <= 0 || parsedSpacing <= 0) {
      showToast('Valeurs de voie invalides', 'error')
      return
    }
    if (!(parsedLevelHeight > 0) || !(parsedMaxGradient > 0)) {
      showToast('Hauteur de niveau ou pente maximale invalide', 'error')
      return
    }
    const parsedLineSpeed = parseLineSpeed(lineSpeedVal)
    if (parsedLineSpeed === null) {
      showToast(`Vitesse de ligne invalide : de ${LINE_SPEED_RANGE.min} à ${LINE_SPEED_RANGE.max} km/h`, 'error')
      return
    }

    if (selectedScale !== 'custom') {
      store.setScalePreset(selectedScale)
      store.setUnit(selectedUnit)
      // Custom overrides if modified
      const preset = SCALE_PRESETS[selectedScale]
      if (Math.abs(preset.defaultGauge - parsedGauge) > 0.0001) {
        store.setCustomGauge(parsedGauge)
      }
      if (Math.abs(preset.defaultTrackSpacing - parsedSpacing) > 0.0001) {
        store.setCustomTrackSpacing(parsedSpacing)
      }
    } else {
      store.setScalePreset('custom')
      store.setUnit(selectedUnit)
      store.setCustomGauge(parsedGauge)
      store.setCustomTrackSpacing(parsedSpacing)
    }

    // After the scale: choosing a preset puts back its own slope settings
    store.setGradientSettings({ levelHeight: parsedLevelHeight, maxGradient: parsedMaxGradient })
    store.setFlatLevels(flatLevels)

    if (parsedLineSpeed !== store.lineSettings.lineSpeed || lineType !== store.lineSettings.lineType) {
      store.setLineSettings({ lineSpeed: parsedLineSpeed, lineType })
    }

    // One undo step, and only when something changed. The signals themselves are left as they are
    store.setSignallingSettings({ level: signallingLevel, stopEnforced: signalStopEnforced })
    // The marker board tool only exists at the pro level
    if (store.signallingLevel !== 'pro' && store.signalToolSubMode === 'cabMarker') store.setSignalToolSubMode('select')

    if (store.showDimensions !== showDimensions) {
      store.toggleDimensions()
    }

    const parsedBW = parseDistance(boardWidthVal, selectedUnit)
    const parsedBH = parseDistance(boardHeightVal, selectedUnit)
    store.setBoardEnabled(boardEnabled)
    if (parsedBW > 0 && parsedBH > 0) {
      store.setBoardDimensions(parsedBW, parsedBH)
    }

    if (draftKeys !== store.keybindings) store.setKeybindings(draftKeys)

    showToast(`Paramètres enregistrés : Échelle ${SCALE_PRESETS[selectedScale]?.name ?? selectedScale}`, 'success')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Paramètres du réseau & Échelles ferroviaires"
      confirmLabel="Enregistrer les modifications"
      onConfirm={handleSave}
      onClose={onClose}
      dialogClassName="modal-dialog-wide"
    >
      <div className="settings-container">
        {/* Section 1 : Échelle du réseau */}
        <div className="settings-section">
          <label className="settings-label">
            Échelle de travail
            <span className="settings-hint">Sélectionnez votre standard de modélisme ou l'échelle réelle</span>
          </label>
          <div className="scale-preset-grid">
            {(Object.keys(SCALE_PRESETS) as ScalePresetId[]).map((id) => {
              const preset = SCALE_PRESETS[id]
              const isSelected = selectedScale === id
              return (
                <button
                  key={id}
                  type="button"
                  className={`scale-preset-card ${isSelected ? 'active' : ''}`}
                  onClick={() => handleScaleChange(id)}
                >
                  <div className="scale-card-header">
                    <span className="scale-card-name">{preset.name}</span>
                    <span className="scale-card-badge">{id === '1:1' ? '1:1' : `1:${preset.ratio}`}</span>
                  </div>
                  <div className="scale-card-info">
                    Écartement : {(preset.defaultGauge * 1000).toFixed(1)} mm
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Section 2 : Unité de travail & Saisie */}
        <div className="settings-section">
          <label className="settings-label">
            Unité d'affichage & des cotes
            <span className="settings-hint">Toutes les longueurs et rayons seront exprimés dans cette unité</span>
          </label>
          <div className="unit-selector-row">
            {(['mm', 'cm', 'm'] as Unit[]).map((u) => (
              <button
                key={u}
                type="button"
                className={`unit-toggle-btn ${selectedUnit === u ? 'active' : ''}`}
                onClick={() => handleUnitChange(u)}
              >
                {u === 'mm' ? 'Millimètres (mm)' : u === 'cm' ? 'Centimètres (cm)' : 'Mètres (m)'}
              </button>
            ))}
          </div>
        </div>

        {/* Section 3 : Géométrie et Écartement */}
        <div className="settings-section">
          <label className="settings-label">
            Gabarit et géométrie de voie
            <span className="settings-hint">Personnalisez l'écartement physique, l'entraxe entre voies parallèles, la hauteur d'un niveau (pont, tunnel) et la pente maximale des rampes</span>
          </label>
          <div className="settings-grid-2">
            <div className="settings-field">
              <label htmlFor="input-gauge" className="settings-sublabel">
                Écartement des rails ({selectedUnit}) :
              </label>
              <div className="settings-input-wrap">
                <input
                  id="input-gauge"
                  type="number"
                  step="any"
                  min="0.1"
                  className="settings-input"
                  value={gaugeVal}
                  onChange={(e) => setGaugeVal(e.target.value)}
                />
                <span className="settings-input-unit">{selectedUnit}</span>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="input-spacing" className="settings-sublabel">
                Entraxe double voie standard ({selectedUnit}) :
              </label>
              <div className="settings-input-wrap">
                <input
                  id="input-spacing"
                  type="number"
                  step="any"
                  min="0.1"
                  className="settings-input"
                  value={spacingVal}
                  onChange={(e) => setSpacingVal(e.target.value)}
                />
                <span className="settings-input-unit">{selectedUnit}</span>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="input-level-height" className="settings-sublabel">
                Hauteur d'un niveau ({selectedUnit}) :
              </label>
              <div className="settings-input-wrap">
                <input
                  id="input-level-height"
                  type="number"
                  step="any"
                  min="0"
                  className="settings-input"
                  value={levelHeightVal}
                  disabled={flatLevels}
                  onChange={(e) => setLevelHeightVal(e.target.value)}
                />
                <span className="settings-input-unit">{selectedUnit}</span>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="input-max-gradient" className="settings-sublabel">
                Pente maximale (‰) :
              </label>
              <div className="settings-input-wrap">
                <input
                  id="input-max-gradient"
                  type="number"
                  step="any"
                  min="1"
                  className="settings-input"
                  value={maxGradientVal}
                  disabled={flatLevels}
                  onChange={(e) => setMaxGradientVal(e.target.value)}
                />
                <span className="settings-input-unit">‰</span>
              </div>
            </div>
          </div>
          <label className="settings-checkbox-row" style={{ marginTop: '0.6rem' }}>
            <input
              type="checkbox"
              checked={flatLevels}
              onChange={(e) => setFlatLevels(e.target.checked)}
            />
            <span className="settings-checkbox-text">
              Niveaux sans relief
            </span>
          </label>
          <span className="settings-hint" style={{ display: 'block', marginTop: '0.35rem' }}>
            Les niveaux indiquent seulement quelle voie passe au-dessus de l’autre : les pentes sont ignorées
          </span>
        </div>

        {/* Line: the speed every rail without a speed zone runs at, and the rules its curves follow */}
        <div className="settings-section">
          <label className="settings-label">
            Ligne
            <span className="settings-hint">Vitesse des voies sans limite posée, et règles de dévers des courbes</span>
          </label>
          <div className="settings-grid-2">
            <div className="settings-field">
              <label htmlFor="select-line-type" className="settings-sublabel">
                Type de ligne :
              </label>
              <select
                id="select-line-type"
                className="settings-input"
                value={lineChoiceId({ lineType, lineSpeed: parseLineSpeed(lineSpeedVal) ?? NaN })}
                onChange={(e) => {
                  const next = applyLineChoice(e.target.value, { lineType, lineSpeed: parseLineSpeed(lineSpeedVal) ?? store.lineSettings.lineSpeed })
                  setLineType(next.lineType)
                  setLineSpeedVal(next.lineSpeed.toString())
                }}
              >
                {LINE_CHOICES.map((choice) => (
                  <option key={choice.id} value={choice.id}>{choice.label}</option>
                ))}
              </select>
            </div>
            <div className="settings-field">
              <label htmlFor="input-line-speed" className="settings-sublabel">
                Vitesse de ligne (km/h) :
              </label>
              <div className="settings-input-wrap">
                <input
                  id="input-line-speed"
                  type="number"
                  step="10"
                  min={LINE_SPEED_RANGE.min}
                  max={LINE_SPEED_RANGE.max}
                  className="settings-input"
                  value={lineSpeedVal}
                  onChange={(e) => setLineSpeedVal(e.target.value)}
                />
                <span className="settings-input-unit">km/h</span>
              </div>
            </div>
          </div>
        </div>

        {/* Signalling: the level the signals are read at, and what passing a closed one does */}
        <div className="settings-section">
          <label className="settings-label">
            Signalisation
            <span className="settings-hint">Les mêmes signaux se lisent dans les deux niveaux : changer de niveau ne convertit ni ne supprime rien</span>
          </label>
          <div className="settings-field">
            <label htmlFor="select-signalling-level" className="settings-sublabel">
              Niveau de signalisation :
            </label>
            <select
              id="select-signalling-level"
              className="settings-input"
              value={signallingLevel}
              onChange={(e) => setSignallingLevel(e.target.value === 'pro' ? 'pro' : 'standard')}
            >
              {SIGNALLING_LEVEL_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
            <span className="settings-hint" style={{ display: 'block', marginTop: '0.35rem' }}>
              {SIGNALLING_LEVEL_CHOICES.find((choice) => choice.id === signallingLevel)?.hint}
            </span>
          </div>
          <label className="settings-checkbox-row" style={{ marginTop: '0.6rem' }}>
            <input
              type="checkbox"
              checked={signalStopEnforced}
              onChange={(e) => setSignalStopEnforced(e.target.checked)}
            />
            <span className="settings-checkbox-text">
              Freinage d’urgence au franchissement d’un signal fermé
            </span>
          </label>
        </div>

        {/* Section 4 : Plateau / Table de modélisme (Baseboard) */}
        <div className="settings-section">
          <label className="settings-label">
            Plateau / Table de travail
            <span className="settings-hint">Délimite physiquement la surface de votre réseau (ex. 2,40 m × 1,20 m) sur le canvas</span>
          </label>
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={boardEnabled}
              onChange={(e) => setBoardEnabled(e.target.checked)}
            />
            <span className="settings-checkbox-text">
              Activer le plateau de réseau délimité (cadre et centrage automatique)
            </span>
          </label>

          {boardEnabled && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="settings-grid-2">
                <div className="settings-field">
                  <label htmlFor="input-board-w" className="settings-sublabel">
                    Largeur du plateau ({selectedUnit}) :
                  </label>
                  <div className="settings-input-wrap">
                    <input
                      id="input-board-w"
                      type="number"
                      step="any"
                      min="0.1"
                      className="settings-input"
                      value={boardWidthVal}
                      onChange={(e) => setBoardWidthVal(e.target.value)}
                    />
                    <span className="settings-input-unit">{selectedUnit}</span>
                  </div>
                </div>
                <div className="settings-field">
                  <label htmlFor="input-board-h" className="settings-sublabel">
                    Profondeur du plateau ({selectedUnit}) :
                  </label>
                  <div className="settings-input-wrap">
                    <input
                      id="input-board-h"
                      type="number"
                      step="any"
                      min="0.1"
                      className="settings-input"
                      value={boardHeightVal}
                      onChange={(e) => setBoardHeightVal(e.target.value)}
                    />
                    <span className="settings-input-unit">{selectedUnit}</span>
                  </div>
                </div>
              </div>

              {/* Quick preset board buttons */}
              <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {BOARD_PRESETS.map((bp) => (
                  <button
                    key={bp.name}
                    type="button"
                    className="preset-btn"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    onClick={() => {
                      setBoardWidthVal(toUnitValue(bp.width, selectedUnit).toFixed(selectedUnit === 'mm' ? 0 : 2))
                      setBoardHeightVal(toUnitValue(bp.height, selectedUnit).toFixed(selectedUnit === 'mm' ? 0 : 2))
                    }}
                  >
                    {bp.name} ({formatDistance(bp.width, selectedUnit)} × {formatDistance(bp.height, selectedUnit)})
                  </button>
                ))}
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="preset-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontWeight: 600,
                    padding: '0.4rem 0.8rem',
                  }}
                  onClick={() => {
                    const bw = parseDistance(boardWidthVal, selectedUnit)
                    const bh = parseDistance(boardHeightVal, selectedUnit)
                    if (bw > 0 && bh > 0) {
                      store.setBoardEnabled(true)
                      store.setBoardDimensions(bw, bh)
                      store.fitBoard()
                      showToast('Vue centrée sur le plateau de réseau', 'info')
                    }
                  }}
                >
                  🎯 Cadrer la vue sur le plateau
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section 5 : Dessin & Cotes CAO */}
        <div className="settings-section">
          <label className="settings-label">
            Aides de construction CAO
          </label>
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={showDimensions}
              onChange={(e) => setShowDimensions(e.target.checked)}
            />
            <span className="settings-checkbox-text">
              Afficher les cotes de construction dynamiques en direct (longueur, rayon, angle et entraxe)
            </span>
          </label>
        </div>

        {/* Section 6 : Raccourcis clavier */}
        <KeybindingsSection store={store} bindings={draftKeys} onChange={setDraftKeys} />

        {/* Info recap banner */}
        <div className="settings-summary-banner">
          <div className="summary-title">Configuration active :</div>
          <div className="summary-details">
            <span>Échelle : <strong>{SCALE_PRESETS[selectedScale]?.name}</strong></span>
            <span> • </span>
            <span>Écartement : <strong>{formatDistance(parseDistance(gaugeVal, selectedUnit), selectedUnit)}</strong></span>
            <span> • </span>
            <span>Entraxe : <strong>{formatDistance(parseDistance(spacingVal, selectedUnit), selectedUnit)}</strong></span>
            {boardEnabled && (
              <>
                <span> • </span>
                <span>Plateau : <strong>{formatDistance(parseDistance(boardWidthVal, selectedUnit), selectedUnit)} × {formatDistance(parseDistance(boardHeightVal, selectedUnit), selectedUnit)}</strong></span>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
