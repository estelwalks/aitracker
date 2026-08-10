export const sources = {
  metaDescription:
    "View the installation probe status and log collection status of each AI tool on this machine.",
  pageHeader: "Data Sources",
  pageHeaderDesc: "Probe status of {count} AI tools · Updated {time}",
  status: {
    hasData: "Has data",
    noLogs: "No logs",
    notInstalled: "Not installed",
  },
  parsing: {
    native: "Native support",
    adapter: "Adapter support",
    unsupported: "Not yet supported",
  },
  summary: {
    connected: "Connected / Probed",
    events: "Total Events Collected",
    notInstalled: "Tools Not Installed",
    noLogs: "Tools Without Logs",
    malformed: "Malformed Lines",
  },
  panelTitle: "Tool Probe Status",
  searchPlaceholder: "Search tool name",
  scanning: "Scanning",
  rescan: "Rescan",
  empty: {
    title: "No matching tools",
    desc: "Adjust the filters or search keywords and try again.",
  },
  row: {
    events: "Collected events {count}",
    parsing: "Log parsing: {label}",
    malformed: "Malformed {count}",
    download: "Download & Install ↗",
    paths: "Probe paths: {paths}",
  },
  toast: {
    rescanDone: "Rescan complete",
  },
} as const;
