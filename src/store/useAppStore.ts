import { create } from "zustand";
import i18n from "../i18n";
import { api } from "../services/tauri";
import type {
  AppConfig,
  ConflictPromptEvent,
  CredentialSummary,
  Folder,
  OpenTab,
  SecurityStatus,
  Session,
  SessionLogEvent,
  TransferItem,
  TransientAuth,
} from "../types";

const DEFAULT_CONFIG: AppConfig = {
  theme: "system",
  language: "en",
  max_concurrent_transfers: 3,
  upload_limit_kbps: 0,
  download_limit_kbps: 0,
  ui_show_sidebar: true,
  ui_show_local_panel: true,
  ui_show_queue_panel: true,
  ui_show_command_panel: true,
  terminal_font_family: "Cascadia Code, Consolas, ui-monospace, monospace",
  terminal_font_size: 13,
  terminal_copy_on_select: true,
};

export type SplitDirection = "none" | "horizontal" | "vertical";

interface AppStoreState {
  loading: boolean;
  security: SecurityStatus;
  config: AppConfig;
  folders: Folder[];
  sessions: Session[];
  credentials: CredentialSummary[];
  tabs: OpenTab[];
  activeTabId: string | null;
  secondaryTabId: string | null;
  splitDirection: SplitDirection;
  focusedPane: 1 | 2;
  sessionLogs: Record<string, SessionLogEvent[]>;
  transfers: TransferItem[];
  conflictQueue: ConflictPromptEvent[];

  initialize: () => Promise<void>;
  refreshVaultData: () => Promise<void>;
  setSecurity: (status: SecurityStatus) => void;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;

  openSessionTab: (session: Session, transientAuth?: TransientAuth) => void;
  closeTab: (tabId: string) => void;
  duplicateTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (sourceTabId: string, targetTabId: string, position: "before" | "after") => void;
  setSplitDirection: (dir: SplitDirection) => void;
  setSecondaryTab: (tabId: string | null) => void;
  setFocusedPane: (pane: 1 | 2) => void;
  openTabInSplit: (tabId: string) => void;
  appendSessionLog: (event: SessionLogEvent) => void;
  clearSessionLogs: (tabId: string) => void;
  setTransfers: (items: TransferItem[]) => void;
  pushConflict: (conflict: ConflictPromptEvent) => void;
  removeConflict: (transferId: string) => void;
}

const MAX_LOGS_PER_TAB = 500;

export const useAppStore = create<AppStoreState>((set, get) => ({
  loading: true,
  security: { initialized: false, mode: null, unlocked: false },
  config: DEFAULT_CONFIG,
  folders: [],
  sessions: [],
  credentials: [],
  tabs: [],
  activeTabId: null,
  secondaryTabId: null,
  splitDirection: "none",
  focusedPane: 1,
  sessionLogs: {},
  transfers: [],
  conflictQueue: [],

  initialize: async () => {
    set({ loading: true });
    try {
      const [security, config] = await Promise.all([
        api.getSecurityStatus(),
        api.getAppConfig(),
      ]);
      i18n.changeLanguage(config.language);
      set({ security, config });
      if (security.initialized && security.unlocked) {
        await get().refreshVaultData();
      }
    } finally {
      set({ loading: false });
    }
  },

  refreshVaultData: async () => {
    const [folders, sessions, credentials] = await Promise.all([
      api.listFolders(),
      api.listSessions(),
      api.listCredentials(),
    ]);
    set({ folders, sessions, credentials });
  },

  setSecurity: (security) => {
    set({ security });
    if (!security.unlocked) {
      set({
        folders: [],
        sessions: [],
        credentials: [],
        tabs: [],
        activeTabId: null,
        secondaryTabId: null,
        splitDirection: "none",
        focusedPane: 1,
      });
    }
  },

  updateConfig: async (patch) => {
    const next: AppConfig = { ...get().config, ...patch };
    set({ config: next });
    if (patch.language) {
      i18n.changeLanguage(patch.language);
    }
    await api.updateAppConfig(next);
  },

  openSessionTab: (session, transientAuth) => {
    const tabId = crypto.randomUUID();
    const isSaved =
      !session.id.startsWith("quick-") && !session.id.startsWith("ssh-from-");
    const nowIso = new Date().toISOString();

    set((state) => {
      const assignToSecondary =
        state.splitDirection !== "none" &&
        (state.focusedPane === 2 || state.secondaryTabId === null);
      return {
        tabs: [...state.tabs, { tabId, session, transientAuth }],
        activeTabId: assignToSecondary ? state.activeTabId ?? tabId : tabId,
        secondaryTabId: assignToSecondary ? tabId : state.secondaryTabId,
        sessions: isSaved
          ? state.sessions.map((s) =>
              s.id === session.id ? { ...s, last_opened_at: nowIso } : s
            )
          : state.sessions,
      };
    });

    if (isSaved) {
      api.markSessionOpened(session.id).catch(() => {});
    }
  },

  closeTab: (tabId) => {
    api.disconnectSession(tabId).catch(() => {});
    api.sshDisconnect(tabId).catch(() => {});
    api.sshStopLog(tabId).catch(() => {});
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.tabId === tabId);
      const nextTabs = state.tabs.filter((t) => t.tabId !== tabId);
      let nextActive = state.activeTabId;
      let nextSecondary = state.secondaryTabId;
      let nextSplit = state.splitDirection;
      let nextFocused = state.focusedPane;

      if (nextSecondary === tabId) {
        const candidate = nextTabs.find((t) => t.tabId !== nextActive)?.tabId ?? null;
        nextSecondary = candidate;
        if (!candidate) {
          nextSplit = "none";
          nextFocused = 1;
        }
      }

      if (nextActive === tabId) {
        if (nextTabs.length === 0) {
          nextActive = null;
          nextSecondary = null;
          nextSplit = "none";
          nextFocused = 1;
        } else {
          const otherThanSecondary = nextTabs.filter((t) => t.tabId !== nextSecondary);
          if (otherThanSecondary.length > 0) {
            nextActive =
              otherThanSecondary[Math.min(idx, otherThanSecondary.length - 1)].tabId;
          } else {
            // Only the secondary tab remains: promote it to primary and exit split
            nextActive = nextTabs[0].tabId;
            nextSecondary = null;
            nextSplit = "none";
            nextFocused = 1;
          }
        }
      }

      const nextLogs = { ...state.sessionLogs };
      delete nextLogs[tabId];
      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        secondaryTabId: nextSecondary,
        splitDirection: nextSplit,
        focusedPane: nextFocused,
        sessionLogs: nextLogs,
      };
    });
  },

  duplicateTab: (tabId) => {
    const target = get().tabs.find((t) => t.tabId === tabId);
    if (!target) return;
    get().openSessionTab(target.session, target.transientAuth);
  },

  setActiveTab: (tabId) =>
    set((state) => {
      if (state.splitDirection === "none") {
        return { activeTabId: tabId, focusedPane: 1 };
      }
      if (tabId === state.activeTabId) {
        return { focusedPane: 1 };
      }
      if (tabId === state.secondaryTabId) {
        return { focusedPane: 2 };
      }
      if (state.focusedPane === 2) {
        return { secondaryTabId: tabId };
      }
      return { activeTabId: tabId };
    }),

  reorderTabs: (sourceTabId, targetTabId, position) =>
    set((state) => {
      if (sourceTabId === targetTabId) return state;
      const sourceTab = state.tabs.find((t) => t.tabId === sourceTabId);
      if (!sourceTab) return state;
      const filtered = state.tabs.filter((t) => t.tabId !== sourceTabId);
      const targetIdx = filtered.findIndex((t) => t.tabId === targetTabId);
      if (targetIdx === -1) return state;
      const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
      filtered.splice(insertIdx, 0, sourceTab);
      return { tabs: filtered };
    }),

  setSplitDirection: (dir) =>
    set((state) => {
      if (dir === "none") {
        return { splitDirection: "none", secondaryTabId: null, focusedPane: 1 };
      }
      let nextSecondary = state.secondaryTabId;
      if (!nextSecondary || nextSecondary === state.activeTabId) {
        nextSecondary =
          state.tabs.find((t) => t.tabId !== state.activeTabId)?.tabId ?? null;
      }
      return {
        splitDirection: dir,
        secondaryTabId: nextSecondary,
        focusedPane: nextSecondary ? state.focusedPane : 2,
      };
    }),

  setSecondaryTab: (tabId) => set({ secondaryTabId: tabId }),

  setFocusedPane: (pane) => set({ focusedPane: pane }),

  openTabInSplit: (tabId) =>
    set((state) => {
      if (tabId === state.activeTabId) {
        const other = state.tabs.find((t) => t.tabId !== tabId)?.tabId ?? null;
        return {
          splitDirection: state.splitDirection === "none" ? "horizontal" : state.splitDirection,
          secondaryTabId: other,
          focusedPane: 2,
        };
      }
      return {
        splitDirection: state.splitDirection === "none" ? "horizontal" : state.splitDirection,
        secondaryTabId: tabId,
        focusedPane: 2,
      };
    }),

  appendSessionLog: (event) => {
    set((state) => {
      const prev = state.sessionLogs[event.tab_id] ?? [];
      const next =
        prev.length >= MAX_LOGS_PER_TAB
          ? [...prev.slice(prev.length - MAX_LOGS_PER_TAB + 1), event]
          : [...prev, event];
      return {
        sessionLogs: {
          ...state.sessionLogs,
          [event.tab_id]: next,
        },
      };
    });
  },

  clearSessionLogs: (tabId) => {
    set((state) => ({
      sessionLogs: {
        ...state.sessionLogs,
        [tabId]: [],
      },
    }));
  },

  setTransfers: (items) => set({ transfers: items }),

  pushConflict: (conflict) =>
    set((state) => ({
      conflictQueue: [...state.conflictQueue, conflict],
    })),

  removeConflict: (transferId) =>
    set((state) => ({
      conflictQueue: state.conflictQueue.filter((c) => c.transfer_id !== transferId),
    })),
}));
