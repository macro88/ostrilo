interface ProfileFieldProps {
  label: string;
  value: string;
  loading: boolean;
  loadingText?: string;
}

export function ProfileField({
  label,
  value,
  loading,
  loadingText = "Loading...",
}: ProfileFieldProps) {
  return (
    <div className="ink-card p-3">
      <h3 className="font-medium mb-1 text-sm">{label}</h3>
      {loading ? (
        <p className="text-xs text-muted-foreground animate-pulse">
          {loadingText}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{value}</p>
      )}
    </div>
  );
}
