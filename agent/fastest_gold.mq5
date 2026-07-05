//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 9.02 |
//|  Gold scalper — bar-gated, closed-bar signals, smart filters     |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "9.12"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;      // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1;// Working timeframe
input int             MaxPositions = 10;       // Max open positions
input int             CooldownSecs = 0;        // Cooldown between entries (sec)
input int             MaxSpread    = 350;      // Max spread in points
input bool            UseSession   = false;    // Session filter (false=trade 24h)

//--- constants
#define EA_NAME       "GoldScalperX"
#define EA_VERSION    "9.12"
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
         hEMA21 = INVALID_HANDLE, hATR = INVALID_HANDLE;
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
double   g_tpUSD        = 3.0;
double   g_slUSD        = 2.0;
double   g_maxLossPerDay   = 50.0;
double   g_maxProfitPerDay = 200.0;
int      g_tradeHoursStart = 0;
int      g_tradeHoursEnd   = 24;
int      g_orderType       = 0;   // 0=MARKET  1=LIMIT  2=STOP

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
   // كل إعداد في ملف نصي منفصل — سطر واحد فقط يحتوي الرقم
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
   // يكتب الإعدادات الفعلية الشغّالة حالياً → الـ Agent يقرأها ويرفعها للداشبورد
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
   j += "  \"OrderType\": "     + IntegerToString(g_orderType)       + "\n";
   j += "}";
   FileWriteString(fh, j);
   FileClose(fh);
  }

string g_lastSettingsHash = "";

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

   // نطبع فقط لما تتغير الإعدادات
   string hash = DoubleToString(lot,2)+DoubleToString(tp,2)+DoubleToString(sl,2)
               + IntegerToString(maxPos)+DoubleToString(spread,0)
               + IntegerToString(hStart)+IntegerToString(hEnd)
               + IntegerToString(ordTyp)+(botOn ? "1" : "0");
   bool changed = (hash != g_lastSettingsHash);
   g_lastSettingsHash = hash;

   g_lot=lot; g_maxSpread=spread; g_maxPositions=maxPos; g_cooldownSecs=cd;
   g_tpUSD=tp; g_slUSD=sl; g_maxLossPerDay=maxL; g_maxProfitPerDay=maxP;
   g_tradeHoursStart=hStart; g_tradeHoursEnd=hEnd; g_botRunning=botOn;
   g_orderType=ordTyp;

   if(changed)
     {
      string otStr = g_orderType==1?"LIMIT":g_orderType==2?"STOP":"MARKET";
      Print(EA_NAME," ✅ إعدادات محملة:"
            " Lot=",g_lot," TP$=",g_tpUSD," SL$=",g_slUSD,
            " MaxPos=",g_maxPositions," Spread=",g_maxSpread,
            " Hours=",g_tradeHoursStart,"-",g_tradeHoursEnd,
            " Bot=",g_botRunning?"ON":"OFF",
            " Order=",otStr);
      WriteCurrentSettings();
     }
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
   if(today != g_today) { g_today = today; g_dayPL = 0.0; }
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

   hRSI   = iRSI(_Symbol, TF, 7,  PRICE_CLOSE);
   hEMA9  = iMA (_Symbol, TF, 9,  0, MODE_EMA, PRICE_CLOSE);
   hEMA21 = iMA (_Symbol, TF, 21, 0, MODE_EMA, PRICE_CLOSE);
   hATR   = iATR(_Symbol, TF, 14);

   if(hRSI==INVALID_HANDLE||hEMA9==INVALID_HANDLE||
      hEMA21==INVALID_HANDLE||hATR==INVALID_HANDLE)
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
   if(hRSI  !=INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hEMA9 !=INVALID_HANDLE) IndicatorRelease(hEMA9);
   if(hEMA21!=INVALID_HANDLE) IndicatorRelease(hEMA21);
   if(hATR  !=INVALID_HANDLE) IndicatorRelease(hATR);
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
//| Bull candle: minimal filter — closed up, not a doji, sane range  |
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
//| Bear candle: minimal filter — closed down, not a doji, sane range|
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

   // ── BAR GATE: entry signals only once per completed bar ──
   datetime barTime = iTime(_Symbol, TF, 0);
   if(barTime == g_lastBar)
     {
      // still update dashboard every tick so values stay fresh
      long sp = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      UpdateDashboard(0, 50, InTradingSession(), 0, false, 0,
                      CountMyPositions(), 0, sp);
      return;
     }
   g_lastBar = barTime;
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

   // ── CANDLE MOMENTUM: follow the last closed candle direction ──
   bool bullBar = (c[1] > o[1]) && ((c[1]-o[1])/(h[1]-l[1]+1e-10) >= 0.25)
               && (h[1]-l[1]) <= 5.0*atr1;
   bool bearBar = (c[1] < o[1]) && ((o[1]-c[1])/(h[1]-l[1]+1e-10) >= 0.25)
               && (h[1]-l[1]) <= 5.0*atr1;

   int signal = 0;
   if(bullBar) signal =  1; // BUY — candle closed up
   else if(bearBar) signal = -1; // SELL — candle closed down

   long spread   = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK = (spread <= (long)g_maxSpread);
   bool coolOK   = (TimeCurrent()-g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK  = (CountMyPositions() < g_maxPositions);
   bool sessOK   = InTradingHours();
   bool dayOK    = !DayLimitHit();
   bool allOK    = spreadOK && coolOK && slotsOK && sessOK && dayOK && atr1 > 0.0;

   if(signal != 0 && allOK && g_botRunning && SymbolTradable())
     {
      // حفظ snapshot الإشارات لإرسالها مع الصفقة
      g_snapRSI   = rsi1;
      g_snapEMAUp = (ema91 > ema211);
      g_snapATR   = atr1;
      int slots = g_maxPositions - CountMyPositions();
      for(int i = 0; i < slots; i++)
        {
         if(signal == 1) OpenTrade(ORDER_TYPE_BUY,  atr1, c[1], h[1], l[1]);
         else            OpenTrade(ORDER_TYPE_SELL, atr1, c[1], h[1], l[1]);
        }
     }

   int cdLeft = (int)MathMax(0, g_cooldownSecs-(TimeCurrent()-g_lastEntryTime));
   bool blocked = !(spreadOK && slotsOK && sessOK && dayOK);

   bool emaUp = ema91 > ema211;
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
   double lot    = NormalizeLot(g_lot);

   // تحويل SL/TP من دولار لمسافة سعرية
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double pointVal = (tickSize > 0.0 && lot > 0.0) ? (tickVal / tickSize) * lot : 1.0;
   double slD = MathMax(g_slUSD / pointVal, minD);
   double tpD = MathMax(g_tpUSD / pointVal, minD);

   // snapshot comment
   MqlDateTime dt; TimeToStruct(TimeGMT(), dt);
   int hr = dt.hour;
   string sess = (hr>=7&&hr<13)?"London":(hr>=13&&hr<22)?"NY":(hr>=0&&hr<7)?"Tokyo":"Off";
   string snap = "RSI="  + DoubleToString(g_snapRSI,0)
               + " EMA=" + (g_snapEMAUp?"U":"D")
               + " ATR=" + DoubleToString(g_snapATR,1)
               + " S="   + sess;

   // انتهاء صلاحية الأوردر المعلق — 5 شمعات
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
       Print(EA_NAME,": ",modeTxt," lot=",lot," TP$=",g_tpUSD," SL$=",g_slUSD); }
   else
     {
      uint rc = trade.ResultRetcode();
      Print(EA_NAME,": FAIL [",modeTxt,"] ",rc," ",trade.ResultComment());
      // fallback للـ MARKET إذا رفض الـ broker الـ pending order
      if(g_orderType != 0 && (rc==10044||rc==10018||rc==10019||rc==10034))
        {
         Print(EA_NAME,": fallback → MARKET");
         if(type==ORDER_TYPE_BUY)
           { double sl2=NormalizeDouble(ask-slD,digs); double tp2=NormalizeDouble(ask+tpD,digs);
             ok=trade.Buy(lot,_Symbol,ask,sl2,tp2,snap); }
         else
           { double sl2=NormalizeDouble(bid+slD,digs); double tp2=NormalizeDouble(bid-tpD,digs);
             ok=trade.Sell(lot,_Symbol,bid,sl2,tp2,snap); }
         if(ok) { g_lastEntryTime=TimeCurrent(); g_totalTrades++;
                  Print(EA_NAME,": MARKET fallback OK"); }
         else    Print(EA_NAME,": MARKET fallback FAIL ",trade.ResultRetcode());
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
void ManagePositions()
  {
   datetime now = TimeCurrent();
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      ulong    tk      = posInfo.Ticket();
      datetime openAt  = (datetime)posInfo.Time();
      double   profit  = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
      int      ageSeconds = (int)(now - openAt);

      // TP: check immediately
      if(profit >= g_tpUSD)
        { trade.PositionClose(tk);
          Print(EA_NAME,": TP $",DoubleToString(profit,2)," age=",ageSeconds,"s"); continue; }

      // SL: wait 60s first (spread cost needs time to recover)
      if(ageSeconds >= 60 && profit <= -g_slUSD)
        { trade.PositionClose(tk);
          Print(EA_NAME,": SL $",DoubleToString(profit,2)," age=",ageSeconds,"s"); continue; }
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
   g_dayPL += profit + swap + commission;
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
   DLabel("V_TPSL","$"+DoubleToString(g_tpUSD,2)+" / $"+DoubleToString(g_slUSD,2),xV,y,CLR_HILITE); y+=ROW_H;

   bool lossLimitNear = (g_dayPL <= -g_maxLossPerDay*0.8);
   DLabel("V_DLOSS","$"+DoubleToString(g_maxLossPerDay,2),xV,y,lossLimitNear?CLR_BAD:CLR_NEUTRAL); y+=ROW_H;

   bool profLimitNear = (g_maxProfitPerDay>0 && g_dayPL >= g_maxProfitPerDay*0.8);
   DLabel("V_DPROF","$"+DoubleToString(g_maxProfitPerDay,2),xV,y,profLimitNear?CLR_GOOD:CLR_NEUTRAL); y+=ROW_H+8;

   color spClr=spreadPts>(long)g_maxSpread?CLR_BAD:spreadPts>200?clrOrange:CLR_NEUTRAL;
   DLabel("V_SPREAD",string(spreadPts)+" pts",xV,y,spClr); y+=ROW_H;

   DLabel("V_ATR",DoubleToString(atrVal,_Digits),xV,y,CLR_HILITE); y+=ROW_H;
   string otTxt = g_orderType==1?"LIMIT":g_orderType==2?"STOP":"MARKET";
   color  otClr = g_orderType==1?clrDodgerBlue:g_orderType==2?clrOrange:CLR_GOOD;
   DLabel("V_ORDTYP",otTxt,xV,y,otClr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
