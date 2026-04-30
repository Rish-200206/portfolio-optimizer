export default function MetricCard({
  label,
  value,
  sub,
  subClass = 'text-gray-400',
  valueClass = 'text-white',
  icon,
}) {
  return (
    <div className="card p-5 flex flex-col gap-1 relative overflow-hidden">
      {/* Subtle top-accent line */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500/40 to-transparent" />

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          {label}
        </p>
        {icon && <span className="text-gray-600 text-sm">{icon}</span>}
      </div>

      <p className={`text-2xl font-bold num mt-1 ${valueClass}`}>{value}</p>

      {sub && (
        <p className={`text-sm num ${subClass}`}>{sub}</p>
      )}
    </div>
  )
}
