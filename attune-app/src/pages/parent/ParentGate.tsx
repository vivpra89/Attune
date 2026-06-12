import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAttune } from "@/contexts/attune.context";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ParentGate() {
  const { setUnlocked } = useAttune();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"unlock" | "create">("unlock");

  useEffect(() => {
    invoke<boolean>("has_parent_pin")
      .then((exists) => {
        setHasPin(exists);
        setMode(exists ? "unlock" : "create");
      })
      .catch(() => setHasPin(false));
  }, []);

  const handleUnlock = async () => {
    setError("");
    const ok = await invoke<boolean>("verify_parent_pin", { pin });
    if (ok) {
      setUnlocked(true);
      navigate("/parent/today");
    } else {
      setError("Incorrect PIN");
    }
  };

  const handleCreate = async () => {
    setError("");
    if (pin.length < 4) {
      setError("PIN must be at least 4 characters");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    await invoke("set_parent_pin", { pin });
    setUnlocked(true);
    navigate("/parent/setup");
  };

  if (hasPin === null) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 max-w-sm mx-auto gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Parent Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {mode === "create"
            ? "Create a PIN to protect session reports and settings."
            : "Enter your PIN to continue."}
        </p>
      </div>

      <div className="w-full space-y-4">
        <div>
          <Label htmlFor="pin">PIN</Label>
          <Input
            id="pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="mt-1"
          />
        </div>
        {mode === "create" && (
          <div>
            <Label htmlFor="confirm">Confirm PIN</Label>
            <Input
              id="confirm"
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              className="mt-1"
            />
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button
          className="w-full"
          onClick={mode === "create" ? handleCreate : handleUnlock}
        >
          {mode === "create" ? "Create PIN & Continue" : "Unlock"}
        </Button>
      </div>
    </div>
  );
}
