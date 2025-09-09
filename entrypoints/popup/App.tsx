import mascotLogo from "/assets/ostrilo_mascot_front.svg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWxtStorage } from "@/hooks/useWxtStorage";
import { useSidePanelDock } from "@/hooks/useSidePanelDock";
import "./App.css";
import { SidePanelToggle } from "@/components/common/sidepanel-toggle";

function App() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-6 text-center bg-background">
      <img src={mascotLogo} alt="Ostrilo Mascot" className="w-24 h-24" />

      <div className="space-y-2">
        <h1 className="text-2xl font-display">Welcome back</h1>
        <p className="text-muted-foreground">Your local signing buddy.</p>
      </div>

      <form className="w-full space-y-4">
        <div className="grid w-full items-center gap-1.5 text-left">
          <Label htmlFor="password">Password</Label>
          <Input
            type="password"
            id="password"
            placeholder="Enter your password"
            className="text-center"
          />
        </div>
        <Button type="submit" className="w-full btn-plush h-11">
          Unlock
        </Button>
      </form>

      <SidePanelToggle />

      <Button variant="link" className="text-sm text-primary">
        Forgot password?
      </Button>
    </div>
  );
}

export default App;
