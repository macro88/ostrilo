import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("empty-state", className)}>
      <div className="seal mx-auto mb-3 flex h-11 w-11 items-center justify-center bg-secondary text-secondary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description max-w-md mx-auto">{description}</p>
      {action && (
        <Button onClick={action.onClick} variant="default">
          {action.label}
        </Button>
      )}
    </div>
  );
}
