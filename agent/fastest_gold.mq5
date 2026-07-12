//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 9.02 |
//|  Gold scalper - bar-gated, closed-bar signals, smart filters     |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "9.16"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;      // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1;// Working timeframe
input int             MaxPositions = 10;       // Max open positions
input int             CooldownSecs = 60;       // Cooldown between entries (sec)
input int             MaxSpread    = 350;      // Max spread in points
input bool            UseSession   = false;    // Session filter (false=trade 24h)

//--- constants
#define EA_NAME       "GoldScalperX"
#define EA_VERSION    "9.16"
#define DASH_PREFIX   "GSX_D_"
#define SETTINGS_FILE   "GSX_Settings.json"
#define CURRENT_FILE    "GSX_Current.json"

//--- panel layout
#define PANEL_X   10
#define PANEL_Y   10
#define PANEL_W   275
#define PAD       18
#define ROW_H     22
#define TITLE_H   28

//--- panel colors
#define CLR_BG      C'15,15,25'
#define CLR_BORDER  clrDimGray
#define CLR_DIVIDER C'55,55,75'
#define CLR_KEY     C'130,130,155'
#define CLR_GOOD    clrLime
#define CLR_BAD     clrOrangeRed
#define CLR_HILITE  clrDeepSkyBlue
#define CLR_NEUTRAL clrSilver

//--- globals
CTrade         trade;
CPositionInfo  posInfo;

long     g_magic         = 0;
int      hRSI = INVALID_HANDLE, hEMA9 = INVALID_HANDLE,
         hEMA21 = INVALID_HANDLE, hATR = INVALID_HANDLE,
         hH1EMA = INVALID_HANDLE,   // H1 EMA21 - bias filter
         hM15EMA = INVALID_HANDLE,  // M15 EMA21 - MTF filter (مؤكّد بالباك-تيست)
         hM5EMA9 = INVALID_HANDLE, hM5EMA21 = INVALID_HANDLE; // M5 mid-trend filter
datetime g_lastEntryTime = 0;
datetime g_lastBar       = 0;
double   g_snapRSI       = 50.0;
bool     g_snapEMAUp     = false;
double   g_snapATR       = 0.0;
int      g_totalTrades   = 0;

double   g_lot          = 0.5;
int      g_maxPositions = 10;
int      g_cooldownSecs = 0;
double   g_maxSpread    = 350.0;
double   g_tpUSD        = 4.0;   // default 1:2 ratio with SL
double   g_slUSD        = 2.0;
double   g_maxLossPerDay   = 50.0;
double   g_maxProfitPerDay = 200.0;
int      g_tradeHoursStart = 0;
int      g_tradeHoursEnd   = 24;
int      g_orderType       = 3;   // 0=MARKET  1=LIMIT  2=STOP  3=BASKET
bool     g_newsBlock       = false;
string   g_newsTitle       = "";
int      g_riskMode        = 0;    // 0=لوت ثابت  1=نسبة من الرصيد
double   g_riskPct         = 1.0;  // نسبة الخطر % (لما riskMode=1)
double   g_rsiBuyMax       = 65.0; // Claude auto-adjust: حد RSI لـ BUY
double   g_rsiSellMin      = 35.0; // Claude auto-adjust: حد RSI لـ SELL
bool     g_useH1Filter     = true;  // فلتر اتجاه H1 EMA21
bool     g_useM15Filter    = true;  // فلتر اتجاه M15 (توافق التايمات - يرفع الأداء)
bool     g_useRSIFilter    = true;  // فلتر RSI

// Strategy mode - bitmask: 1=Grid  2=Hedge  4=Scale
int    g_strategyMode  = 0;
int    g_gridLevels    = 3;    // عدد مستويات الشبكة
int    g_gridStep      = 50;   // نقاط بين كل مستوى
bool   g_claudeGrid    = false;// كلود يحدّد أماكن أوردرات الشبكة من الشارت
double g_aiBuys[64];  int g_aiBuyN  = 0;   // مستويات دعم من كلود (شراء)
double g_aiSells[64]; int g_aiSellN = 0;   // مستويات مقاومة من كلود (بيع)
double g_hedgeLotMult  = 0.5;  // نسبة لوت الهيدج من الأصلي
int    g_scaleStep     = 30;   // نقاط خسارة قبل scale-in
double g_scaleMult     = 1.5;  // مضاعف اللوت عند scale
int    g_maxScales     = 3;    // أقصى scale-ins لكل صفقة

// ── فلاتر السكالبينج (من سكِل XAUUSD) - كلها OFF افتراضياً ──────────
bool   g_useATRFilter   = false; // فلتر تقلب: يمنع الدخول لو ATR عالي
double g_maxATRPoints   = 80.0;  // أقصى ATR بالنقاط للسماح بالدخول
bool   g_blockRollover  = false; // يمنع التداول وقت الرول-أوفر 21-22 GMT
int    g_maxConsecLosses= 0;     // 0=معطّل | حد الخسائر المتتالية قبل إيقاف الجلسة
int    g_consecLosses   = 0;     // عدّاد الخسائر المتتالية (داخلي)
int    g_maxHoldMin     = 0;     // 0=معطّل | يسكّر الصفقة بعد X دقيقة (خروج بالوقت)

// ── الانعكاس بتصويت الترند: بعد خسائر متتالية، اتبع اتجاه الفريمات ──
string g_blockReason       = "?";   // سبب عدم فتح صفقات حالياً (للشريط)
bool   g_trendReverse      = false; // فعّل الانعكاس الذكي
int    g_reverseAfterLosses= 3;     // بعد كم خسارة متتالية يتفعّل
bool   g_reverseActive     = false; // حالة: مفعّل الآن؟
int    g_trendDir          = 0;     // اتجاه التصويت: +1 صعود، -1 هبوط، 0 رينج(إيقاف)

// ── قفل الربح عند الركود: يسكّر الصفقة الرابحة لو وقفت تتقدّم ──────
double g_lockProfitUSD  = 0.0;   // 0=معطّل | أقل ربح $ لتفعيل المراقبة
int    g_stallSecs      = 60;    // ثواني بلا تقدّم (ذروة جديدة) قبل حجز الربح
ulong    g_lkTk[256];            // سجلّ: تذاكر الصفقات
double   g_lkPeak[256];          // أعلى ربح وصلته كل صفقة
datetime g_lkTime[256];          // وقت آخر ذروة ربح
int      g_lkCount = 0;

// ── الوضع الآلي الكامل (Auto): لوت + TP + SL ديناميكية من ATR ──────
bool   g_autoTPSL       = false; // زر واحد: يخلي اللوت والـ TP/SL تلقائية
bool   g_splitLot       = false; // يوزّع اللوت على أقصى عدد صفقات
double g_marginUsePct   = 0.0;   // 0=معطّل | يحسب اللوت لاستغلال % من الهامش عبر كل الصفقات
bool   g_syncTPSL       = false; // يكتب TP/SL الحقيقية على الصفقات ويحدّثها مع الإعدادات
bool   g_exitOnReverse  = false; // يقص الصفقة الخاسرة لو الشمعة انعكست ضد اتجاهها
double g_quickTPUSD     = 0.0;   // 0=معطّل | يسكّر الصفقة كاملة عند ربح $ ثابت (بغضّ النظر عن AUTO)
double g_trailStartUSD  = 0.0;   // 0=معطّل | يبدأ التريلينج بعد ربح $
double g_trailGiveUSD   = 0.5;   // كم $ يسمح يرجع من الذروة قبل ما يقفل (أصغر=أسرع)
double g_partialTP_R    = 0.0;   // 0=معطّل | جني جزئي عند ربح = Rx الستوب
double g_partialTP_Frac = 0.5;   // نسبة الصفقة التي تُغلق عند الجني الجزئي
bool   g_lkTp1[256];             // هل تم الجني الجزئي لهذه الصفقة؟
const double AUTO_RISK_PCT = 1.0;  // نسبة المخاطرة من الرصيد لكل صفقة
const double AUTO_SL_ATR   = 1.25; // مضاعف ATR للستوب (M1 مؤكّد بالباك-تيست)
const double AUTO_TP_RR    = 2.8;  // نسبة الهدف للخطر R:R (M1: PF 1.36 - 40 صفقة/يوم)

// Scale tracking
ulong  g_scaledFrom[200];
int    g_scaledCount = 0;

// Day P&L tracking
double   g_dayPL   = 0.0;
datetime g_today   = 0;

//+------------------------------------------------------------------+
long MagicFromSymbol(const string sym)
  {
   ulong h = 5381;
   int len = StringLen(sym);
   for(int i = 0; i < len; i++)
      h = ((h << 5) + h) + (ulong)StringGetCharacter(sym, i);
   return (long)(100000 + (h % 900000));
  }

//+------------------------------------------------------------------+
double ReadSetting(const string name, const double fallback)
  {
   // كل إعداد في ملف نصي منفصل - سطر واحد فقط يحتوي الرقم
   string fname = "GSX_" + name + ".txt";
   int fh = FileOpen(fname, FILE_READ|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return fallback;
   string s = FileReadString(fh);
   FileClose(fh);
   double v = StringToDouble(s);
   return (s == "" || (v == 0.0 && s != "0" && s != "0.0")) ? fallback : v;
  }

//+------------------------------------------------------------------+
bool     g_botRunning = true;

//+------------------------------------------------------------------+
void WriteCurrentSettings()
  {
   // يكتب الإعدادات الفعلية الشغّالة حالياً -> الـ Agent يقرأها ويرفعها للداشبورد
   int fh = FileOpen(CURRENT_FILE, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   string j = "{\n";
   j += "  \"LotSize\": "        + DoubleToString(g_lot,2)           + ",\n";
   j += "  \"TP_USD\": "         + DoubleToString(g_tpUSD,2)         + ",\n";
   j += "  \"SL_USD\": "         + DoubleToString(g_slUSD,2)         + ",\n";
   j += "  \"MaxSpread\": "      + DoubleToString(g_maxSpread,0)     + ",\n";
   j += "  \"MaxPositions\": "   + IntegerToString(g_maxPositions)   + ",\n";
   j += "  \"CooldownSecs\": "   + IntegerToString(g_cooldownSecs)   + ",\n";
   j += "  \"MaxLossPerDay\": "  + DoubleToString(g_maxLossPerDay,2) + ",\n";
   j += "  \"MaxProfitPerDay\": "+ DoubleToString(g_maxProfitPerDay,2)+ ",\n";
   j += "  \"TradeHoursStart\": "+ IntegerToString(g_tradeHoursStart)+ ",\n";
   j += "  \"TradeHoursEnd\": "  + IntegerToString(g_tradeHoursEnd)  + ",\n";
   j += "  \"BotRunning\": "     + (g_botRunning ? "1" : "0")        + ",\n";
   j += "  \"UseH1Filter\": "   + (g_useH1Filter ? "1" : "0")        + ",\n";
   j += "  \"UseM15Filter\": "  + (g_useM15Filter ? "1" : "0")       + ",\n";
   j += "  \"UseRSIFilter\": "  + (g_useRSIFilter ? "1" : "0")       + ",\n";
   j += "  \"StrategyMode\": " + IntegerToString(g_strategyMode)     + ",\n";
   j += "  \"GridLevels\": "   + IntegerToString(g_gridLevels)       + ",\n";
   j += "  \"GridStep\": "     + IntegerToString(g_gridStep)         + ",\n";
   j += "  \"ClaudeGrid\": "   + (g_claudeGrid ? "1" : "0")          + ",\n";
   j += "  \"HedgeLotMult\": " + DoubleToString(g_hedgeLotMult,2)   + ",\n";
   j += "  \"ScaleStep\": "    + IntegerToString(g_scaleStep)        + ",\n";
   j += "  \"ScaleMult\": "    + DoubleToString(g_scaleMult,2)       + ",\n";
   j += "  \"MaxScales\": "    + IntegerToString(g_maxScales)        + ",\n";
   j += "  \"OrderType\": "    + IntegerToString(g_orderType)        + ",\n";
   j += "  \"RiskMode\": "     + IntegerToString(g_riskMode)         + ",\n";
   j += "  \"RiskPercent\": "  + DoubleToString(g_riskPct,2)         + ",\n";
   j += "  \"RSIBuyMax\": "    + DoubleToString(g_rsiBuyMax,1)       + ",\n";
   j += "  \"RSISellMin\": "   + DoubleToString(g_rsiSellMin,1)      + ",\n";
   j += "  \"UseATRFilter\": " + (g_useATRFilter ? "1" : "0")        + ",\n";
   j += "  \"MaxATRPoints\": " + DoubleToString(g_maxATRPoints,0)    + ",\n";
   j += "  \"BlockRollover\": "+ (g_blockRollover ? "1" : "0")       + ",\n";
   j += "  \"MaxConsecLosses\": "+ IntegerToString(g_maxConsecLosses)+ ",\n";
   j += "  \"AutoTPSL\": "     + (g_autoTPSL ? "1" : "0")            + ",\n";
   j += "  \"SplitLot\": "     + (g_splitLot ? "1" : "0")            + ",\n";
   j += "  \"MarginUsePct\": " + DoubleToString(g_marginUsePct,1)    + ",\n";
   j += "  \"MaxHoldMin\": "   + IntegerToString(g_maxHoldMin)       + ",\n";
   j += "  \"LockProfitUSD\": "+ DoubleToString(g_lockProfitUSD,2)   + ",\n";
   j += "  \"StallSecs\": "    + IntegerToString(g_stallSecs)        + ",\n";
   j += "  \"SyncTPSL\": "     + (g_syncTPSL ? "1" : "0")            + ",\n";
   j += "  \"ExitOnReverse\": "+ (g_exitOnReverse ? "1" : "0")       + ",\n";
   j += "  \"QuickTPUSD\": "   + DoubleToString(g_quickTPUSD,2)      + ",\n";
   j += "  \"TrailStartUSD\": "+ DoubleToString(g_trailStartUSD,2)   + ",\n";
   j += "  \"TrailGiveUSD\": " + DoubleToString(g_trailGiveUSD,2)    + ",\n";
   j += "  \"TrendReverse\": " + (g_trendReverse ? "1" : "0")        + ",\n";
   j += "  \"ReverseAfterLosses\": "+ IntegerToString(g_reverseAfterLosses) + ",\n";
   j += "  \"PartialTP_R\": "  + DoubleToString(g_partialTP_R,2)     + ",\n";
   j += "  \"PartialTP_Frac\": "+ DoubleToString(g_partialTP_Frac,2) + "\n";
   j += "}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

string g_lastSettingsHash = "";

//+------------------------------------------------------------------+
// يقرأ حالة فلتر الأخبار من ملف يكتبه الـ Agent كل دقيقة
void LoadNewsBlock()
  {
   int fh = FileOpen("GSX_NewsBlock.txt", FILE_READ|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) { g_newsBlock=false; g_newsTitle=""; return; }
   string line = FileReadString(fh);
   FileClose(fh);
   // الصيغة: "1|NFP 30min" أو "0"
   if(StringLen(line) > 0 && line[0] == '1')
     {
      g_newsBlock = true;
      int sep = StringFind(line, "|");
      g_newsTitle = sep > 0 ? StringSubstr(line, sep+1) : "High Impact News";
     }
   else
     { g_newsBlock=false; g_newsTitle=""; }
  }

//+------------------------------------------------------------------+
// كتابة لوق في ملف + Experts tab
//+------------------------------------------------------------------+
#define LOG_FILE "GSX_Log.txt"
void EALog(string msg)
  {
   Print(EA_NAME, ": ", msg);
   int fh = FileOpen(LOG_FILE, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_COMMON);
   if(fh != INVALID_HANDLE)
     {
      FileSeek(fh, 0, SEEK_END);
      FileWriteString(fh, TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "|" + msg + "\n");
      FileClose(fh);
     }
  }

//+------------------------------------------------------------------+
// يكتب حالة البوت الحالية (سبب عدم الدخول) لملف يقرأه الأجنت -> الشريط
void WriteStatus(const string s)
  {
   int fh = FileOpen("GSX_Status.txt", FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   FileWriteString(fh, s);
   FileClose(fh);
  }

//+------------------------------------------------------------------+
// يحسب اللوت - ثابت أو ديناميكي حسب الإعداد
//+------------------------------------------------------------------+
// آخر قيمة ATR بالسعر (لحساب الوضع الآلي)
double CurrentATRprice()
  {
   if(hATR == INVALID_HANDLE) return 0.0;
   double a[];
   ArraySetAsSeries(a, true);
   if(CopyBuffer(hATR, 0, 0, 2, a) < 2) return 0.0;
   return a[1];
  }

// قيمة الدولار لكل وحدة سعر لكل لوت (تُستعمل لتحويل مسافة ATR ↔ دولار)
double ValuePerPricePerLot()
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(ts <= 0.0) return 0.0;
   return tv / ts;
  }

double CalcLot()
  {
   double raw;

   // ── سايزنق على أساس الهامش: يرفع اللوت ليستغل % من الرصيد عبر كل الصفقات ──
   if(g_marginUsePct > 0.0)
     {
      double price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double mpl   = 0.0;
      if(price > 0.0 && OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, 1.0, price, mpl) && mpl > 0.0)
        {
         double freeM = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
         int    n     = MathMax(1, g_maxPositions);
         double lot   = (freeM * (g_marginUsePct/100.0)) / (n * mpl);
         double step  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
         double minL  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
         double maxL  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
         if(step > 0.0) lot = MathFloor(lot/step)*step;
         lot = MathMax(minL, MathMin(MathMin(maxL, 5.0), lot)); // سقف 5 لوت أمان
         return NormalizeLot(lot);
        }
     }

   // ── اللوت الأساسي حسب الوضع ──────────────────────────────────────
   if(g_autoTPSL)
     {
      double atrP   = CurrentATRprice();
      double vpl    = ValuePerPricePerLot();
      double slDist = AUTO_SL_ATR * atrP;
      if(atrP > 0.0 && vpl > 0.0 && slDist > 0.0)
        {
         double balance = AccountInfoDouble(ACCOUNT_BALANCE);
         double riskAmt = balance * (AUTO_RISK_PCT / 100.0);
         raw = riskAmt / (slDist * vpl);
        }
      else raw = g_lot; // fallback لو ATR غير متاح
     }
   else if(g_riskMode == 0) raw = g_lot;   // لوت ثابت
   else if(g_slUSD <= 0)    raw = g_lot;
   else
     {
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double riskAmt = balance * (g_riskPct / 100.0);
      raw = riskAmt / g_slUSD;
     }

   // ── توزيع اللوت على أقصى عدد صفقات ──────────────────────────────
   // الوضع الآلي يوزّع دائماً؛ والوضع اليدوي يوزّع فقط لو فعّلت SplitLot
   if((g_autoTPSL || g_splitLot) && g_maxPositions > 0) raw = raw / g_maxPositions;

   // ── سقف الهامش: يضمن أن الرصيد يكفي لكل عدد الصفقات المطلوب ──────
   double price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double marginPerLot = 0.0;
   if(price > 0.0 && OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, 1.0, price, marginPerLot)
      && marginPerLot > 0.0)
     {
      double freeM = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      int    n     = MathMax(1, g_maxPositions);
      double afford = (freeM * 0.80) / (n * marginPerLot); // 80% أمان لكل الصفقات
      if(afford > 0.0) raw = MathMin(raw, afford);
     }

   // ── تطبيع + سقف أمان ─────────────────────────────────────────────
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0.0) raw = MathFloor(raw / step) * step;
   raw = MathMax(minL, MathMin(MathMin(maxL, 5.0), raw)); // سقف 5 لوت للأمان
   return NormalizeLot(raw);
  }

void LoadSettings()
  {
   double lot    = ReadSetting("LotSize",        LotSize);
   double spread = ReadSetting("MaxSpread",       (double)MaxSpread);
   int    maxPos = (int)ReadSetting("MaxPositions",(double)MaxPositions);
   int    cd     = (int)ReadSetting("CooldownSecs",(double)CooldownSecs);
   double tp     = ReadSetting("TP_USD",          3.0);
   double sl     = ReadSetting("SL_USD",          2.0);
   double maxL   = ReadSetting("MaxLossPerDay",  50.0);
   double maxP   = ReadSetting("MaxProfitPerDay",200.0);
   int    hStart = (int)ReadSetting("TradeHoursStart", 0.0);
   int    hEnd   = (int)ReadSetting("TradeHoursEnd",  24.0);
   bool   botOn  = (ReadSetting("BotRunning", 1.0) > 0.5);
   int    ordTyp = (int)ReadSetting("OrderType", 0.0);
   int    rMode  = (int)ReadSetting("RiskMode",  0.0);
   double rPct   = ReadSetting("RiskPercent",    1.0);
   double rsiBM  = ReadSetting("RSIBuyMax",      65.0);
   double rsiSM  = ReadSetting("RSISellMin",     35.0);
   bool   useH1  = (ReadSetting("UseH1Filter",   1.0) > 0.5);
   bool   useM15 = (ReadSetting("UseM15Filter",  1.0) > 0.5);
   bool   useRSI = (ReadSetting("UseRSIFilter",  1.0) > 0.5);
   int    sMode  = (int)ReadSetting("StrategyMode", 0.0);
   int    gLev   = (int)ReadSetting("GridLevels",   3.0);
   int    gStep  = (int)ReadSetting("GridStep",    50.0);
   bool   aiGrid = (ReadSetting("ClaudeGrid",       0.0) > 0.5);
   double hMult  = ReadSetting("HedgeLotMult",      0.5);
   int    scStep = (int)ReadSetting("ScaleStep",   30.0);
   double scMult = ReadSetting("ScaleMult",          1.5);
   int    scMax  = (int)ReadSetting("MaxScales",    3.0);
   bool   useATR = (ReadSetting("UseATRFilter",  0.0) > 0.5);
   double maxATR = ReadSetting("MaxATRPoints",   80.0);
   bool   blkRO  = (ReadSetting("BlockRollover",  0.0) > 0.5);
   int    maxCL  = (int)ReadSetting("MaxConsecLosses", 0.0);
   bool   autoTS = (ReadSetting("AutoTPSL",       0.0) > 0.5);
   bool   splitL = (ReadSetting("SplitLot",       0.0) > 0.5);
   double marPct = ReadSetting("MarginUsePct",     0.0);
   bool   syncTS = (ReadSetting("SyncTPSL",        0.0) > 0.5);
   bool   exitRv = (ReadSetting("ExitOnReverse",   0.0) > 0.5);
   double qtp    = ReadSetting("QuickTPUSD",        0.0);
   double trStart= ReadSetting("TrailStartUSD",     0.0);
   double trGive = ReadSetting("TrailGiveUSD",      0.5);
   bool   trRev  = (ReadSetting("TrendReverse",     0.0) > 0.5);
   int    revAft = (int)ReadSetting("ReverseAfterLosses", 3.0);
   double ptpR   = ReadSetting("PartialTP_R",      0.0);
   double ptpF   = ReadSetting("PartialTP_Frac",   0.5);
   int    maxHold= (int)ReadSetting("MaxHoldMin",  0.0);
   double lockUSD= ReadSetting("LockProfitUSD",    0.0);
   int    stallS = (int)ReadSetting("StallSecs",  60.0);

   string hash = DoubleToString(lot,2)+DoubleToString(tp,2)+DoubleToString(sl,2)
               + IntegerToString(maxPos)+DoubleToString(spread,0)
               + IntegerToString(cd)
               + DoubleToString(maxL,2)+DoubleToString(maxP,2)
               + IntegerToString(hStart)+IntegerToString(hEnd)
               + IntegerToString(ordTyp)+(botOn ? "1" : "0")
               + IntegerToString(rMode)+DoubleToString(rPct,1)
               + DoubleToString(rsiBM,1)+DoubleToString(rsiSM,1)
               + (useH1?"1":"0")+(useM15?"1":"0")+(useRSI?"1":"0")
               + IntegerToString(sMode)+IntegerToString(gLev)+IntegerToString(gStep)+(aiGrid?"1":"0")
               + DoubleToString(hMult,2)+IntegerToString(scStep)
               + DoubleToString(scMult,2)+IntegerToString(scMax)
               + (useATR?"1":"0")+DoubleToString(maxATR,0)
               + (blkRO?"1":"0")+IntegerToString(maxCL)
               + (autoTS?"1":"0")+(splitL?"1":"0")+IntegerToString(maxHold)
               + DoubleToString(marPct,1)
               + DoubleToString(lockUSD,2)+IntegerToString(stallS)+(syncTS?"1":"0")+(exitRv?"1":"0")
               + DoubleToString(ptpR,2)+DoubleToString(ptpF,2)+DoubleToString(qtp,2)
               + DoubleToString(trStart,2)+DoubleToString(trGive,2)
               + (trRev?"1":"0")+IntegerToString(revAft);
   bool changed = (hash != g_lastSettingsHash);
   g_lastSettingsHash = hash;

   g_lot=lot; g_maxSpread=spread; g_maxPositions=maxPos; g_cooldownSecs=cd;
   g_tpUSD=tp; g_slUSD=sl; g_maxLossPerDay=maxL; g_maxProfitPerDay=maxP;
   g_tradeHoursStart=hStart; g_tradeHoursEnd=hEnd; g_botRunning=botOn;
   g_orderType=ordTyp; g_riskMode=rMode; g_riskPct=rPct;
   g_rsiBuyMax=rsiBM; g_rsiSellMin=rsiSM;
   g_useH1Filter=useH1; g_useM15Filter=useM15;
   g_useRSIFilter=useRSI;
   g_strategyMode=sMode;
   g_gridLevels=MathMax(1,gLev);  g_gridStep=MathMax(10,gStep); g_claudeGrid=aiGrid;
   g_hedgeLotMult=MathMax(0.1,MathMin(2.0,hMult));
   g_scaleStep=MathMax(10,scStep); g_scaleMult=MathMax(1.0,scMult); g_maxScales=MathMax(1,scMax);
   g_useATRFilter=useATR; g_maxATRPoints=MathMax(0.0,maxATR);
   g_blockRollover=blkRO; g_maxConsecLosses=MathMax(0,maxCL);
   g_autoTPSL=autoTS; g_splitLot=splitL; g_maxHoldMin=MathMax(0,maxHold);
   g_marginUsePct=MathMax(0.0,MathMin(95.0,marPct));
   g_lockProfitUSD=MathMax(0.0,lockUSD); g_stallSecs=MathMax(5,stallS);
   g_syncTPSL=syncTS; g_exitOnReverse=exitRv;
   g_quickTPUSD=MathMax(0.0,qtp);
   g_trailStartUSD=MathMax(0.0,trStart); g_trailGiveUSD=MathMax(0.05,trGive);
   g_trendReverse=trRev; g_reverseAfterLosses=MathMax(1,revAft);
   g_partialTP_R=MathMax(0.0,ptpR); g_partialTP_Frac=MathMax(0.1,MathMin(1.0,ptpF));
   LoadNewsBlock();

   if(changed)
     {
      string otStr = g_orderType==3?"BASKET":g_orderType==1?"LIMIT":g_orderType==2?"STOP":"MARKET";
      string lotStr = g_riskMode==1 ? ("DYNAMIC "+DoubleToString(g_riskPct,1)+"%="+DoubleToString(CalcLot(),2)) : DoubleToString(g_lot,2);
      // طباعة كل الإعدادات المحمّلة من الداشبورد - للتأكد أن كل تعديل وصل للبوت
      EALog("===== settings loaded from dashboard =====");
      EALog("Lot="+lotStr+" | TP$="+DoubleToString(g_tpUSD,2)+" | SL$="+DoubleToString(g_slUSD,2)
            +" | RiskMode="+(g_riskMode==1?"DYNAMIC "+DoubleToString(g_riskPct,1)+"%":"FIXED"));
      EALog("MaxPos="+IntegerToString(g_maxPositions)+" | Spread="+DoubleToString(g_maxSpread,0)
            +" | Cooldown="+IntegerToString(g_cooldownSecs)+"s | Order="+otStr);
      EALog("Bot="+(g_botRunning?"ON":"OFF")+" | Hours="+IntegerToString(g_tradeHoursStart)+"-"+IntegerToString(g_tradeHoursEnd)
            +" | MaxLoss/day=$"+DoubleToString(g_maxLossPerDay,2)+" | MaxProfit/day=$"+DoubleToString(g_maxProfitPerDay,2));
      EALog("Filters: RSI="+(g_useRSIFilter?"ON":"OFF")+" ("+DoubleToString(g_rsiBuyMax,1)+"/"+DoubleToString(g_rsiSellMin,1)+")"
            +" | H1="+(g_useH1Filter?"ON":"OFF")+" | M15="+(g_useM15Filter?"ON":"OFF")+" | StrategyMode="+IntegerToString(g_strategyMode));
      EALog("Grid: ClaudeGrid="+(g_claudeGrid?"ON":"OFF")+" Levels="+IntegerToString(g_gridLevels)+" Step="+IntegerToString(g_gridStep)
            +" | Hedge x"+DoubleToString(g_hedgeLotMult,2)
            +" | Scale: Step="+IntegerToString(g_scaleStep)+" x"+DoubleToString(g_scaleMult,2)+" Max="+IntegerToString(g_maxScales));
      EALog("Scalp: ATRFilter="+(g_useATRFilter?"ON max="+DoubleToString(g_maxATRPoints,0)+"pts":"OFF")
            +" | Rollover="+(g_blockRollover?"BLOCK 21-22GMT":"OFF")
            +" | MaxConsecLosses="+(g_maxConsecLosses>0?IntegerToString(g_maxConsecLosses):"OFF"));
      EALog("AutoMode="+(g_autoTPSL?"ON - dynamic Lot+TP+SL (risk "+DoubleToString(AUTO_RISK_PCT,1)+"% - ATRx"+DoubleToString(AUTO_SL_ATR,1)+" - RR "+DoubleToString(AUTO_TP_RR,1)+")":"OFF - manual")
            +" | SplitLot="+(g_splitLot?"ON /"+IntegerToString(g_maxPositions):"OFF")
            +" | MarginUse="+(g_marginUsePct>0?DoubleToString(g_marginUsePct,0)+"%":"OFF")
            +" | MaxHold="+(g_maxHoldMin>0?IntegerToString(g_maxHoldMin)+"m":"OFF")
            +" | LockProfit="+(g_lockProfitUSD>0?"$"+DoubleToString(g_lockProfitUSD,2)+"@"+IntegerToString(g_stallSecs)+"s":"OFF")
            +" | SyncTPSL="+(g_syncTPSL?"ON":"OFF")
            +" | ExitReverse="+(g_exitOnReverse?"ON":"OFF")
            +" | CashTP="+(g_quickTPUSD>0?"$"+DoubleToString(g_quickTPUSD,2):"OFF")
            +" | Trail="+(g_trailStartUSD>0?"start$"+DoubleToString(g_trailStartUSD,2)+" give$"+DoubleToString(g_trailGiveUSD,2):"OFF")
            +" | TrendReverse="+(g_trendReverse?"ON@"+IntegerToString(g_reverseAfterLosses):"OFF")
            +" | PartialTP="+(g_partialTP_R>0?DoubleToString(g_partialTP_R,1)+"Rx"+DoubleToString(g_partialTP_Frac*100,0)+"%":"OFF")
            +" -> lot/trade="+DoubleToString(CalcLot(),2));
      EALog("=======================================");
     }
   // heartbeat دائم - الـ Agent يعتمد على mtime هذا الملف لكشف أن البوت حي
   WriteCurrentSettings();
  }

//+------------------------------------------------------------------+
// نافذة الرول-أوفر اليومي 21:00–22:00 GMT - وقت صيد الستوبات (من سكِل XAUUSD)
bool InRolloverWindow()
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   return (dt.hour == 21);
  }

//+------------------------------------------------------------------+
bool InTradingHours()
  {
   if(g_tradeHoursStart == 0 && g_tradeHoursEnd >= 24) return true; // 24/7
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   if(g_tradeHoursStart < g_tradeHoursEnd)
      return (h >= g_tradeHoursStart && h < g_tradeHoursEnd);
   return (h >= g_tradeHoursStart || h < g_tradeHoursEnd); // overnight wrap
  }

//+------------------------------------------------------------------+
bool DayLimitHit()
  {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   datetime today = (datetime)(TimeCurrent() - dt.hour*3600 - dt.min*60 - dt.sec);
   if(today != g_today) { g_today = today; g_dayPL = 0.0; g_consecLosses = 0; }
   if(g_maxLossPerDay > 0.0   && g_dayPL <= -g_maxLossPerDay)   return true;
   if(g_maxProfitPerDay > 0.0 && g_dayPL >=  g_maxProfitPerDay) return true;
   return false;
  }

//+------------------------------------------------------------------+
bool InTradingSession()
  {
   return InTradingHours();
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI    = iRSI(_Symbol, TF,         14, PRICE_CLOSE);
   hEMA9   = iMA (_Symbol, TF,         9,  0, MODE_EMA, PRICE_CLOSE);
   hEMA21  = iMA (_Symbol, TF,         21, 0, MODE_EMA, PRICE_CLOSE);
   hATR    = iATR(_Symbol, TF,         14);
   hH1EMA  = iMA (_Symbol, PERIOD_H1,  21, 0, MODE_EMA, PRICE_CLOSE); // H1 bias
   hM15EMA = iMA (_Symbol, PERIOD_M15, 21, 0, MODE_EMA, PRICE_CLOSE); // M15 MTF bias
   hM5EMA9 = iMA (_Symbol, PERIOD_M5,  9,  0, MODE_EMA, PRICE_CLOSE); // M5 mid filter
   hM5EMA21= iMA (_Symbol, PERIOD_M5,  21, 0, MODE_EMA, PRICE_CLOSE); // M5 mid filter

   if(hRSI==INVALID_HANDLE||hEMA9==INVALID_HANDLE||
      hEMA21==INVALID_HANDLE||hATR==INVALID_HANDLE||hH1EMA==INVALID_HANDLE||
      hM15EMA==INVALID_HANDLE||
      hM5EMA9==INVALID_HANDLE||hM5EMA21==INVALID_HANDLE)
     { Print(EA_NAME,": indicator init failed"); return(INIT_FAILED); }

   LoadSettings();
   CreateDashboard();
   EventSetTimer(2);
   Print(EA_NAME," v",EA_VERSION," | Magic=",g_magic," | TF=",EnumToString(TF));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   LoadSettings();
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(hRSI   !=INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hEMA9  !=INVALID_HANDLE) IndicatorRelease(hEMA9);
   if(hEMA21 !=INVALID_HANDLE) IndicatorRelease(hEMA21);
   if(hATR   !=INVALID_HANDLE) IndicatorRelease(hATR);
   if(hH1EMA !=INVALID_HANDLE) IndicatorRelease(hH1EMA);
   if(hM15EMA!=INVALID_HANDLE) IndicatorRelease(hM15EMA);
   if(hM5EMA9 !=INVALID_HANDLE) IndicatorRelease(hM5EMA9);
   if(hM5EMA21!=INVALID_HANDLE) IndicatorRelease(hM5EMA21);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
int CountMyPositions()
  {
   int cnt = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==g_magic)
            cnt++;
   return cnt;
  }

//+------------------------------------------------------------------+
double MyFloatingPL()
  {
   double pl = 0.0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==g_magic)
            pl += posInfo.Profit() + posInfo.Swap();
   return pl;
  }

//+------------------------------------------------------------------+
//| Bull candle: minimal filter - closed up, not a doji, sane range  |
//+------------------------------------------------------------------+
bool StrongBull(double o, double c, double h, double l, double atr)
  {
   double range = h - l;
   if(range < 1e-10 || atr < 1e-10) return false;
   return (c > o)                      // closed up
       && ((c-o)/range >= 0.10)        // body >=10% of range (not a doji)
       && (range <= 5.0*atr);          // reject freak spike bars only
  }

//+------------------------------------------------------------------+
//| Bear candle: minimal filter - closed down, not a doji, sane range|
//+------------------------------------------------------------------+
bool StrongBear(double o, double c, double h, double l, double atr)
  {
   double range = h - l;
   if(range < 1e-10 || atr < 1e-10) return false;
   return (c < o)                      // closed down
       && ((o-c)/range >= 0.10)        // body >=10% of range (not a doji)
       && (range <= 5.0*atr);          // reject freak spike bars only
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   // ── ManagePositions runs EVERY TICK (TP/SL by P&L must be instant) ──
   ManagePositions();

   // ── BAR GATE: في HFT (cooldown < 30s) نشتغل بالـ tick بدل الـ bar ──
   bool hftMode = (g_cooldownSecs < 30);
   if(!hftMode)
     {
      datetime barTime = iTime(_Symbol, TF, 0);
      if(barTime == g_lastBar)
        {
         long sp = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
         UpdateDashboard(0, 50, InTradingSession(), 0, false, 0,
                         CountMyPositions(), 0, sp);
         return;
        }
      g_lastBar = barTime;
     }
   LoadSettings();

   double rsi[], ema9[], ema21[], atr[];
   double o[], h[], l[], c[];
   ArraySetAsSeries(rsi,true);  ArraySetAsSeries(ema9,true);
   ArraySetAsSeries(ema21,true); ArraySetAsSeries(atr,true);
   ArraySetAsSeries(o,true); ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true); ArraySetAsSeries(c,true);

   if(CopyBuffer(hRSI,  0,0,4,rsi)  <4) return;
   if(CopyBuffer(hEMA9, 0,0,4,ema9) <4) return;
   if(CopyBuffer(hEMA21,0,0,4,ema21)<4) return;
   if(CopyBuffer(hATR,  0,0,3,atr)  <3) return;
   if(CopyOpen (_Symbol,TF,0,4,o)<4)    return;
   if(CopyHigh (_Symbol,TF,0,4,h)<4)    return;
   if(CopyLow  (_Symbol,TF,0,4,l)<4)    return;
   if(CopyClose(_Symbol,TF,0,4,c)<4)    return;

   double rsi1 = rsi[1];
   double ema91= ema9[1], ema211= ema21[1];
   double atr1 = atr[1];

   // ── H1 BIAS: اتجاه رئيسي ─────────────────────────────────────────
   double h1ema[];
   ArraySetAsSeries(h1ema, true);
   bool h1BullBias = true;
   if(CopyBuffer(hH1EMA, 0, 0, 3, h1ema) >= 3)
      h1BullBias = (h1ema[1] >= h1ema[2]);

   // ── M15 BIAS: توافق التايمات (MTF - مؤكّد بالباك-تيست) ──────────
   double m15ema[];
   ArraySetAsSeries(m15ema, true);
   bool m15BullBias = true;
   if(CopyBuffer(hM15EMA, 0, 0, 3, m15ema) >= 3)
      m15BullBias = (m15ema[1] >= m15ema[2]);

   // ── M5 MID-TREND: اتجاه قريب (فلتر وسط) ─────────────────────────
   double m5e9[], m5e21[];
   ArraySetAsSeries(m5e9, true); ArraySetAsSeries(m5e21, true);
   bool m5BullBias = true; // fallback
   if(CopyBuffer(hM5EMA9,  0, 0, 3, m5e9)  >= 3 &&
      CopyBuffer(hM5EMA21, 0, 0, 3, m5e21) >= 3)
      m5BullBias = (m5e9[1] > m5e21[1]); // M5 EMA9 فوق EMA21 = اتجاه صعودي

   // ── CANDLE MOMENTUM M1: إشارة دخول دقيقة ────────────────────────
   bool bullBar = (c[1] > o[1]) && ((c[1]-o[1])/(h[1]-l[1]+1e-10) >= 0.25)
               && (h[1]-l[1]) <= 5.0*atr1;
   bool bearBar = (c[1] < o[1]) && ((o[1]-c[1])/(h[1]-l[1]+1e-10) >= 0.25)
               && (h[1]-l[1]) <= 5.0*atr1;

   // ── RSI FILTER (bypass in HFT mode) ──────────────────────────────
   bool rsiBuyOK  = hftMode || !g_useRSIFilter || (rsi1 <= g_rsiBuyMax);
   bool rsiSellOK = hftMode || !g_useRSIFilter || (rsi1 >= g_rsiSellMin);

   // ── SIGNAL: MTF (M15 + H1) + M1 ──────────────────────────────────
   int signal = 0;
   bool h1BuyOK  = !g_useH1Filter ||  h1BullBias;
   bool h1SellOK = !g_useH1Filter || !h1BullBias;
   bool m15BuyOK  = !g_useM15Filter ||  m15BullBias;
   bool m15SellOK = !g_useM15Filter || !m15BullBias;
   h1BuyOK  = h1BuyOK  && m15BuyOK;   // توافق التايمات: الاثنين لازم يوافقون
   h1SellOK = h1SellOK && m15SellOK;
   if(bullBar && rsiBuyOK  && h1BuyOK)  signal =  1;
   else if(bearBar && rsiSellOK && h1SellOK) signal = -1;

   // ── الانعكاس بتصويت الترند: بعد خسائر متتالية اتبع اتجاه الفريمات ──
   g_reverseActive = false; g_trendDir = 0;
   if(g_trendReverse && g_reverseAfterLosses > 0 && g_consecLosses >= g_reverseAfterLosses)
     {
      int bullVotes = (m5BullBias?1:0) + (m15BullBias?1:0) + (h1BullBias?1:0);
      g_reverseActive = true;
      if(bullVotes == 3)      g_trendDir =  1;   // كل الفريمات صعود
      else if(bullVotes == 0) g_trendDir = -1;   // كل الفريمات هبوط
      else                    g_trendDir =  0;   // مختلفة = رينج -> إيقاف
      // طبّق: مع الترند فقط، وإلا أوقف الدخول
      if(g_trendDir == 0) signal = 0;
      else if(signal != 0 && signal != g_trendDir) signal = 0; // لا تدخل ضد الترند
     }

   long spread   = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK = (spread <= (long)g_maxSpread);
   bool coolOK   = (TimeCurrent()-g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK  = (CountMyPositions() < g_maxPositions);
   bool sessOK   = InTradingHours();
   bool dayOK    = !DayLimitHit();
   bool newsOK   = !g_newsBlock;
   // ── فلاتر السكالبينج الجديدة ─────────────────────────────────────
   bool atrOK      = !g_useATRFilter  || ((atr1 / _Point) <= g_maxATRPoints);
   bool rolloverOK = !g_blockRollover || !InRolloverWindow();
   bool consecOK   = (g_maxConsecLosses <= 0) || (g_consecLosses < g_maxConsecLosses);
   bool allOK    = spreadOK && coolOK && slotsOK && sessOK && dayOK && newsOK && atr1 > 0.0
                   && atrOK && rolloverOK && consecOK;

   if(signal != 0 && allOK && g_botRunning && SymbolTradable())
     {
      g_snapRSI   = rsi1;
      g_snapEMAUp = (ema91 > ema211);
      g_snapATR   = atr1;
      int slots = g_maxPositions - CountMyPositions();
      if(slots > 0)
        {
         bool useGrid  = (g_strategyMode & 1) != 0;
         bool useHedge = (g_strategyMode & 2) != 0;
         if(useGrid)
            OpenGrid(signal, atr1);
         else if(useHedge)
            OpenHedge(signal, atr1);
         else
           {
            ENUM_ORDER_TYPE dir = (signal == 1) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
            if(g_orderType == 3)
               OpenBasket(dir, atr1, c[1], h[1], l[1], slots);
            else
               OpenTrade(dir, atr1, c[1], h[1], l[1]);
           }
        }
     }

   // ── سبب عدم فتح الصفقات (يُذكر مرة عند التغيّر + يُكتب للشريط) ─────
   string reason = "";
   if(!g_botRunning)                        reason = "Bot stopped (halt button)";
   else if(!spreadOK)                       reason = "Spread too high (>"+DoubleToString(g_maxSpread,0)+")";
   else if(!sessOK)                         reason = "Outside trading hours ("+IntegerToString(g_tradeHoursStart)+"-"+IntegerToString(g_tradeHoursEnd)+" GMT)";
   else if(!dayOK)                          reason = "Daily limit reached (profit/loss)";
   else if(!newsOK)                         reason = "News filter: "+g_newsTitle;
   else if(!rolloverOK)                     reason = "Rollover window (21-22 GMT)";
   else if(!consecOK)                       reason = "Halted: consecutive losses limit";
   else if(!slotsOK)                        reason = "Max positions reached";
   else if(!atrOK)                          reason = "ATR filter: volatility too high";
   else if(g_reverseActive && g_trendDir==0)reason = "Trend-Reverse: ranging (no trend)";
   else if(!coolOK)                         reason = "Cooldown between trades";
   else if(signal==0 && (bullBar||bearBar)) reason = "Signal rejected (H1/M15/RSI filter)";
   else if(signal==0)                       reason = "No momentum signal (waiting)";
   // reason=="" -> filters clear, trading
   if(reason != g_blockReason)
     {
      g_blockReason = reason;
      if(reason=="") EALog("Filters clear - bot is trading");
      else           EALog("No-entry reason: "+reason);
     }
   WriteStatus(reason=="" ? "OK|trading" : "BLOCK|"+reason);

   // SCALE - يعمل كل شمعة بغض النظر عن الإشارة
   if((g_strategyMode & 4) != 0 && g_botRunning && !DayLimitHit())
      CheckScale();

   int cdLeft = (int)MathMax(0, g_cooldownSecs-(TimeCurrent()-g_lastEntryTime));
   bool blocked = !(spreadOK && slotsOK && sessOK && dayOK);

   bool emaUp = ema91 > ema211;
   // نطبع سبب رفض الإشارة الحقيقي
   if(bullBar && signal == 0)
     {
      string why = "";
      if(!rsiBuyOK)            why = "RSI="+DoubleToString(rsi1,1)+" >"+DoubleToString(g_rsiBuyMax,1);
      else if(!h1BuyOK)        why = "H1=DN (filter ON)";
      else                     why = "unknown";
      Print(EA_NAME,": BUY skipped ",why);
     }
   if(bearBar && signal == 0)
     {
      string why = "";
      if(!rsiSellOK)           why = "RSI="+DoubleToString(rsi1,1)+" <"+DoubleToString(g_rsiSellMin,1);
      else if(!h1SellOK)       why = "H1=UP (filter ON)";
      else                     why = "unknown";
      Print(EA_NAME,": SELL skipped ",why);
     }

   UpdateDashboard(
      emaUp?1:-1, rsi1, sessOK, signal,
      blocked, cdLeft, CountMyPositions(), atr1, spread
   );
  }

//+------------------------------------------------------------------+
bool SymbolTradable()
  {
   long mode = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE);
   return (mode == SYMBOL_TRADE_MODE_FULL || mode == SYMBOL_TRADE_MODE_LONGONLY
           || mode == SYMBOL_TRADE_MODE_SHORTONLY);
  }

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
bool ScaledAlready(ulong ticket)
  {
   for(int i=0;i<g_scaledCount;i++) if(g_scaledFrom[i]==ticket) return true;
   return false;
  }

//+------------------------------------------------------------------+
// GRID: يفتح GridLevels أوردرات في اتجاه الإشارة بأسعار متدرجة
// يقرأ مستويات كلود من GSX_GridLevels.txt (صيغة: BUY:p,p\nSELL:p,p)
void ReadAIGridLevels()
  {
   g_aiBuyN = 0; g_aiSellN = 0;
   int fh = FileOpen("GSX_GridLevels.txt", FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(fh == INVALID_HANDLE) return;
   while(!FileIsEnding(fh))
     {
      string ln = FileReadString(fh);
      string pfx = ""; int arrSel = 0; // 1=buys 2=sells
      if(StringFind(ln,"BUY:")==0)  { pfx=StringSubstr(ln,4); arrSel=1; }
      else if(StringFind(ln,"SELL:")==0){ pfx=StringSubstr(ln,5); arrSel=2; }
      else continue;
      string parts[]; int cnt = StringSplit(pfx, ',', parts);
      for(int i=0;i<cnt;i++)
        {
         double v = StringToDouble(parts[i]);
         if(v <= 0) continue;
         if(arrSel==1 && g_aiBuyN<8)  g_aiBuys[g_aiBuyN++]   = v;
         if(arrSel==2 && g_aiSellN<8) g_aiSells[g_aiSellN++] = v;
        }
     }
   FileClose(fh);
  }

void OpenGrid(int signal, double atrVal)
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tickSz=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   int    digs=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long   sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long   frz=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*tickSz;
   double lot=CalcLot();
   double ptV=(tickSz>0&&lot>0)?(tickVal/tickSz)*lot:1.0;
   double safeMin=MathMax(minD,atrVal*1.5);
   double slD=MathMax(g_slUSD/ptV,safeMin);
   double tpD=MathMax(g_tpUSD/ptV,safeMin);
   double stepD=MathMax(g_gridStep*tickSz, minD*1.5); // خطوة لا تقل عن حد البروكر (وإلا تُرفض الأوردرات)
   datetime expiry=TimeCurrent()+PeriodSeconds(TF)*g_gridLevels*4;
   bool isBuy=(signal==1);
   int fired=0;

   // ── وضع كلود: أماكن الأوردرات من الشارت (دعم/مقاومة) بدل الخطوة الثابتة ──
   if(g_claudeGrid)
     {
      ReadAIGridLevels();
      // [0] دخول فوري بالماركت
      if(isBuy){double sl=NormalizeDouble(ask-slD,digs);double tp=NormalizeDouble(ask+tpD,digs);if(trade.Buy(lot,_Symbol,ask,sl,tp,"AIGRID[0]"))fired++;}
      else     {double sl=NormalizeDouble(bid+slD,digs);double tp=NormalizeDouble(bid-tpD,digs);if(trade.Sell(lot,_Symbol,bid,sl,tp,"AIGRID[0]"))fired++;}
      // أوردرات معلّقة عند مستويات كلود
      int cnt = isBuy ? g_aiBuyN : g_aiSellN;
      for(int i=0;i<cnt;i++)
        {
         if(CountMyPositions()+fired>=g_maxPositions) break;
         double e = isBuy ? g_aiBuys[i] : g_aiSells[i];
         if(isBuy  && e >= bid) continue;   // شراء لازم تحت السعر
         if(!isBuy && e <= ask) continue;   // بيع لازم فوق السعر
         e = NormalizeDouble(e,digs);
         if(isBuy){double sl=NormalizeDouble(e-slD,digs);double tp=NormalizeDouble(e+tpD,digs);if(trade.BuyLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"AIGRID"))fired++;}
         else     {double sl=NormalizeDouble(e+slD,digs);double tp=NormalizeDouble(e-tpD,digs);if(trade.SellLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"AIGRID"))fired++;}
        }
      // كمّل بخطوات ثابتة لين نوصل GridLevels (لو المطلوب أكثر من مستويات كلود)
      int extra = 1;
      while(fired < g_gridLevels && (CountMyPositions()+fired) < g_maxPositions && extra <= g_gridLevels)
        {
         double off = extra*stepD;
         bool ok2=false;
         if(isBuy){double e=NormalizeDouble(bid-off,digs);double sl=NormalizeDouble(e-slD,digs);double tp=NormalizeDouble(e+tpD,digs);ok2=trade.BuyLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"AIGRID+");}
         else     {double e=NormalizeDouble(ask+off,digs);double sl=NormalizeDouble(e+slD,digs);double tp=NormalizeDouble(e-tpD,digs);ok2=trade.SellLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"AIGRID+");}
         if(ok2) fired++;
         extra++;
        }
      if(fired>0){g_lastEntryTime=TimeCurrent(); g_totalTrades+=fired;
        EALog("AIGRID fired="+IntegerToString(fired)+" "+(isBuy?"BUY":"SELL")+" (Claude levels + fill)");}
      else EALog("AIGRID: no Claude levels yet - waiting");
      return;
     }

   for(int i=0;i<g_gridLevels;i++)
     {
      if(CountMyPositions()>=g_maxPositions) break;
      bool ok=false;
      if(i==0) // [0] market - دخول فوري
        {
         if(isBuy){double sl=NormalizeDouble(ask-slD,digs);double tp=NormalizeDouble(ask+tpD,digs);ok=trade.Buy(lot,_Symbol,ask,sl,tp,"GRID[0]");}
         else     {double sl=NormalizeDouble(bid+slD,digs);double tp=NormalizeDouble(bid-tpD,digs);ok=trade.Sell(lot,_Symbol,bid,sl,tp,"GRID[0]");}
        }
      else // [i] limit - ينتظر السعر الأفضل
        {
         double off=i*stepD;
         if(isBuy){double e=NormalizeDouble(bid-off,digs);double sl=NormalizeDouble(e-slD,digs);double tp=NormalizeDouble(e+tpD,digs);ok=trade.BuyLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"GRID["+IntegerToString(i)+"]");}
         else     {double e=NormalizeDouble(ask+off,digs);double sl=NormalizeDouble(e+slD,digs);double tp=NormalizeDouble(e-tpD,digs);ok=trade.SellLimit(lot,e,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,"GRID["+IntegerToString(i)+"]");}
        }
      if(ok){fired++;g_totalTrades++;}
     }
   if(fired>0){g_lastEntryTime=TimeCurrent();
     EALog("GRID fired="+IntegerToString(fired)+"/"+IntegerToString(g_gridLevels)+" "+(isBuy?"BUY":"SELL")+" step="+IntegerToString(g_gridStep)+"pts");}
  }

//+------------------------------------------------------------------+
// HEDGE: يفتح BUY + SELL في نفس الوقت - كل واحد يربح بروحه
void OpenHedge(int signal, double atrVal)
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tickSz=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   int    digs=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long   sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long   frz=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*tickSz;
   double mainLot=CalcLot();
   double hedgeLot=NormalizeLot(mainLot*g_hedgeLotMult);
   double safeMin=MathMax(minD,atrVal*1.5);
   bool isBuy=(signal==1);
   int fired=0;

   // الصفقة الرئيسية - اتجاه الإشارة
   double ptM=(tickSz>0&&mainLot>0)?(tickVal/tickSz)*mainLot:1.0;
   double slDM=MathMax(g_slUSD/ptM,safeMin); double tpDM=MathMax(g_tpUSD/ptM,safeMin);
   bool ok=false;
   if(isBuy){double sl=NormalizeDouble(ask-slDM,digs);double tp=NormalizeDouble(ask+tpDM,digs);ok=trade.Buy(mainLot,_Symbol,ask,sl,tp,"HEDGE_MAIN");}
   else     {double sl=NormalizeDouble(bid+slDM,digs);double tp=NormalizeDouble(bid-tpDM,digs);ok=trade.Sell(mainLot,_Symbol,bid,sl,tp,"HEDGE_MAIN");}
   if(ok){fired++;g_totalTrades++;}

   // الصفقة المقابلة - الهيدج
   if(CountMyPositions()<g_maxPositions)
     {
      double ptH=(tickSz>0&&hedgeLot>0)?(tickVal/tickSz)*hedgeLot:1.0;
      double slDH=MathMax(g_slUSD/ptH,safeMin); double tpDH=MathMax(g_tpUSD/ptH,safeMin);
      ok=false;
      if(!isBuy){double sl=NormalizeDouble(ask-slDH,digs);double tp=NormalizeDouble(ask+tpDH,digs);ok=trade.Buy(hedgeLot,_Symbol,ask,sl,tp,"HEDGE_OPP");}
      else      {double sl=NormalizeDouble(bid+slDH,digs);double tp=NormalizeDouble(bid-tpDH,digs);ok=trade.Sell(hedgeLot,_Symbol,bid,sl,tp,"HEDGE_OPP");}
      if(ok){fired++;g_totalTrades++;}
     }
   if(fired>0){g_lastEntryTime=TimeCurrent();
     EALog("HEDGE fired="+IntegerToString(fired)+" main="+DoubleToString(mainLot,2)+" opp="+DoubleToString(hedgeLot,2));}
  }

//+------------------------------------------------------------------+
// SCALE: يراقب الصفقات الخاسرة ويضاعف الدخول عند مستوى معين
void CheckScale()
  {
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double tickSz=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   int    digs=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   long   sl0=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long   frz=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minD=MathMax((double)(sl0+frz+5),10.0)*tickSz;

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      if(CountMyPositions()>=g_maxPositions) break;

      ulong tk=posInfo.Ticket();
      if(ScaledAlready(tk)) continue;

      double openP=posInfo.PriceOpen();
      double curP=(posInfo.PositionType()==POSITION_TYPE_BUY)?bid:ask;
      double lossPts=(posInfo.PositionType()==POSITION_TYPE_BUY)
                     ?(openP-curP)/tickSz:(curP-openP)/tickSz;
      if(lossPts<g_scaleStep) continue;

      double newLot=NormalizeLot(posInfo.Volume()*g_scaleMult);
      double ptN=(tickSz>0&&newLot>0)?(tickVal/tickSz)*newLot:1.0;
      double slD=MathMax(g_slUSD/ptN,MathMax(minD,10.0*tickSz));
      double tpD=MathMax(g_tpUSD/ptN,MathMax(minD,10.0*tickSz));
      bool ok=false;
      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {double sl=NormalizeDouble(ask-slD,digs);double tp=NormalizeDouble(ask+tpD,digs);ok=trade.Buy(newLot,_Symbol,ask,sl,tp,"SCALE");}
      else
        {double sl=NormalizeDouble(bid+slD,digs);double tp=NormalizeDouble(bid-tpD,digs);ok=trade.Sell(newLot,_Symbol,bid,sl,tp,"SCALE");}
      if(ok)
        {
         if(g_scaledCount<200) g_scaledFrom[g_scaledCount++]=tk;
         g_totalTrades++; g_lastEntryTime=TimeCurrent();
         EALog("SCALE #"+IntegerToString((int)tk)+" lot="+DoubleToString(newLot,2)+" loss="+DoubleToString(lossPts,0)+"pts");
        }
     }
  }

//+------------------------------------------------------------------+
// سلة أوردرات - كل إشارة تطلق 3 أوردرات دفعة واحدة:
//   [0] MARKET  -> دخول فوري
//   [1] STOP    -> يصطاد كسر الـ high/low
//   [2] LIMIT   -> يصطاد الرجوع للـ close
// إذا السوق ما يقبل STOP أو LIMIT يسقط ذلك الجزء بهدوء
//+------------------------------------------------------------------+
void OpenBasket(const ENUM_ORDER_TYPE dir, const double atrVal,
                const double c1, const double h1, const double l1,
                const int slots)
  {
   // نحسب SL/TP مرة واحدة لكل أوردرات السلة
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minD   = MathMax((double)(sl0+frz+5), 10.0) * tickSz;
   double lot    = CalcLot();

   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double pointVal = (tickSize > 0.0 && lot > 0.0) ? (tickVal / tickSize) * lot : 1.0;
   double safeMin  = MathMax(minD, atrVal * 1.5);
   double slD = MathMax(g_slUSD / pointVal, safeMin);
   double tpD = MathMax(g_tpUSD / pointVal, safeMin);

   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int hr = dt.hour;
   string sess = (hr>=7&&hr<13)?"London":(hr>=13&&hr<22)?"NY":(hr>=0&&hr<7)?"Tokyo":"Off";
   string snap = "RSI="  + DoubleToString(g_snapRSI,0)
               + " EMA=" + (g_snapEMAUp?"U":"D")
               + " ATR=" + DoubleToString(g_snapATR,1)
               + " S="   + sess;

   datetime expiry = TimeCurrent() + PeriodSeconds(TF) * 5;
   bool isBuy = (dir == ORDER_TYPE_BUY);
   int effectiveSlots = MathMin(slots, 2); // basket max 2 صفقات
   int  fired  = 0;

   // هل البروكر يقبل pending orders لهذا الرمز؟
   long execMode  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_EXEMODE);
   bool pendingOK = (execMode == SYMBOL_TRADE_EXECUTION_EXCHANGE ||
                     execMode == SYMBOL_TRADE_EXECUTION_MARKET);

   // ── [0] MARKET - فوري دائماً ────────────────────────────────────
   if(slots >= 1)
     {
      bool ok;
      if(isBuy)
        { double sl=NormalizeDouble(ask-slD,digs); double tp=NormalizeDouble(ask+tpD,digs);
          ok=trade.Buy(lot,_Symbol,ask,sl,tp,snap); }
      else
        { double sl=NormalizeDouble(bid+slD,digs); double tp=NormalizeDouble(bid-tpD,digs);
          ok=trade.Sell(lot,_Symbol,bid,sl,tp,snap); }
      if(ok) { fired++; g_totalTrades++;
               Print(EA_NAME,": BASKET[0] ",isBuy?"BUY":"SELL"," MARKET lot=",lot); }
      else    Print(EA_NAME,": BASKET[0] MARKET FAIL ",trade.ResultRetcode());
     }

   // ── [1] STOP - يصطاد الكسر فوق High / تحت Low ─────────────────
   if(effectiveSlots >= 2 && SymbolTradable() && pendingOK)
     {
      double buf = MathMax(tickSz * 5, minD);
      bool ok;
      if(isBuy)
        { double entry=NormalizeDouble(h1+buf,digs);
          if(entry<=ask) entry=NormalizeDouble(ask+buf,digs);
          double sl=NormalizeDouble(entry-slD,digs); double tp=NormalizeDouble(entry+tpD,digs);
          ok=trade.BuyStop(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
      else
        { double entry=NormalizeDouble(l1-buf,digs);
          if(entry>=bid) entry=NormalizeDouble(bid-buf,digs);
          double sl=NormalizeDouble(entry+slD,digs); double tp=NormalizeDouble(entry-tpD,digs);
          ok=trade.SellStop(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
      if(ok) { fired++; g_totalTrades++;
               Print(EA_NAME,": BASKET[1] ",isBuy?"BUY":"SELL"," STOP lot=",lot); }
      else    Print(EA_NAME,": BASKET[1] STOP SKIP (",trade.ResultRetcode(),")");
     }

   // ── [2] LIMIT - يصطاد الرجوع لـ close الشمعة ───────────────────
   if(false) // disabled - basket max 2
     {
      bool ok;
      if(isBuy)
        { double entry=NormalizeDouble(c1,digs);
          if(entry>=ask) entry=NormalizeDouble(ask-minD,digs);
          double sl=NormalizeDouble(entry-slD,digs); double tp=NormalizeDouble(entry+tpD,digs);
          ok=trade.BuyLimit(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
      else
        { double entry=NormalizeDouble(c1,digs);
          if(entry<=bid) entry=NormalizeDouble(bid+minD,digs);
          double sl=NormalizeDouble(entry+slD,digs); double tp=NormalizeDouble(entry-tpD,digs);
          ok=trade.SellLimit(lot,entry,_Symbol,sl,tp,ORDER_TIME_SPECIFIED,expiry,snap); }
      if(ok) { fired++; g_totalTrades++;
               Print(EA_NAME,": BASKET[2] ",isBuy?"BUY":"SELL"," LIMIT lot=",lot); }
      else    Print(EA_NAME,": BASKET[2] LIMIT SKIP (",trade.ResultRetcode(),")");
     }

   if(fired > 0)
     { g_lastEntryTime = TimeCurrent();
       EALog("BASKET fired="+IntegerToString(fired)+"/3 dir="+(isBuy?"BUY":"SELL")
             +" TP$="+DoubleToString(g_tpUSD,1)+" SL$="+DoubleToString(g_slUSD,1)); }
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal,
               const double c1, const double h1, const double l1)
  {
   double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double tickSz = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minD   = MathMax((double)(sl0+frz+5), 10.0) * tickSz;
   double lot    = CalcLot();

   // تحويل SL/TP من دولار لمسافة سعرية
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double pointVal = (tickSize > 0.0 && lot > 0.0) ? (tickVal / tickSize) * lot : 1.0;
   // الحد الأدنى: أكبر قيمة من (minD) أو (ATRx1.5) - يضمن قبول الـ broker لأي رمز
   double safeMin  = MathMax(minD, atrVal * 1.5);
   double slD = MathMax(g_slUSD / pointVal, safeMin);
   double tpD = MathMax(g_tpUSD / pointVal, safeMin);

   // snapshot comment
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int hr = dt.hour;
   string sess = (hr>=7&&hr<13)?"London":(hr>=13&&hr<22)?"NY":(hr>=0&&hr<7)?"Tokyo":"Off";
   string snap = "RSI="  + DoubleToString(g_snapRSI,0)
               + " EMA=" + (g_snapEMAUp?"U":"D")
               + " ATR=" + DoubleToString(g_snapATR,1)
               + " S="   + sess;

   // انتهاء صلاحية الأوردر المعلق - 5 شمعات
   datetime expiry = TimeCurrent() + PeriodSeconds(TF) * 5;

   double entry, sl, tp; bool ok = false;
   string modeTxt = "";

   if(g_orderType == 1) // ── LIMIT: ينتظر الرجوع لـ close الشمعة ─────────
     {
      entry = NormalizeDouble(c1, digs);
      if(type == ORDER_TYPE_BUY)
        {
         // BUY LIMIT: السعر تحت الحالي
         if(entry >= ask) entry = NormalizeDouble(ask - minD, digs);
         sl = NormalizeDouble(entry - slD, digs);
         tp = NormalizeDouble(entry + tpD, digs);
         ok = trade.BuyLimit(lot, entry, _Symbol, sl, tp, ORDER_TIME_SPECIFIED, expiry, snap);
         modeTxt = "BUY_LIMIT";
        }
      else
        {
         // SELL LIMIT: السعر فوق الحالي
         if(entry <= bid) entry = NormalizeDouble(bid + minD, digs);
         sl = NormalizeDouble(entry + slD, digs);
         tp = NormalizeDouble(entry - tpD, digs);
         ok = trade.SellLimit(lot, entry, _Symbol, sl, tp, ORDER_TIME_SPECIFIED, expiry, snap);
         modeTxt = "SELL_LIMIT";
        }
     }
   else if(g_orderType == 2) // ── STOP: يدخل عند كسر الـ high/low ──────────
     {
      double buf = MathMax(tickSz * 3, minD);
      if(type == ORDER_TYPE_BUY)
        {
         entry = NormalizeDouble(h1 + buf, digs);
         if(entry <= ask) entry = NormalizeDouble(ask + buf, digs);
         sl = NormalizeDouble(entry - slD, digs);
         tp = NormalizeDouble(entry + tpD, digs);
         ok = trade.BuyStop(lot, entry, _Symbol, sl, tp, ORDER_TIME_SPECIFIED, expiry, snap);
         modeTxt = "BUY_STOP";
        }
      else
        {
         entry = NormalizeDouble(l1 - buf, digs);
         if(entry >= bid) entry = NormalizeDouble(bid - buf, digs);
         sl = NormalizeDouble(entry + slD, digs);
         tp = NormalizeDouble(entry - tpD, digs);
         ok = trade.SellStop(lot, entry, _Symbol, sl, tp, ORDER_TIME_SPECIFIED, expiry, snap);
         modeTxt = "SELL_STOP";
        }
     }
   else // ── MARKET: فوري (الافتراضي) ──────────────────────────────────────
     {
      if(type == ORDER_TYPE_BUY)
        { sl=NormalizeDouble(ask-slD,digs); tp=NormalizeDouble(ask+tpD,digs);
          ok=trade.Buy(lot,_Symbol,ask,sl,tp,snap); modeTxt="BUY_MKT"; }
      else
        { sl=NormalizeDouble(bid+slD,digs); tp=NormalizeDouble(bid-tpD,digs);
          ok=trade.Sell(lot,_Symbol,bid,sl,tp,snap); modeTxt="SELL_MKT"; }
     }

   if(ok)
     { g_lastEntryTime = TimeCurrent(); g_totalTrades++;
       EALog(modeTxt+" lot="+DoubleToString(lot,2)+" TP$="+DoubleToString(g_tpUSD,1)+" SL$="+DoubleToString(g_slUSD,1)); }
   else
     {
      uint rc = trade.ResultRetcode();
      EALog("FAIL ["+modeTxt+"] "+IntegerToString(rc)+" "+trade.ResultComment());
      // fallback للـ MARKET إذا رفض الـ broker الـ pending order
      if(g_orderType != 0 && (rc==10044||rc==10018||rc==10019||rc==10034))
        {
         EALog("fallback -> MARKET");
         if(type==ORDER_TYPE_BUY)
           { double sl2=NormalizeDouble(ask-slD,digs); double tp2=NormalizeDouble(ask+tpD,digs);
             ok=trade.Buy(lot,_Symbol,ask,sl2,tp2,snap); }
         else
           { double sl2=NormalizeDouble(bid+slD,digs); double tp2=NormalizeDouble(bid-tpD,digs);
             ok=trade.Sell(lot,_Symbol,bid,sl2,tp2,snap); }
         if(ok) { g_lastEntryTime=TimeCurrent(); g_totalTrades++;
                  EALog("MARKET fallback OK"); }
         else    EALog("MARKET fallback FAIL "+IntegerToString(trade.ResultRetcode()));
        }
     }
  }

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(st>0.0) lot=MathFloor(lot/st)*st;
   return MathMax(mn,MathMin(mx,lot));
  }

//+------------------------------------------------------------------+
// سجلّ ذروة الربح لكل صفقة (لقفل الربح عند الركود)
int LkIdx(ulong tk)
  {
   for(int k=0;k<g_lkCount;k++) if(g_lkTk[k]==tk) return k;
   if(g_lkCount<256){ g_lkTk[g_lkCount]=tk; g_lkPeak[g_lkCount]=-1e9; g_lkTime[g_lkCount]=TimeCurrent(); g_lkTp1[g_lkCount]=false; return g_lkCount++; }
   return -1;
  }
void LkRemove(ulong tk)
  {
   for(int k=0;k<g_lkCount;k++) if(g_lkTk[k]==tk)
     { g_lkTk[k]=g_lkTk[g_lkCount-1]; g_lkPeak[k]=g_lkPeak[g_lkCount-1]; g_lkTime[k]=g_lkTime[g_lkCount-1]; g_lkTp1[k]=g_lkTp1[g_lkCount-1]; g_lkCount--; return; }
  }

void ManagePositions()
  {
   datetime now = TimeCurrent();

   // اتجاه الشمعة الحالية (لقص الخسارة عند الانعكاس)
   bool candleBull=false, candleBear=false;
   if(g_exitOnReverse)
     {
      double co[1], cc[1];
      if(CopyOpen(_Symbol,TF,0,1,co)==1 && CopyClose(_Symbol,TF,0,1,cc)==1)
        { candleBull = (cc[0] > co[0]); candleBear = (cc[0] < co[0]); }
     }

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      ulong    tk      = posInfo.Ticket();
      datetime openAt  = (datetime)posInfo.Time();
      double   profit  = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
      int      ageSeconds = (int)(now - openAt);
      double   posLot  = posInfo.Volume();
      double   effTP   = g_tpUSD;
      double   effSL   = g_slUSD;

      // الوضع الآلي: TP/SL ديناميكية من ATR اللحظة (تكبر وتصغر مع التقلب)
      if(g_autoTPSL)
        {
         double atrP   = CurrentATRprice();
         double vpl    = ValuePerPricePerLot();
         double slDist = AUTO_SL_ATR * atrP;
         if(atrP > 0.0 && vpl > 0.0 && slDist > 0.0)
           {
            effSL = slDist * vpl * posLot;
            effTP = effSL * AUTO_TP_RR;
           }
        }

      // Breakeven: إذا الربح وصل 1.5x SL -> نقل الـ SL لنقطة التعادل
      if(profit >= effSL * 1.5)
        {
         double openPrice = posInfo.PriceOpen();
         double bePrice;
         // نضيف buffer صغير (نص الـ spread) لضمان ربح بسيط عند الإغلاق
         double halfSpread = (SymbolInfoDouble(_Symbol,SYMBOL_ASK) - SymbolInfoDouble(_Symbol,SYMBOL_BID)) * 0.5;
         int    digs       = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
         if(posInfo.PositionType() == POSITION_TYPE_BUY)
            bePrice = NormalizeDouble(openPrice + halfSpread, digs);
         else
            bePrice = NormalizeDouble(openPrice - halfSpread, digs);
         double curSL = posInfo.StopLoss();
         // فقط إذا الـ SL الحالي أسوأ من نقطة التعادل
         bool needMove = (posInfo.PositionType()==POSITION_TYPE_BUY  && curSL < bePrice) ||
                         (posInfo.PositionType()==POSITION_TYPE_SELL && (curSL > bePrice || curSL==0));
         if(needMove)
           {
            if(trade.PositionModify(tk, bePrice, posInfo.TakeProfit()))
               EALog("BE moved #"+IntegerToString((int)tk)+" - profit=$"+DoubleToString(profit,2));
           }
        }

      // مزامنة TP/SL الحقيقية على الصفقة (تظهر في MT5 وتتحدّث مع الإعدادات/ATR)
      if(g_syncTPSL)
        {
         double vpl = ValuePerPricePerLot();
         if(vpl > 0.0 && posLot > 0.0)
           {
            bool   isBuy = (posInfo.PositionType()==POSITION_TYPE_BUY);
            double openP = posInfo.PriceOpen();
            int    digs  = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
            double slD   = effSL / (posLot * vpl);
            double tpD   = effTP / (posLot * vpl);
            double rawSL = isBuy ? openP - slD : openP + slD;
            double newTP = NormalizeDouble(isBuy ? openP + tpD : openP - tpD, digs);
            double curSL = posInfo.StopLoss(), curTP = posInfo.TakeProfit();
            double newSL = rawSL;
            if(curSL > 0.0) newSL = isBuy ? MathMax(curSL, rawSL) : MathMin(curSL, rawSL); // لا يُرخّي الستوب
            newSL = NormalizeDouble(newSL, digs);
            if(MathAbs(curSL-newSL) > _Point || MathAbs(curTP-newTP) > _Point)
               trade.PositionModify(tk, newSL, newTP);
           }
        }

      // تتبّع ذروة الربح (للتريلينج + قفل الركود)
      if(g_trailStartUSD > 0.0 || g_lockProfitUSD > 0.0)
        {
         int li = LkIdx(tk);
         if(li >= 0)
           {
            if(profit > g_lkPeak[li]) { g_lkPeak[li] = profit; g_lkTime[li] = now; } // ذروة جديدة

            // ستوب متحرّك حقيقي: بعد ربح TrailStart، حرّك الـ SL ليقفل (الذروة − Give)
            // يعطي الصفقة مساحة ثم يتبع الربح؛ يظهر على الشارت والبروكر يسكّر عند لمسه
            if(g_trailStartUSD > 0.0 && g_lkPeak[li] >= g_trailStartUSD)
              {
               double tvpl = ValuePerPricePerLot();
               if(tvpl > 0.0 && posLot > 0.0)
                 {
                  double lockUSD = g_lkPeak[li] - g_trailGiveUSD;      // الربح المراد قفله
                  double dist    = lockUSD / (posLot * tvpl);          // مسافة سعرية من الدخول
                  bool   isBuyT  = (posInfo.PositionType()==POSITION_TYPE_BUY);
                  double openPT  = posInfo.PriceOpen();
                  int    digsT   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
                  double newSLT  = NormalizeDouble(isBuyT ? openPT + dist : openPT - dist, digsT);
                  double curSLT  = posInfo.StopLoss();
                  bool   tighten = isBuyT ? (newSLT > curSLT) : (curSLT==0.0 || newSLT < curSLT);
                  if(tighten) trade.PositionModify(tk, newSLT, posInfo.TakeProfit());
                 }
              }

            // قفل الربح عند الركود: بربح ووقف يتقدّم مدة -> احجز
            if(g_lockProfitUSD > 0.0 && profit >= g_lockProfitUSD && (int)(now - g_lkTime[li]) >= g_stallSecs)
              { trade.PositionClose(tk);
                EALog("LOCK #"+IntegerToString((int)tk)+" +$"+DoubleToString(profit,2)+" (profit stalled "+IntegerToString((int)(now-g_lkTime[li]))+"s)");
                LkRemove(tk); continue; }
           }
        }

      // انعكاس الترند: سكّر الصفقات اللي ضد اتجاه التصويت (بعد الخسائر المتتالية)
      if(g_reverseActive && g_trendDir != 0)
        {
         int posDir = (posInfo.PositionType()==POSITION_TYPE_BUY) ? 1 : -1;
         if(posDir != g_trendDir)
           { trade.PositionClose(tk); LkRemove(tk);
             EALog("REVERSE closed counter-trend #"+IntegerToString((int)tk)+" $"+DoubleToString(profit,2)); continue; }
        }

      // هدف نقدي ثابت: يسكّر الصفقة كاملة عند ربح $ محدد (أبسط طريقة للربح البسيط)
      if(g_quickTPUSD > 0.0 && profit >= g_quickTPUSD)
        { trade.PositionClose(tk); LkRemove(tk);
          EALog("CASH TP #"+IntegerToString((int)tk)+" +$"+DoubleToString(profit,2)+" (cash target $"+DoubleToString(g_quickTPUSD,2)+")"); continue; }

      // جني جزئي: عند ربح = Rx الستوب، closed جزءاً واحجز الباقي على التعادل
      if(g_partialTP_R > 0.0 && profit >= g_partialTP_R * effSL)
        {
         int li = LkIdx(tk);
         if(li >= 0 && !g_lkTp1[li])
           {
            double minV = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
            double closeVol = NormalizeLot(posLot * g_partialTP_Frac);
            bool canSplit = (g_partialTP_Frac < 0.999) && (closeVol >= minV) && ((posLot - closeVol) >= minV);
            if(canSplit)
              {
               if(trade.PositionClosePartial(tk, closeVol))
                 {
                  g_lkTp1[li] = true;
                  double be = posInfo.PriceOpen();       // انقل الباقي للتعادل (بلا مخاطرة)
                  trade.PositionModify(tk, be, posInfo.TakeProfit());
                  EALog("PARTIAL #"+IntegerToString((int)tk)+" closed "+DoubleToString(closeVol,2)+" +$"+DoubleToString(profit,2)+" -> rest to breakeven");
                 }
              }
            else
              {
               // لوت صغير ما ينقسم (أو نسبة كاملة) -> closed الصفقة كاملة عند الربح المبكر
               trade.PositionClose(tk); LkRemove(tk);
               EALog("QUICK TP #"+IntegerToString((int)tk)+" +$"+DoubleToString(profit,2)+" (early TP at "+DoubleToString(g_partialTP_R,1)+"R)"); continue;
              }
           }
        }

      // TP: check immediately
      if(profit >= effTP)
        { trade.PositionClose(tk); LkRemove(tk);
          EALog("TP #"+IntegerToString((int)tk)+" +$"+DoubleToString(profit,2)+" (target $"+DoubleToString(effTP,2)+") age="+IntegerToString(ageSeconds)+"s"); continue; }

      // SL: wait 60s first (spread cost needs time to recover)
      if(ageSeconds >= 60 && profit <= -effSL)
        { trade.PositionClose(tk); LkRemove(tk);
          EALog("SL #"+IntegerToString((int)tk)+" $"+DoubleToString(profit,2)+" (limit $"+DoubleToString(effSL,2)+") age="+IntegerToString(ageSeconds)+"s"); continue; }

      // خروج بالوقت (اختياري، معطّل افتراضياً)
      if(g_maxHoldMin > 0 && ageSeconds >= g_maxHoldMin*60)
        { trade.PositionClose(tk); LkRemove(tk);
          EALog("TIME #"+IntegerToString((int)tk)+" "+(profit>=0?"+":"")+"$"+DoubleToString(profit,2)+" (limit "+IntegerToString(g_maxHoldMin)+"m)"); continue; }

      // قص الخسارة عند انعكاس الشمعة - فقط لو الخسارة حقيقية (≥40% من الستوب)
      // حتى لا يخنق الصفقات الجديدة عند ضجيج الشموع
      if(g_exitOnReverse && profit <= -0.40*effSL && ageSeconds >= 30)
        {
         bool isBuy = (posInfo.PositionType()==POSITION_TYPE_BUY);
         if((isBuy && candleBear) || (!isBuy && candleBull))
           { trade.PositionClose(tk); LkRemove(tk);
             EALog("REVERSE cut #"+IntegerToString((int)tk)+" $"+DoubleToString(profit,2)+" (loss+reverse)"); continue; }
        }
     }
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &req,
                        const MqlTradeResult &res)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong dealTicket = trans.deal;
   if(dealTicket == 0) return;
   if(!HistoryDealSelect(dealTicket)) return;
   if(HistoryDealGetInteger(dealTicket, DEAL_MAGIC) != g_magic) return;
   if(HistoryDealGetInteger(dealTicket, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   double profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   double swap       = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
   double commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   double net        = profit + swap + commission;
   g_dayPL += net;

   // ── سبب الإغلاق لكل صفقة ─────────────────────────────────────────
   long   reason = HistoryDealGetInteger(dealTicket, DEAL_REASON);
   long   posTk  = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   string why;
   switch((int)reason)
     {
      case DEAL_REASON_TP:       why="Take Profit (broker)";        break;
      case DEAL_REASON_SL:       why="Stop Loss (broker)";          break;
      case DEAL_REASON_SO:       why="Stop Out (margin call)";          break;
      case DEAL_REASON_EXPERT:   why="Bot rule (see line above)";   break;
      case DEAL_REASON_CLIENT:
      case DEAL_REASON_MOBILE:
      case DEAL_REASON_WEB:      why="Manual close";                break;
      case DEAL_REASON_ROLLOVER: why="Rollover";                     break;
      default:                   why="reason #"+IntegerToString((int)reason);
     }
   EALog("= CLOSE #"+IntegerToString((int)posTk)+" | reason: "+why+" | net "+(net>=0?"+":"")+"$"+DoubleToString(net,2)+" =");

   // عدّاد الخسائر المتتالية - يوقف فتح صفقات جديدة عند بلوغ الحد
   if(net < 0.0)      g_consecLosses++;
   else if(net > 0.0) g_consecLosses = 0;
   if(g_maxConsecLosses > 0 && g_consecLosses == g_maxConsecLosses)
      EALog("Session halted: "+IntegerToString(g_consecLosses)+" consecutive losses (limit "+IntegerToString(g_maxConsecLosses)+")");
  }

//+------------------------------------------------------------------+
//| Dashboard                                                        |
//+------------------------------------------------------------------+
void DLabel(const string id,const string txt,const int x,const int y,
            const color clr,const int fs=9)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,nm,OBJPROP_CORNER,    CORNER_LEFT_UPPER);
      ObjectSetInteger(0,nm,OBJPROP_BACK,      false);
      ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,nm,OBJPROP_HIDDEN,    true);
      ObjectSetInteger(0,nm,OBJPROP_ZORDER,    1);
      ObjectSetString (0,nm,OBJPROP_FONT,      "Consolas");
     }
   ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,nm,OBJPROP_COLOR,clr);
   ObjectSetInteger(0,nm,OBJPROP_FONTSIZE,fs);
   ObjectSetString (0,nm,OBJPROP_TEXT,txt);
  }

void DDivider(const string id,const int y)
  {
   string nm=DASH_PREFIX+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_RECTANGLE_LABEL,0,0,0);
      ObjectSetInteger(0,nm,OBJPROP_CORNER,     CORNER_LEFT_UPPER);
      ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,  PANEL_X+PAD);
      ObjectSetInteger(0,nm,OBJPROP_XSIZE,      PANEL_W-2*PAD);
      ObjectSetInteger(0,nm,OBJPROP_YSIZE,      1);
      ObjectSetInteger(0,nm,OBJPROP_BGCOLOR,    CLR_DIVIDER);
      ObjectSetInteger(0,nm,OBJPROP_BORDER_TYPE,BORDER_FLAT);
      ObjectSetInteger(0,nm,OBJPROP_COLOR,      CLR_DIVIDER);
      ObjectSetInteger(0,nm,OBJPROP_BACK,       false);
      ObjectSetInteger(0,nm,OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0,nm,OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0,nm,OBJPROP_ZORDER,     1);
     }
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
  }

//+------------------------------------------------------------------+
void CreateDashboard()
  {
   int panelH=PAD+TITLE_H+5*8+17*ROW_H+PAD;
   string bg=DASH_PREFIX+"BG";
   if(ObjectFind(0,bg)<0)
      ObjectCreate(0,bg,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,bg,OBJPROP_CORNER,     CORNER_LEFT_UPPER);
   ObjectSetInteger(0,bg,OBJPROP_XDISTANCE,  PANEL_X);
   ObjectSetInteger(0,bg,OBJPROP_YDISTANCE,  PANEL_Y);
   ObjectSetInteger(0,bg,OBJPROP_XSIZE,      PANEL_W);
   ObjectSetInteger(0,bg,OBJPROP_YSIZE,      panelH);
   ObjectSetInteger(0,bg,OBJPROP_BGCOLOR,    CLR_BG);
   ObjectSetInteger(0,bg,OBJPROP_BORDER_TYPE,BORDER_FLAT);
   ObjectSetInteger(0,bg,OBJPROP_COLOR,      CLR_BORDER);
   ObjectSetInteger(0,bg,OBJPROP_WIDTH,      1);
   ObjectSetInteger(0,bg,OBJPROP_BACK,       false);
   ObjectSetInteger(0,bg,OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0,bg,OBJPROP_HIDDEN,     true);
   ObjectSetInteger(0,bg,OBJPROP_ZORDER,     0);

   int xK=PANEL_X+PAD; int y=PANEL_Y+PAD;
   DLabel("TITLE",EA_NAME+" v"+EA_VERSION+"  "+_Symbol,xK,y,clrGold,10);
   y+=TITLE_H; DDivider("D0",y); y+=8;

   DLabel("K_MAGIC", "Magic",    xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TREND", "Trend",    xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_RSI",   "RSI(7)",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D1",y); y+=8;

   DLabel("K_SESS",  "Hours",    xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SIG",   "Signal",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ENTRY", "Entry",    xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D2",y); y+=8;

   DLabel("K_POS",   "Positions",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_PNL",   "Float P&L",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DAYPNL","Day P&L",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TRADES","Trades",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D3",y); y+=8;

   DLabel("K_LOT",   "Lot",      xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TPSL",  "TP$/SL$",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DLOSS", "MaxLoss$", xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DPROF", "MaxProfit$",xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D4",y); y+=8;

   DLabel("K_SPREAD","Spread",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ATR",   "ATR(14)",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ORDTYP","OrderType",xK,y,CLR_KEY);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void UpdateDashboard(const int trend,const double rsi,
                     const bool sessOK,const int signal,
                     const bool blocked,const int cdSec,
                     const int posCount,const double atrVal,
                     const long spreadPts)
  {
   int xV=PANEL_X+140; int y=PANEL_Y+PAD+TITLE_H+8;

   DLabel("V_MAGIC",(string)g_magic,xV,y,CLR_HILITE); y+=ROW_H;

   string tTxt=trend>0?"UP ▲":trend<0?"DOWN ▼":"FLAT";
   color  tClr=trend>0?CLR_GOOD:trend<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_TREND",tTxt,xV,y,tClr); y+=ROW_H;

   color rClr=rsi>=70?CLR_BAD:rsi<=30?CLR_GOOD:CLR_NEUTRAL;
   DLabel("V_RSI",DoubleToString(rsi,1),xV,y,rClr); y+=ROW_H+8;

   bool dayHit = DayLimitHit();
   string sessStr = dayHit ? "DAY LIMIT" : (sessOK ? "ACTIVE" : "CLOSED");
   color  sessClr = dayHit ? CLR_BAD : (sessOK ? CLR_GOOD : CLR_BAD);
   DLabel("V_SESS",sessStr,xV,y,sessClr); y+=ROW_H;

   string sTxt=signal>0?"BUY ▲":signal<0?"SELL ▼":"NONE";
   color  sClr=signal>0?CLR_GOOD:signal<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_SIG",sTxt,xV,y,sClr); y+=ROW_H;

   string eTxt; color eClr;
   if(blocked)    {eTxt="BLOCKED";              eClr=CLR_BAD;}
   else if(cdSec>0){eTxt="CD "+string(cdSec)+"s";eClr=clrOrange;}
   else           {eTxt="READY";                eClr=CLR_GOOD;}
   DLabel("V_ENTRY",eTxt,xV,y,eClr); y+=ROW_H+8;

   color pClr=posCount>=g_maxPositions?CLR_BAD:CLR_HILITE;
   DLabel("V_POS",string(posCount)+" / "+string(g_maxPositions),xV,y,pClr); y+=ROW_H;

   double pl=MyFloatingPL();
   color  plClr=pl>0?CLR_GOOD:pl<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_PNL",(pl>=0?"+":"")+DoubleToString(pl,2),xV,y,plClr); y+=ROW_H;

   color dpClr=g_dayPL>0?CLR_GOOD:g_dayPL<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_DAYPNL",(g_dayPL>=0?"+":"")+DoubleToString(g_dayPL,2),xV,y,dpClr); y+=ROW_H;

   DLabel("V_TRADES",string(g_totalTrades),xV,y,CLR_NEUTRAL); y+=ROW_H+8;

   DLabel("V_LOT",DoubleToString(g_lot,2),xV,y,CLR_HILITE); y+=ROW_H;
   string tpslTxt = "$"+DoubleToString(g_tpUSD,2)+" / $"+DoubleToString(g_slUSD,2);
   DLabel("V_TPSL",tpslTxt,xV,y,CLR_HILITE); y+=ROW_H;

   bool lossLimitNear = (g_dayPL <= -g_maxLossPerDay*0.8);
   DLabel("V_DLOSS","$"+DoubleToString(g_maxLossPerDay,2),xV,y,lossLimitNear?CLR_BAD:CLR_NEUTRAL); y+=ROW_H;

   bool profLimitNear = (g_maxProfitPerDay>0 && g_dayPL >= g_maxProfitPerDay*0.8);
   DLabel("V_DPROF","$"+DoubleToString(g_maxProfitPerDay,2),xV,y,profLimitNear?CLR_GOOD:CLR_NEUTRAL); y+=ROW_H+8;

   color spClr=spreadPts>(long)g_maxSpread?CLR_BAD:spreadPts>200?clrOrange:CLR_NEUTRAL;
   DLabel("V_SPREAD",string(spreadPts)+" pts",xV,y,spClr); y+=ROW_H;

   DLabel("V_ATR",DoubleToString(atrVal,_Digits),xV,y,CLR_HILITE); y+=ROW_H;
   string otTxt = g_orderType==3?"BASKET":g_orderType==1?"LIMIT":g_orderType==2?"STOP":"MARKET";
   color  otClr = g_orderType==3?clrGold:g_orderType==1?clrDodgerBlue:g_orderType==2?clrOrange:CLR_GOOD;
   DLabel("V_ORDTYP",otTxt,xV,y,otClr); y+=ROW_H;
   string newsTxt = g_newsBlock ? ("NEWS: "+g_newsTitle) : "NO NEWS";
   color  newsClr = g_newsBlock ? CLR_BAD : CLR_NEUTRAL;
   DLabel("V_NEWS",newsTxt,xV,y,newsClr); y+=ROW_H;

   // H1 bias indicator
   double h1e[];
   ArraySetAsSeries(h1e,true);
   string h1Txt = "H1: --";
   color  h1Clr = CLR_NEUTRAL;
   if(!g_useH1Filter)
     { h1Txt = "H1 FILTER: OFF"; h1Clr = clrOrange; }
   else if(CopyBuffer(hH1EMA,0,0,3,h1e)>=3)
     {
      bool up = h1e[1]>=h1e[2];
      h1Txt = up ? "H1 BIAS: UP BUY" : "H1 BIAS: DN SELL";
      h1Clr = up ? CLR_GOOD : CLR_BAD;
     }
   DLabel("V_H1BIAS",h1Txt,xV,y,h1Clr); y+=ROW_H;

   // Strategy mode indicator
   string stratTxt = "STRAT: NORMAL";
   color  stratClr = CLR_NEUTRAL;
   if(g_strategyMode > 0)
     {
      stratTxt = "STRAT:";
      if((g_strategyMode & 1) != 0) stratTxt += " GRID";
      if((g_strategyMode & 2) != 0) stratTxt += " HEDGE";
      if((g_strategyMode & 4) != 0) stratTxt += " SCALE";
      stratClr = clrGold;
     }
   DLabel("V_STRAT",stratTxt,xV,y,stratClr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
