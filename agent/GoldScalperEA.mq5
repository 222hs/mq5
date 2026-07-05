//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 9.81 |
//|  Gold scalper — كل شمعة صاعدة BUY، كل شمعة هابطة SELL          |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "9.81"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;      // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1;// Working timeframe
input int             MaxPositions = 5;        // Max open positions
input int             CooldownSecs = 0;        // Cooldown between entries (sec)
input int             MaxSpread    = 350;      // Max spread in points
input bool            UseSession   = false;    // Session filter (false=trade 24h)

//--- constants
#define EA_NAME       "GoldScalperX"
#define EA_VERSION    "9.81"
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
bool     g_botRunning    = true;
int      g_direction     = 0;    // 0=free, 1=BUY only, -1=SELL only
double   g_maxLossPerDay = 50.0;
double   g_maxProfitPerDay = 200.0;
int      g_tradeHoursStart = 0;
int      g_tradeHoursEnd   = 23;

// daily limits tracking
string   g_today          = "";
double   g_dayStartBalance = 0.0;

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
void LoadSettings()
  {
   g_lot          = ReadJsonValue("LotSize",      LotSize);
   g_maxSpread    = ReadJsonValue("MaxSpread",    (double)MaxSpread);
   g_maxPositions = (int)ReadJsonValue("MaxPositions",(double)MaxPositions);
   g_cooldownSecs = (int)ReadJsonValue("CooldownSecs",(double)CooldownSecs);
   g_tpUSD        = ReadJsonValue("TP_USD",       4.0);
   g_slUSD        = ReadJsonValue("SL_USD",       2.0);
   g_botRunning      = (ReadJsonValue("BotRunning",     1.0) > 0.5);
   g_direction       = (int)ReadJsonValue("Direction",      0.0);
   g_maxLossPerDay   = ReadJsonValue("MaxLossPerDay",   50.0);
   g_maxProfitPerDay = ReadJsonValue("MaxProfitPerDay", 200.0);
   g_tradeHoursStart = (int)ReadJsonValue("TradeHoursStart", 0.0);
   g_tradeHoursEnd   = (int)ReadJsonValue("TradeHoursEnd",  23.0);

   // كتابة الإعدادات الفعلية للـ Agent
   string tmp = "GSX_Active.tmp";
   int fh = FileOpen(tmp, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(fh != INVALID_HANDLE)
     {
      string js = "{";
      js += "\"LotSize\":"          + DoubleToString(g_lot,2)          + ",";
      js += "\"TP_USD\":"           + DoubleToString(g_tpUSD,2)        + ",";
      js += "\"SL_USD\":"           + DoubleToString(g_slUSD,2)        + ",";
      js += "\"MaxSpread\":"        + IntegerToString((int)g_maxSpread) + ",";
      js += "\"MaxPositions\":"     + IntegerToString(g_maxPositions)   + ",";
      js += "\"CooldownSecs\":"     + IntegerToString(g_cooldownSecs)   + ",";
      js += "\"BotRunning\":"       + (g_botRunning?"1":"0")            + ",";
      js += "\"Direction\":"        + IntegerToString(g_direction)      + ",";
      js += "\"MaxLossPerDay\":"    + DoubleToString(g_maxLossPerDay,2) + ",";
      js += "\"MaxProfitPerDay\":"  + DoubleToString(g_maxProfitPerDay,2) + ",";
      js += "\"TradeHoursStart\":"  + IntegerToString(g_tradeHoursStart) + ",";
      js += "\"TradeHoursEnd\":"    + IntegerToString(g_tradeHoursEnd)   + "}";
      FileWriteString(fh, js);
      FileClose(fh);
      FileMove(tmp, FILE_COMMON, "GSX_Active.json", FILE_COMMON|FILE_REWRITE);
     }
  }

//+------------------------------------------------------------------+
bool InTradingSession()
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   if(UseSession && g_tradeHoursStart == 0 && g_tradeHoursEnd == 23) return true; // legacy: UseSession=false means 24h
   return (h >= g_tradeHoursStart && h <= g_tradeHoursEnd);
  }

bool DailyLimitHit()
  {
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   string todayStr = StringFormat("%04d-%02d-%02d", dt.year, dt.mon, dt.day);
   if(g_today != todayStr)
     {
      g_today = todayStr;
      g_dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
     }
   double dayPnL = AccountInfoDouble(ACCOUNT_BALANCE) - g_dayStartBalance;
   if(dayPnL <= -g_maxLossPerDay)  return true;
   if(dayPnL >= g_maxProfitPerDay) return true;
   return false;
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
void OnTick()
  {
   ManagePositions();

   datetime barTime = iTime(_Symbol, TF, 0);
   if(barTime == g_lastBar)
     {
      long sp = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      UpdateDashboard(0, 50, InTradingSession(), 0, false, 0,
                      CountMyPositions(), 0, sp);
      return;
     }
   g_lastBar = barTime;
   LoadSettings();

   double rsi[], ema9[], ema21[], atr[];
   double o[], c[];
   ArraySetAsSeries(rsi,true); ArraySetAsSeries(ema9,true);
   ArraySetAsSeries(ema21,true); ArraySetAsSeries(atr,true);
   ArraySetAsSeries(o,true); ArraySetAsSeries(c,true);

   if(CopyBuffer(hRSI,  0,0,2,rsi)  <2) return;
   if(CopyBuffer(hEMA9, 0,0,2,ema9) <2) return;
   if(CopyBuffer(hEMA21,0,0,2,ema21)<2) return;
   if(CopyBuffer(hATR,  0,0,2,atr)  <2) return;
   if(CopyOpen (_Symbol,TF,0,2,o)   <2) return;
   if(CopyClose(_Symbol,TF,0,2,c)   <2) return;

   double rsi1  = rsi[1];
   double ema91 = ema9[1], ema211 = ema21[1];
   double atr1  = atr[1];

   // ── SIGNAL: اتجاه الشمعة الأخيرة المغلقة ──
   int signal = 0;
   if     (c[1] > o[1]) signal =  1;  // شمعة صاعدة → BUY
   else if(c[1] < o[1]) signal = -1;  // شمعة هابطة → SELL

   // Direction filter
   if(g_direction ==  1 && signal == -1) signal = 0;  // BUY only
   if(g_direction == -1 && signal ==  1) signal = 0;  // SELL only

   long spread   = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   bool spreadOK = (spread <= (long)g_maxSpread);
   bool coolOK   = (TimeCurrent()-g_lastEntryTime >= g_cooldownSecs);
   bool slotsOK  = (CountMyPositions() < g_maxPositions);
   bool sessOK   = InTradingSession();
   bool limitOK  = !DailyLimitHit();
   bool allOK    = spreadOK && coolOK && slotsOK && sessOK && limitOK && atr1 > 0.0;

   if(signal != 0 && allOK && g_botRunning)
     {
      if(signal == 1) OpenTrade(ORDER_TYPE_BUY,  atr1);
      else            OpenTrade(ORDER_TYPE_SELL, atr1);
     }

   int cdLeft  = (int)MathMax(0, g_cooldownSecs-(TimeCurrent()-g_lastEntryTime));
   bool blocked = !(spreadOK && slotsOK && sessOK && limitOK);
   bool emaUp   = ema91 > ema211;
   UpdateDashboard(emaUp?1:-1, rsi1, sessOK, signal,
                   blocked, cdLeft, CountMyPositions(), atr1, spread);
  }

//+------------------------------------------------------------------+
void OpenTrade(const ENUM_ORDER_TYPE type, const double atrVal)
  {
   double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double pt   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digs = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   sl0  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minD = MathMax((double)(sl0+frz+5), 10.0) * pt;
   double lot  = NormalizeLot(g_lot);

   double slD = MathMax(atrVal * 2.0, minD);
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
                   " | TP$=",g_tpUSD," SL$=",g_slUSD); }
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
void ManagePositions()
  {
   datetime now = TimeCurrent();
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      ulong    tk         = posInfo.Ticket();
      datetime openAt     = (datetime)posInfo.Time();
      double   profit     = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
      int      ageSeconds = (int)(now - openAt);

      // TP: يُسكّر فوراً عند الهدف
      if(profit >= g_tpUSD)
        { trade.PositionClose(tk);
          Print(EA_NAME,": TP $",DoubleToString(profit,2)); continue; }

      // SL طوارئ: خسارة فادحة تُسكّر فوراً بدون انتظار
      if(profit <= -(g_slUSD * 2.5))
        { trade.PositionClose(tk);
          Print(EA_NAME,": EMERG SL $",DoubleToString(profit,2)); continue; }

      // SL عادي: بعد 3 دقائق
      if(ageSeconds >= 180 && profit <= -g_slUSD)
        { trade.PositionClose(tk);
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
   DLabel("K_TP",    "TP Target",xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SL",    "SL Target",xK,y,CLR_KEY);
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
   if(blocked)     {eTxt="BLOCKED";               eClr=CLR_BAD;}
   else if(cdSec>0){eTxt="CD "+string(cdSec)+"s"; eClr=clrOrange;}
   else            {eTxt="READY";                  eClr=CLR_GOOD;}
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
