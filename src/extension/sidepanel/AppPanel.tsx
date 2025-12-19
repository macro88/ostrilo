import { MainApp } from "@/components/layout/MainApp";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { useTheme } from "@/ui/hooks/useTheme";

function AppPanel() {
  // Apply theme based on settings and system preference
  useTheme();

  return (
    <KeyManagerProvider>
      <MainApp />
    </KeyManagerProvider>
  );
}

export default AppPanel;
