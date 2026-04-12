import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        panel: "#131316",
        border: "#24242a",
        text: "#e8e8ec",
        muted: "#8a8a93",
        accent: "#ff5a1f",
        ok: "#22c55e",
        warn: "#eab308",
        err: "#ef4444",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
