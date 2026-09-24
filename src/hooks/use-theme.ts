import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "futamove-theme";

export function applyStoredTheme() {
  if (typeof window === "undefined") return;
  const t = localStorage.getItem(KEY);
  document.documentElement.classList.toggle("dark", t === "dark");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => { setTheme(localStorage.getItem(KEY) === "dark" ? "dark" : "light"); }, []);
  const update = (t: Theme) => {
    localStorage.setItem(KEY, t);
    document.documentElement.classList.toggle("dark", t === "dark");
    setTheme(t);
  };
  return { theme, setTheme: update };
}
