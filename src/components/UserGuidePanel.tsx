import React from 'react';
import {
  Bluetooth,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Disc3,
  Download,
  Lightbulb,
  Mic,
  Music2,
  Radio,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Volume2,
  Wrench,
  Zap,
} from 'lucide-react';
import { APP_VERSION, NavTab } from '../types/speaker';

interface UserGuidePanelProps {
  onNavigate: (tab: NavTab) => void;
  onOpenBluetoothModal: () => void;
  onActivateNeon: () => void;
}

export const UserGuidePanel: React.FC<UserGuidePanelProps> = ({
  onNavigate,
  onOpenBluetoothModal,
  onActivateNeon,
}) => {
  return (
    <div className="space-y-6">
      {/* Hero Header Card */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <BookOpen className="h-6 w-6 text-[#D95B2B]" />
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
                מדריך למשתמש — JBL PartyBox Stage 320 (גרסה {APP_VERSION})
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              מדריך מלא, ברור ומסודר להפעלת{' '}
              <strong className="text-[#D95B2B]">בקרת התאורה החיה ברמקול הנייד</strong>,{' '}
              <strong className="text-emerald-600 dark:text-emerald-400">
                סינכרון אוטומטי מלא עם נגן המוזיקה שלך ללא העלאת שירים
              </strong>
              , עיצוב{' '}
              <strong className="text-cyan-600 dark:text-cyan-400">
                תאורת ניאון זוהרת
              </strong>
              , כיול סאונד ואבחון תקלות מהיר.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenBluetoothModal}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D95B2B] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#C24E22] whitespace-nowrap cursor-pointer"
            >
              <Bluetooth className="h-4 w-4" />
              <span>חיבור מהיר לרמקול</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate(NavTab.FaultLog)}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <ClipboardList className="h-4 w-4 text-[#D95B2B]" />
              <span>פתיחת יומן תקלות</span>
            </button>
          </div>
        </div>
      </section>

      {/* Step 1: Bluetooth + Hardware Lighting Connection */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex items-center gap-2.5">
          <Bluetooth className="h-5 w-5 text-[#D95B2B]" />
          <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            1. חיבור מלא לרמקול הנייד (שמע + ערוץ בקרת תאורה)
          </h3>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          רמקול ה-<strong className="text-slate-900 dark:text-white">JBL PartyBox Stage 320</strong>{' '}
          עובד בשני ערוצי בלוטוס במקביל:{' '}
          <strong className="text-[#D95B2B]">ערוץ שמע (A2DP)</strong> לניגון המוזיקה, ו-
          <strong className="text-cyan-600 dark:text-cyan-400">
            ערוץ פקודות חכם (BLE GATT / SPP)
          </strong>{' '}
          לשליטה על נורות ה-LED והניאון שעל גוף הרמקול.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#D95B2B]">
              <ShieldCheck className="h-4 w-4" />
              <span>שלב א׳ — אישור הרשאות</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              לחץ על הכפתור הכתום{' '}
              <strong className="text-slate-900 dark:text-white">
                ״חיבור בלוטוס לרמקול״
              </strong>{' '}
              בראש המסך ואשר הרשאת{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">
                מכשירים קרובים (Nearby Devices)
              </strong>{' '}
              והרשאת <strong className="text-emerald-700 dark:text-emerald-400">שמע</strong>.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-700 dark:text-cyan-400">
              <Radio className="h-4 w-4" />
              <span>שלב ב׳ — פתיחת ערוץ התאורה</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              באפליקציית ה-<strong>APK לאנדרואיד</strong> בחר את הרמקול מהרשימה או לחץ{' '}
              <strong className="text-slate-900 dark:text-white">
                ״סרוק וחבר רמקול JBL PartyBox״
              </strong>
              . האפליקציה פותחת אוטומטית חיבור כפול (<strong>BLE + SPP</strong>) לתאורה.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>שלב ג׳ — בדיקת הבהוב ברמקול</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              בלשונית <strong className="text-slate-900 dark:text-white">״תאורת מופע״</strong>{' '}
              לחץ על{' '}
              <strong className="text-[#D95B2B]">״שלח בדיקת תאורה לרמקול״</strong> כדי לוודא שפקודות הצבע מגיעות מיד לנורות הרמקול.
            </p>
          </div>
        </div>
      </section>

      {/* Step 2: Zero-Upload External Music Player Sync */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex items-center gap-2.5">
          <Music2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            2. סינכרון אוטומטי מלא עם השירים בנגן שלך — ללא שום העלאת שירים!
          </h3>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          האפליקציה{' '}
          <strong className="text-emerald-700 dark:text-emerald-400">
            לעולם אינה דורשת להעלות קובצי MP3 או שירים
          </strong>
          . פשוט הפעל כל שיר שאתה אוהב בנגן הקבוע שלך —{' '}
          <strong className="text-slate-900 dark:text-white">
            Spotify, YouTube Music, Apple Music, YouTube, Samsung Music או VLC
          </strong>{' '}
          — והאפליקציה תסתנכרן אליו בזמן אמת:
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50/50 p-4 dark:bg-emerald-950/20">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
              <strong className="text-emerald-800 dark:text-emerald-300">
                באפליקציית האנדרואיד (APK):
              </strong>{' '}
              מנוע ה-DSP מתחבר ישירות ל<strong>ערוץ השמע הראשי של המכשיר (Master Audio Mix Session 0)</strong>. כל שיר שמתנגן ברקע בנגן שלך מפעיל אוטומטית את ה<strong>ספקטרום (28 עמודות תדר)</strong>, את ה<strong>איקוולייזר 7 ערוצים</strong>, את ה-<strong>BPM החי</strong> ואת <strong>פעימות התאורה ברמקול</strong>! ניתן גם להעביר שיר קדימה/אחורה ולהשהות ישירות מסרגל הנגן העליון.
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-50/50 p-4 dark:bg-cyan-950/20">
            <Volume2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
              <strong className="text-cyan-800 dark:text-cyan-300">
                בדפדפן מחשב או נייד:
              </strong>{' '}
              לחץ על הכפתור{' '}
              <strong className="text-slate-900 dark:text-white">
                ״סנכרן אוטומטית עם הנגן שלך״
              </strong>{' '}
              לקליטה אקוסטית נקייה של המוזיקה בחדר (ללא סינון קול שפוגע בבסים), או לחץ במחשב על{' '}
              <strong className="text-slate-900 dark:text-white">
                ״סינכרון שמע מערכת / YouTube״
              </strong>{' '}
              לקליטה דיגיטלית ישירה מהכרטיסייה המנגנת.
            </div>
          </div>
        </div>
      </section>

      {/* Step 3: Lightshow, 5 Physical Zones & Neon Mode */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-fuchsia-500 dark:text-cyan-400" />
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              3. שליטה בתאורת המופע, 5 אזורי LED ותאורת ניאון יפה
            </h3>
          </div>

          <button
            type="button"
            onClick={() => {
              onActivateNeon();
              onNavigate(NavTab.Lightshow);
            }}
            className="flex min-h-[40px] items-center gap-2 rounded-xl border border-cyan-400/60 bg-gradient-to-l from-cyan-500/15 to-fuchsia-500/15 px-4 py-2 text-xs font-bold text-cyan-900 hover:opacity-90 dark:text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
            <span>הפעל תאורת ניאון ועבור לסטודיו</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-2 text-xs font-bold text-fuchsia-600 dark:text-fuchsia-400">
              <Sun className="h-4 w-4" />
              <span>7 דפוסי תנועה + מצב ניאון זוהר</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <li>
                • <strong className="text-cyan-600 dark:text-cyan-400">ניאון זוהר (Neon):</strong>{' '}
                שילוב טורקיז חשמלי ומג׳נטה זוהרת בטבעות ובפסי הצד.
              </li>
              <li>
                • <strong className="text-[#D95B2B]">רוק / זרימה / חצייה / אדוות:</strong>{' '}
                תנועת שמינייה דינמית המתגברת עם כל מכת תוף בס.
              </li>
              <li>
                • <strong className="text-amber-600 dark:text-amber-400">תאורת אווירה קבועה:</strong>{' '}
                צבע אחיד ונעים ללא הבהובים לערבי אירוח רגועים.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#D95B2B]">
              <Lightbulb className="h-4 w-4" />
              <span>שליטה נפרדת על 5 אזורי התאורה בתיבה</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <li>
                • <strong>טבעות Figure-8 כפולות:</strong> סביב שני הוופרים בקוטר 6.5 אינץ׳.
              </li>
              <li>
                • <strong>מבזק סטרוב עליון ותחתון:</strong> ניתנים לכיבוי בלחיצה על <strong>״ללא סטרובים״</strong>.
              </li>
              <li>
                • <strong>מטריצת כוכבים + פסי צד:</strong> ניתן להקיש גם ישירות על איור הרמקול להדלקה וכיבוי!
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Step 4: Equalizer, BassBoost, Karaoke & PartyPad */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-[#D95B2B]" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                4. איקוולייזר 7 ערוצים, BassBoost וכיול חדר
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(NavTab.Equalizer)}
              className="text-xs font-bold text-[#D95B2B] hover:underline cursor-pointer"
            >
              פתח איקוולייזר
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <li>
              • <strong className="text-[#D95B2B]">בס עמוק (Deep 48Hz):</strong> מדגיש רעידת סאב עמוקה וחמה להיפ-הופ ורגאטון.
            </li>
            <li>
              • <strong className="text-amber-600 dark:text-amber-400">בס הדוק (Punchy 84Hz):</strong> מכת פאנץ׳ מהירה וחדה למוזיקת האוס, טכנו ודאנס.
            </li>
            <li>
              • <strong className="text-emerald-600 dark:text-emerald-400">כיול אקוסטי ב-5 שניות:</strong> מודד את ההדהוד בחדר או במרפסת ומכוון אוטומטית את 7 התדרים.
            </li>
          </ul>
        </section>

        <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                5. קריוקי חי, גיטרה, PartyPad ו-Auracast™
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(NavTab.PartyFx)}
              className="text-xs font-bold text-[#D95B2B] hover:underline cursor-pointer"
            >
              פתח קריוקי ואפקטים
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <li>
              • <strong className="text-teal-700 dark:text-teal-400">קריוקי חי מהטלפון:</strong> לשיר או להנחות ישירות מהטלפון לרמקול עם <strong>אפקט Echo</strong> וסינון פידבק.
            </li>
            <li>
              • <strong className="text-[#D95B2B]">הנמכת מוזיקה אוטומטית (MC Ducking):</strong> מנמיך בעדינות את השיר ברגע שמדברים במיקרופון.
            </li>
            <li>
              • <strong className="text-fuchsia-600 dark:text-fuchsia-400">6 משטחי DJ + 4 כפתורי הקלטה אישית:</strong> צופר אוויר, דרופ 808, לייזר והקלטת קריאות קהל משלך.
            </li>
          </ul>
        </section>
      </div>

      {/* Step 5: Quick Troubleshooting & Android APK Tips */}
      <section className="neon-surface rounded-2xl border border-amber-400/40 bg-amber-50/40 p-6 transition-colors dark:border-amber-500/30 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Wrench className="h-5 w-5 text-[#D95B2B]" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              6. פתרון תקלות מהיר וטיפים חשובים לעבודה חלקה
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate(NavTab.FaultLog)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#D95B2B] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#C24E22] cursor-pointer"
            >
              <Disc3 className="h-3.5 w-3.5" />
              <span>פתח יומן תקלות ובדיקה עצמית</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate(NavTab.ApkDownload)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>הורדת APK מעודכן ({APP_VERSION})</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 dark:border-slate-700 dark:bg-[#141B27]">
            <strong className="text-rose-600 dark:text-rose-400">
              השיר מתנגן ברמקול אבל התאורה הפיזית לא מתחלפת?
            </strong>
            <p className="mt-1">
              זיווג שמע רגיל בהגדרות הטלפון מחבר רק אודיו. היכנס לחלון{' '}
              <strong>״חיבור בלוטוס לרמקול״</strong> בתוך האפליקציה ולחץ על{' '}
              <strong>״סרוק וחבר רמקול JBL PartyBox״</strong> כדי לפתוח גם את ערוץ התאורה (BLE / SPP).
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 dark:border-slate-700 dark:bg-[#141B27]">
            <strong className="text-amber-700 dark:text-amber-400">
              מתקין גרסת APK חדשה באנדרואיד ומופיעה הודעת חבילה קיימת?
            </strong>
            <p className="mt-1">
              אם מותקנת אצלך גרסה ישנה מאוד, הסר אותה פעם אחת והתקן את{' '}
              <strong className="font-mono" dir="ltr">
                v{APP_VERSION}
              </strong>{' '}
              החדשה — ניתן לשמור קודם גיבוי הגדרות מלא בלשונית האיקוולייזר.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
