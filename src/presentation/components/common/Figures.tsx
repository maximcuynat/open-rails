import type { Figure } from '@application/import/osmReport'

/** A row of figures with their labels, as the import and dataset windows show them */
export function Figures({ figures, wide }: { figures: Figure[]; wide?: boolean }) {
  return (
    <dl className={`osm-figures${wide ? ' is-wide' : ''}`}>
      {figures.map((figure) => (
        <div className="osm-figure" key={figure.label}>
          <dd>{figure.value}</dd>
          <dt>{figure.label}</dt>
        </div>
      ))}
    </dl>
  )
}
