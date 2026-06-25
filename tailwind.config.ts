import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171717",
        panel: "#f7f7f4",
        line: "#d8d6cf",
        action: "#2f6f73"
      }
    }
  },
  plugins: []
};

export default config;
