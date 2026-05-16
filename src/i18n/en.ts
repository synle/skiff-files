// English (en) translation bundle.
//
// Adding a new locale = a new file mirroring this shape + a new entry
// in `i18n/index.ts`. Keys are namespaced by surface (sidebar, toolbar,
// settings, dialog, …) so a translator can scan one section at a time.
//
// We intentionally keep keys descriptive ("sidebar.section.favorites")
// rather than terse ("fav") so a reader of the JSX can grok what a
// `t("sidebar.section.favorites")` call resolves to without flipping
// to this file.

const en = {
  // Top-level app surface.
  app: {
    name: "Skiff Files",
    tagline: "Fast cross-platform file explorer",
  },

  // Sidebar section labels — also used by Settings → Sidebar.
  // Mirrors `SIDEBAR_SECTION_LABELS` in state/settings.tsx so a
  // future locale can override both surfaces in one place.
  sidebar: {
    section: {
      favorites: "Favorites",
      bookmarks: "Bookmarks",
      workspaces: "Workspaces",
      searches: "Searches",
      syncjobs: "Sync jobs",
      selections: "Selections",
      recent: "Recent",
      hosts: "Network",
      devices: "Devices",
    },
    nav: {
      transfers: "Transfers",
      settings: "Settings",
      connections: "Connections",
    },
  },

  // Toolbar buttons.
  toolbar: {
    back: "Back",
    forward: "Forward",
    up: "Up",
    refresh: "Refresh",
    newFolder: "New folder",
    newFile: "New file",
    showHidden: "Show hidden files",
    hideHidden: "Hide hidden files",
    twoPane: "Two-pane mode",
    splitPane: "Split pane",
  },

  // Common dialog / button labels. Reused across the app.
  common: {
    ok: "OK",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    rename: "Rename",
    close: "Close",
    apply: "Apply",
    confirm: "Confirm",
    yes: "Yes",
    no: "No",
    loading: "Loading…",
    error: "Error",
  },

  // Settings page headings + a few flagship labels. Most settings
  // controls remain unwrapped at this scaffolding stage; future PRs
  // grow this surface.
  settings: {
    title: "Settings",
    section: {
      appearance: "Appearance",
      defaultView: "Default view",
      sidebar: "Sidebar",
      transfers: "Transfers",
      connections: "Connections",
      keyboard: "Keyboard",
      advanced: "Advanced",
      savedData: "Saved data",
      language: "Language",
    },
    language: {
      en: "English",
    },
  },
} as const;

export default en;
export type Translations = typeof en;
