export const privacy = {
  local: {
    title: "Fully local execution",
    desc: "Sessions and skills stay on this machine — never uploaded",
  },
  ownership: {
    title: "Output stays yours",
    desc: "Distilled output belongs to you; never fed back to cloud models",
  },
  account: {
    title: "No login · local self-registration",
    desc: "No account needed; identity is generated locally on your device",
  },
} as const;
