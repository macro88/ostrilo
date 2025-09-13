import { MainApp } from "@/components/layout/MainApp";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";

function AppPanel() {

  return (
    <KeyManagerProvider>
      <MainApp />
    </KeyManagerProvider>
  );
}

export default AppPanel;
