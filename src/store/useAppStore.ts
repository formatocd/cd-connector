import { create } from "zustand";
import i18n from "../i18n";
import { api } from "../services/tauri";
import type {
  AppConfig,
  CredentialSummary,
  Folder,
  OpenTab,
  SecurityStatus,
  Session,
  SessionLogEvent,
  TransientAuth,
} from "../types";

const DEFAULT_CONFIG: AppConfig = {
  theme: "system",
  language: "es",
  max_concurrent_transfers: 3,
  upload_limit_kbps: 0,
  download_limit_kbps: 0,
  ui_show_sidebar: true,
  ui_show_local_panel: true,
  ui_show_queue_panel: true,
  ui_show_command_panel: true,
};

interface AppStoreState {
  loading: boolean;
  security: SecurityStatus;
  config: AppConfig;
  folders: Folder[];
  sessions: Session[];
  credentials: CredentialSummary[];
  tabs: OpenTab[];
  activeTabId: string | null;
  sessionLogs: Record<string, SessionLogEvent[]>;

  initialize: () => Promise<void>;
  refreshVaultData: () => Promise<void>;
  setSecurity: (status: SecurityStatus) => void;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;

  openSessionTab: (session: Session, transientAuth?: TransientAuth) => void;
  closeTab: (tabId: string) => void;
  duplicateTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  appendSessionLog: (event: SessionLogEvent) => void;
  clearSessionLogs: (tabId: string) => void;
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
  sessionLogs: {},

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
      set({ folders: [], sessions: [], credentials: [], tabs: [], activeTabId: null });
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
    set((state) => ({
      tabs: [...state.tabs, { tabId, session, transientAuth }],
      activeTabId: tabId,
    }));
  },

  closeTab: (tabId) => {
    api.disconnectSession(tabId).catch(() => {});
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.tabId === tabId);
      const nextTabs = state.tabs.filter((t) => t.tabId !== tabId);
      let nextActive = state.activeTabId;
      if (state.activeTabId === tabId) {
        if (nextTabs.length === 0) {
          nextActive = null;
        } else {
          nextActive = nextTabs[Math.min(idx, nextTabs.length - 1)].tabId;
        }
      }
      const nextLogs = { ...state.sessionLogs };
      delete nextLogs[tabId];
      return { tabs: nextTabs, activeTabId: nextActive, sessionLogs: nextLogs };
    });
  },

  duplicateTab: (tabId) => {
    const target = get().tabs.find((t) => t.tabId === tabId);
    if (!target) return;
    get().openSessionTab(target.session, target.transientAuth);
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

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
}));
