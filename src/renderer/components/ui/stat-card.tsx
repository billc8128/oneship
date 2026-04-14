interface StatCardProps {
  label: string
  value: string
  unit?: string
  unitColor?: string
}

export function StatCard({ label, value, unit, unitColor = 'text-light' }: StatCardProps) {
  return (
    <div className="flex-1 bg-surface rounded-xl p-5 shadow-card">
      <p className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">{label}</p>
      <div className="flex items-end gap-1.5 mt-2">
        <span className="font-heading text-4xl font-bold text-espresso">{value}</span>
        {unit && <span className={`font-body text-sm ${unitColor} mb-1`}>{unit}</span>}
      </div>
    </div>
  )
}
