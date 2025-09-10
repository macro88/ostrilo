import mascotLogo from "/assets/ostrilo_mascot_front.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWxtStorage } from "@/hooks/useWxtStorage";
import { useSidePanelDock } from "@/hooks/useSidePanelDock";
import { LockScreen } from "@/components/layout/LockScreen";
import "./App.css";
import { SidePanelToggle } from "@/components/common/sidepanel-toggle";

function App() {
  return <LockScreen />;
}

export default App;
