//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 9.22 |
//|  Gold scalper — bar-gated, closed-bar signals, trailing stop     |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "9.22"
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
#define EA_VERSION    "9.22"
#define DASH_PREFIX   "GSX_D_"
#define SETTINGS_FILE "GSX_Settings.json"

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
int      g_totalTrades   = 0;

double   g_lot;
int      g_maxPositions;
int      g_cooldownSecs;
double   g_maxSpread;
double   g_tpUSD;
double   g_slUSD;
double   g_trailUSD;   // trail drawdown from peak once TP is reached (0=disabled)

//--- trailing stop tracker
struct TrailData { ulong ticket; double peak; bool armed; };
TrailData g_trail[20];
int       g_trailCount = 0;

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
double ReadJsonValue(const string key, const double fallback)
  {
   int fh = FileOpen(SETTINGS_FILE, FILE_READ|FILE_TXT|FILE_COMMON);
   if(fh == INVALID_HANDLE) return fallback;
   string content = "";
   while(!FileIsEnding(fh))
      content += FileReadString(fh);
   FileClose(fh);
   string search = "\"" + key + "\"";
   int pos = StringFind(content, search);
   if(pos < 0) return fallback;
   pos += StringLen(search);
   while(pos < StringLen(content) && (StringGetCharacter(content,pos)==' ' ||
         StringGetCharacter(content,pos)==':' || StringGetCharacter(content,pos)=='\t'))
      pos++;
   string num = "";
   while(pos < StringLen(content))
     {
      ushort c = StringGetCharacter(content, pos);
      if(c=='-'||c=='.'||(c>='0'&&c<='9')) { num+=ShortToString(c); pos++; }
      else break;
     }
   return StringLen(num)==0 ? fallback : StringToDouble(num);
  }

//+------------------------------------------------------------------+
bool     g_botRunning = true;

void LoadSettings()
  {
   g_lot          = ReadJsonValue("LotSize",      LotSize);
   g_maxSpread    = ReadJsonValue("MaxSpread",    (double)MaxSpread);
   g_maxPositions = (int)ReadJsonValue("MaxPositions",(double)MaxPositions);
   g_cooldownSecs = (int)ReadJsonValue("CooldownSecs",(double)CooldownSecs);
   g_tpUSD        = ReadJsonValue("TP_USD",       5.0);
   g_slUSD        = ReadJsonValue("SL_USD",       2.5);
   g_trailUSD     = ReadJsonValue("TrailUSD",     1.0);
   g_botRunning   = (ReadJsonValue("BotRunning",  1.0) > 0.5);

   // كتابة الإعدادات الفعلية في ملف مؤقت ثم rename (atomic — يتجنب تعارض القراءة)
   string js = "{";
   js += "\"LotSize\":"      + DoubleToString(g_lot,2)         + ",";
   js += "\"TP_USD\":"       + DoubleToString(g_tpUSD,2)       + ",";
   js += "\"SL_USD\":"       + DoubleToString(g_slUSD,2)       + ",";
   js += "\"MaxSpread\":"    + IntegerToString((int)g_maxSpread)+ ",";
   js += "\"MaxPositions\":" + IntegerToString(g_maxPositions)  + ",";
   js += "\"CooldownSecs\":" + IntegerToString(g_cooldownSecs)  + ",";
   js += "\"TrailUSD\":"     + DoubleToString(g_trailUSD,2)     + ",";
   js += "\"BotRunning\":"   + (g_botRunning?"1":"0")           + "}";
   int fh = FileOpen("GSX_Active.tmp", FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(fh != INVALID_HANDLE)
     {
      FileWriteString(fh, js);
      FileClose(fh);
      // rename المؤقت → الأساسي (عملية واحدة — لا يُقرأ ملف ناقص)
      FileMove("GSX_Active.tmp", FILE_COMMON, "GSX_Active.json", FILE_COMMON|FILE_REWRITE);
     }
  }

//+------------------------------------------------------------------+
bool InTradingSession()
  {
   if(!UseSession) return true;
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   return (h >= 12 && h < 20); // London/NY overlap — best gold hours
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
   Print(EA_NAME," v",EA_VERSION," | Magic=",g_magic," | TF=",EnumToString(TF));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
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

   // ── CANDLE MOMENTUM: 2-bar confirmation (bar[1] + bar[2] same direction) ──
   double range1 = h[1]-l[1]+1e-10, range2 = h[2]-l[2]+1e-10;
   bool bull1 = (c[1]>o[1]) && ((c[1]-o[1])/range1 >= 0.25) && range1 <= 5.0*atr1;
   bool bull2 = (c[2]>o[2]) && ((c[2]-o[2])/range2 >= 0.20);
   bool bear1 = (c[1]<o[1]) && ((o[1]-c[1])/range1 >= 0.25) && range1 <= 5.0*atr1;
   bool bear2 = (c[2]<o[2]) && ((o[2]-c[2])/range2 >= 0.20);

   // RSI directional filter — avoid trading against extreme RSI
   // BUY only when RSI not overbought; SELL only when RSI not oversold
   bool rsiBuyOK  = (rsi1 < 68.0);
   bool rsiSellOK = (rsi1 > 32.0);

   int signal = 0;
   if(bull1 && bull2 && rsiBuyOK)  signal =  1;
   else if(bear1 && bear2 && rsiSellOK) signal = -1;

   long spread   = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK = (spread <= (long)g_maxSpread);
   bool coolOK   = (TimeCurrent()-g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK  = (CountMyPositions() < g_maxPositions);
   bool sessOK   = InTradingSession();
   bool allOK    = spreadOK && coolOK && slotsOK && sessOK && atr1 > 0.0;

   if(signal != 0 && allOK && g_botRunning)
     {
      // Max 2 trades per bar — keeps slots available for the opposite direction
      int slots = MathMin(2, g_maxPositions - CountMyPositions());
      for(int i = 0; i < slots; i++)
        {
         if(signal == 1) OpenTrade(ORDER_TYPE_BUY,  atr1);
         else            OpenTrade(ORDER_TYPE_SELL, atr1);
        }
     }

   int cdLeft = (int)MathMax(0, g_cooldownSecs-(TimeCurrent()-g_lastEntryTime));
   bool blocked = !(spreadOK && slotsOK && sessOK);

   bool emaUp = ema91 > ema211;
   UpdateDashboard(
      emaUp?1:-1, rsi1, sessOK, signal,
      blocked, cdLeft, CountMyPositions(), atr1, spread
   );
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal)
  {
   double ask   = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid   = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double pt    = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digs  = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0   = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz   = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minD  = MathMax((double)(sl0+frz+5), 10.0) * pt;
   double lot   = NormalizeLot(g_lot);

   // ATR-based distances — safety net on broker side (tighter SL = smaller max loss)
   double slD = MathMax(atrVal * 1.0, minD);
   double tpD = MathMax(atrVal * 4.0, minD * 2.0);

   double sl, tp; bool ok;
   if(type == ORDER_TYPE_BUY)
     { sl = NormalizeDouble(ask - slD, digs); tp = NormalizeDouble(ask + tpD, digs);
       ok = trade.Buy(lot, _Symbol, ask, sl, tp, EA_NAME); }
   else
     { sl = NormalizeDouble(bid + slD, digs); tp = NormalizeDouble(bid - tpD, digs);
       ok = trade.Sell(lot, _Symbol, bid, sl, tp, EA_NAME); }

   if(ok) { g_lastEntryTime = TimeCurrent(); g_totalTrades++;
             Print(EA_NAME,": ",EnumToString(type)," lot=",lot,
                   " sl=",sl," tp=",tp," | close target: TP$=",g_tpUSD," SL$=",g_slUSD); }
   else   Print(EA_NAME,": FAIL ",trade.ResultRetcode()," ",trade.ResultComment());
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
int FindTrail(ulong tk)
  {
   for(int i=0;i<g_trailCount;i++) if(g_trail[i].ticket==tk) return i;
   return -1;
  }
int AddTrail(ulong tk)
  {
   if(g_trailCount>=20) return -1;
   g_trail[g_trailCount].ticket=tk; g_trail[g_trailCount].peak=-999999; g_trail[g_trailCount].armed=false;
   return g_trailCount++;
  }
void RemoveTrail(ulong tk)
  {
   for(int i=0;i<g_trailCount;i++)
     if(g_trail[i].ticket==tk) { g_trail[i]=g_trail[--g_trailCount]; return; }
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

      // trailing stop tracker
      int ti = FindTrail(tk);
      if(ti < 0) ti = AddTrail(tk);
      if(ti >= 0)
        {
         if(profit > g_trail[ti].peak) g_trail[ti].peak = profit;
         if(!g_trail[ti].armed && g_trail[ti].peak >= g_tpUSD) g_trail[ti].armed = true;
        }

      // TP with trailing: once armed, close only when profit drops TrailUSD from peak
      if(ti >= 0 && g_trail[ti].armed && g_trailUSD > 0)
        {
         if(profit <= g_trail[ti].peak - g_trailUSD)
           { trade.PositionClose(tk); RemoveTrail(tk);
             Print(EA_NAME,": TRAIL $",DoubleToString(profit,2),
                   " peak=$",DoubleToString(g_trail[ti].peak,2)); continue; }
        }
      else if(profit >= g_tpUSD && (g_trailUSD <= 0 || ti < 0 || !g_trail[ti].armed))
        {
         if(g_trailUSD <= 0)
           { trade.PositionClose(tk); if(ti>=0) RemoveTrail(tk);
             Print(EA_NAME,": TP $",DoubleToString(profit,2)); continue; }
        }

      // Emergency SL: if loss exceeds 2x SL_USD close IMMEDIATELY (no grace period)
      // This caps catastrophic loss from fast moves in the first 60s
      if(profit <= -(g_slUSD * 2.0))
        { trade.PositionClose(tk); if(ti>=0) RemoveTrail(tk);
          Print(EA_NAME,": EMERG SL $",DoubleToString(profit,2)," age=",ageSeconds,"s"); continue; }

      // Normal SL: wait 30s first (spread cost recovery), then close at SL_USD
      if(ageSeconds >= 30 && profit <= -g_slUSD)
        { trade.PositionClose(tk); if(ti>=0) RemoveTrail(tk);
          Print(EA_NAME,": SL $",DoubleToString(profit,2)," age=",ageSeconds,"s"); continue; }
     }
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
   int panelH=PAD+TITLE_H+4*8+13*ROW_H+PAD;
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

   DLabel("K_SESS",  "Session",  xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SIG",   "Signal",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ENTRY", "Entry",    xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D2",y); y+=8;

   DLabel("K_POS",   "Positions",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_PNL",   "Float P&L",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TRADES","Trades",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D3",y); y+=8;

   DLabel("K_SPREAD","Spread",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ATR",   "ATR(14)",  xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D4",y); y+=8;
   DLabel("K_TP",    "TP Target", xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SL",    "SL Target", xK,y,CLR_KEY);
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

   DLabel("V_SESS",sessOK?"ACTIVE":"CLOSED",xV,y,sessOK?CLR_GOOD:CLR_BAD); y+=ROW_H;

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

   DLabel("V_TRADES",string(g_totalTrades),xV,y,CLR_NEUTRAL); y+=ROW_H+8;

   color spClr=spreadPts>(long)g_maxSpread?CLR_BAD:spreadPts>200?clrOrange:CLR_NEUTRAL;
   DLabel("V_SPREAD",string(spreadPts)+" pts",xV,y,spClr); y+=ROW_H;

   DLabel("V_ATR",DoubleToString(atrVal,_Digits),xV,y,CLR_HILITE); y+=ROW_H+8;

   DLabel("V_TP","$"+DoubleToString(g_tpUSD,2),xV,y,CLR_GOOD); y+=ROW_H;
   DLabel("V_SL","$"+DoubleToString(g_slUSD,2),xV,y,CLR_BAD);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
