import {
  APP_VERSION,
  FaultCategory,
  FaultLogEntry,
  FaultSeverity,
} from '../types/speaker';

const STORAGE_KEY_FAULT_LOG = 'jbl_pb320_fault_log_v1';
const MAX_LOG_ENTRIES = 160;

class SystemFaultLogger {
  private entries: FaultLogEntry[] = [];
  private unreadIssueCount = 0;
  private listeners = new Set<() => void>();
  private initializedGlobalHooks = false;

  constructor() {
    this.loadFromStorage();
    this.installGlobalHooks();
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FAULT_LOG);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.slice(0, MAX_LOG_ENTRIES);
        }
      }
    } catch {
      this.entries = [];
    }

    if (this.entries.length === 0) {
      this.record({
        severity: 'info',
        category: 'system',
        title: `מערכת השליטה הופעלה (גרסה ${APP_VERSION})`,
        details:
          'יומן התקלות והאבחון פעיל ומנטר בזמן אמת חיבורי Bluetooth, שליחת פקודות תאורה לרמקול וסינכרון חי עם נגן המוזיקה.',
      });
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY_FAULT_LOG,
        JSON.stringify(this.entries.slice(0, MAX_LOG_ENTRIES))
      );
    } catch {
      // ignore storage quota errors
    }
  }

  private installGlobalHooks(): void {
    if (typeof window === 'undefined' || this.initializedGlobalHooks) return;
    this.initializedGlobalHooks = true;

    window.addEventListener('error', (event) => {
      const msg = event.message || 'שגיאת ריצה כללית בדפדפן';
      if (msg.includes('ResizeObserver') || msg.includes('WebSocket')) {
        return;
      }
      this.record({
        severity: 'error',
        category: 'system',
        title: 'שגיאת זמן-ריצה במערכת',
        details: msg,
        technicalCode: event.filename
          ? `${event.filename.split('/').pop()}:${event.lineno}`
          : undefined,
        suggestionHe:
          'נסה לרענן את המסך או לבצע בדיקת מערכת מתוך לשונית יומן התקלות.',
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason || 'Promise rejection');
      if (reason.includes('WebSocket') || reason.includes('vite')) {
        return;
      }
      this.record({
        severity: 'warning',
        category: 'system',
        title: 'פעולה אסינכרונית נדחתה',
        details: reason,
        suggestionHe:
          'בדוק את הרשאות ה-Bluetooth והשמע בחלון החיבור העליון.',
      });
    });
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public record(input: {
    severity: FaultSeverity;
    category: FaultCategory;
    title: string;
    details: string;
    suggestionHe?: string;
    technicalCode?: string;
  }): FaultLogEntry {
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Deduplicate identical consecutive entries within 2.5 seconds to avoid log spam
    const latest = this.entries[0];
    if (
      latest &&
      latest.title === input.title &&
      latest.details === input.details &&
      now.getTime() - new Date(latest.timestampIso).getTime() < 2500
    ) {
      return latest;
    }

    const entry: FaultLogEntry = {
      id: `flt_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      timestampIso: now.toISOString(),
      timeFormatted,
      severity: input.severity,
      category: input.category,
      title: input.title,
      details: input.details,
      suggestionHe: input.suggestionHe,
      technicalCode: input.technicalCode,
    };

    this.entries = [entry, ...this.entries].slice(0, MAX_LOG_ENTRIES);
    if (input.severity === 'error' || input.severity === 'warning') {
      this.unreadIssueCount += 1;
    }
    this.persist();
    this.notify();
    return entry;
  }

  public getEntries(): FaultLogEntry[] {
    return this.entries;
  }

  public getUnreadIssueCount(): number {
    return this.unreadIssueCount;
  }

  public markAllRead(): void {
    if (this.unreadIssueCount !== 0) {
      this.unreadIssueCount = 0;
      this.notify();
    }
  }

  public clearAll(): void {
    this.entries = [];
    this.unreadIssueCount = 0;
    this.persist();
    this.record({
      severity: 'info',
      category: 'system',
      title: 'יומן התקלות נוקה על ידי המשתמש',
      details: `התחלת מעקב חדשה בגרסה ${APP_VERSION}.`,
    });
  }

  public formatPlainTextReport(): string {
    const header = [
      `=== דוח אבחון ויומן תקלות — JBL PartyBox Stage 320 (גרסה ${APP_VERSION}) ===`,
      `הופק בתאריך: ${new Date().toLocaleString('he-IL')}`,
      `סה״כ רשומות ביומן: ${this.entries.length}`,
      '-------------------------------------------------------------------------',
      '',
    ];

    const lines = this.entries.map((e) => {
      const sevMap: Record<FaultSeverity, string> = {
        error: 'תקלה',
        warning: 'אזהרה',
        success: 'תקין',
        info: 'מידע',
      };
      const parts = [
        `[${e.timeFormatted}] [${sevMap[e.severity]}] [${e.category.toUpperCase()}] ${e.title}`,
        `  פירוט: ${e.details}`,
      ];
      if (e.technicalCode) {
        parts.push(`  קוד טכני: ${e.technicalCode}`);
      }
      if (e.suggestionHe) {
        parts.push(`  פתרון מומלץ: ${e.suggestionHe}`);
      }
      return parts.join('\n');
    });

    return [...header, ...lines].join('\n\n');
  }
}

export const faultLogger = new SystemFaultLogger();
