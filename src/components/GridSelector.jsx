const gridSizes = [10, 15, 20, 25, 30, 35, 40, 45, 50];

export default function GridSelector({ value, onChange }) {
  return (
    <div className="grid-select-container">
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {gridSizes.map(size => (
          <option key={size} value={size}>{size}px</option>
        ))}
      </select>
    </div>
  );
}
