/** Compact inline row: label left, control right, separated by faint dividers */
export function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 min-h-[36px] border-b border-[var(--color-border-divider)]">
      <div className="flex-1 min-w-0 pr-4">
        <div className="text-sm">{label}</div>
        {desc && <div className="text-xs text-muted leading-tight mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Topic card: a SectionHeader and its rows inside a bounded surface */
export function SettingsCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-divider)] px-4 pt-3 pb-1">
      <SectionHeader title={title} desc={desc} />
      {children}
    </section>
  );
}

/** Flat section label with optional description */
export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="border-b border-[var(--color-border-divider)] pb-2 mb-3">
      <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted">{title}</h2>
      {desc && <p className="text-xs text-muted mt-1 normal-case tracking-normal">{desc}</p>}
    </div>
  );
}
