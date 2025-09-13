import { MainApp } from "@/components/layout/MainApp";
import { KeyManagerProvider } from "@/ui/features/authentication/hooks/KeyManagerContext";

function AppPanel() {

  return (
    <KeyManagerProvider>
      <MainApp />
    </KeyManagerProvider>
  );
}

export default AppPanel;
