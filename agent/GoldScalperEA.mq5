//+------------------------------------------------------------------+
//|                                                GoldScalperEA.mq5 |
//|                                        GoldScalperX version 10.0 |
//|  OCO Pending Orders — Buy/Sell Stop + Limit على كل شمعة M1      |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "10.0"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>

//--- inputs
input double          LotSize      = 0.5;      // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1;// Working timeframe
input int             MaxPositions = 5;        // Max open positions
input int             MaxSpread    = 350;      // Max spread in points
input int             PendingExpireCandles = 2;// إلغاء الأوردر بعد كم شمعة

//--- constants
#define EA_NAME       "GoldScalperX"
#define EA_VERSION    "10.0"
#define DASH_PREFIX   "GSX_D_"
#define SETTINGS_FILE "GSX_Settings.json"

//--- panel layout
#define PANEL_X   10
#define PANEL_Y   10
#define PANEL_W   290
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
COrderInfo     ordInfo;

long     g_magic         = 0;
int      hRSI = INVALID_HANDLE, hATR = INVALID_HANDLE;
datetime g_lastBar       = 0;
int      g_totalTrades   = 0;

//--- settings (loaded from JSON)
double   g_lot;
int      g_maxPositions;
double   g_maxSpread;
double   g_tpUSD;
double   g_slUSD;
bool     g_botRunning      = true;
int      g_direction       = 0;
double   g_maxLossPerDay   = 50.0;
double   g_maxProfitPerDay = 200.0;
int      g_tradeHoursStart = 0;
int      g_tradeHoursEnd   = 23;

//--- daily limit tracking
string   g_today           = "";
double   g_dayStartBalance = 0.0;

//--- OCO pending order tracking
ulong    g_stopTicket      = 0;   // Buy/Sell Stop ticket
ulong    g_limitTicket     = 0;   // Buy/Sell Limit ticket
int      g_pendingSignal   = 0;   // اتجاه الأوردرات المعلقة
datetime g_pendingBarTime  = 0;   // وقت الشمعة اللي وضعنا فيها الأوردرات
int      g_barsElapsed     = 0;   // عدد الشمعات منذ وضع الأوردرات

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
   g_lot             = ReadJsonValue("LotSize",       LotSize);
   g_maxSpread       = ReadJsonValue("MaxSpread",     (double)MaxSpread);
   g_maxPositions    = (int)ReadJsonValue("MaxPositions", (double)MaxPositions);
   g_tpUSD           = ReadJsonValue("TP_USD",        4.0);
   g_slUSD           = ReadJsonValue("SL_USD",        2.0);
   g_botRunning      = (ReadJsonValue("BotRunning",   1.0) > 0.5);
   g_direction       = (int)ReadJsonValue("Direction",     0.0);
   g_maxLossPerDay   = ReadJsonValue("MaxLossPerDay",  50.0);
   g_maxProfitPerDay = ReadJsonValue("MaxProfitPerDay",200.0);
   g_tradeHoursStart = (int)ReadJsonValue("TradeHoursStart", 0.0);
   g_tradeHoursEnd   = (int)ReadJsonValue("TradeHoursEnd",  23.0);
  }

//+------------------------------------------------------------------+
// تحويل دولارات إلى مسافة سعرية
double USDtoPrice(double usd)
  {
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickVal <= 0 || tickSize <= 0) return usd * 0.01;
   double perPoint = (tickVal / tickSize) * g_lot;
   return (perPoint > 0) ? usd / perPoint : usd * 0.01;
  }

//+------------------------------------------------------------------+
bool InTradingSession()
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   return (h >= g_tradeHoursStart && h <= g_tradeHoursEnd);
  }

//+------------------------------------------------------------------+
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
   return (dayPnL <= -g_maxLossPerDay || dayPnL >= g_maxProfitPerDay);
  }

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double st = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(st > 0.0) lot = MathFloor(lot/st)*st;
   return MathMax(mn, MathMin(mx, lot));
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
int CountMyOrders()
  {
   int cnt = 0;
   for(int i = OrdersTotal()-1; i >= 0; i--)
      if(ordInfo.SelectByIndex(i))
         if(ordInfo.Symbol()==_Symbol && ordInfo.Magic()==g_magic)
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
bool OrderExists(ulong ticket)
  {
   if(ticket == 0) return false;
   for(int i = OrdersTotal()-1; i >= 0; i--)
      if(ordInfo.SelectByIndex(i))
         if(ordInfo.Ticket() == ticket) return true;
   return false;
  }

//+------------------------------------------------------------------+
void CancelPendingOrders()
  {
   if(OrderExists(g_stopTicket))
     { trade.OrderDelete(g_stopTicket); }
   if(OrderExists(g_limitTicket))
     { trade.OrderDelete(g_limitTicket); }
   g_stopTicket    = 0;
   g_limitTicket   = 0;
   g_pendingSignal = 0;
   g_pendingBarTime= 0;
   g_barsElapsed   = 0;
  }

//+------------------------------------------------------------------+
// OCO: لما أحد الأوردرين يُفعّل، يُلغى الآخر
void CheckOCO()
  {
   bool stopExists  = OrderExists(g_stopTicket);
   bool limitExists = OrderExists(g_limitTicket);

   // لو الـ Stop اشتغل والـ Limit لا زال → ألغِ الـ Limit
   if(!stopExists && g_stopTicket != 0 && limitExists)
     {
      trade.OrderDelete(g_limitTicket);
      g_limitTicket  = 0;
      g_stopTicket   = 0;
      g_pendingSignal= 0;
      return;
     }

   // لو الـ Limit اشتغل والـ Stop لا زال → ألغِ الـ Stop
   if(!limitExists && g_limitTicket != 0 && stopExists)
     {
      trade.OrderDelete(g_stopTicket);
      g_stopTicket   = 0;
      g_limitTicket  = 0;
      g_pendingSignal= 0;
      return;
     }

   // لو كلاهم اختفوا (تم تفعيلهما أو ألغيا)
   if(!stopExists && !limitExists && (g_stopTicket != 0 || g_limitTicket != 0))
     {
      g_stopTicket   = 0;
      g_limitTicket  = 0;
      g_pendingSignal= 0;
      g_pendingBarTime = 0;
      g_barsElapsed  = 0;
     }
  }

//+------------------------------------------------------------------+
void PlacePendingOCO(int signal, double high1, double low1, double atr1)
  {
   int    digs   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double pt     = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   long   sl0    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   frz    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minDist= MathMax((double)(sl0+frz+5), 10.0) * pt;
   long   spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   double lot    = NormalizeLot(g_lot);

   double tpDist = MathMax(USDtoPrice(g_tpUSD), minDist * 2.0);
   double slDist = MathMax(USDtoPrice(g_slUSD), minDist);
   double offset = MathMax(25.0 * pt, (double)spread * pt * 1.5); // Stop offset فوق/تحت الـ High/Low

   double range  = high1 - low1;
   double mid    = (high1 + low1) / 2.0;

   if(signal == 1) // BUY
     {
      double stopPrice  = NormalizeDouble(high1 + offset, digs);       // Buy Stop فوق الـ High
      double limitPrice = NormalizeDouble(mid, digs);                   // Buy Limit عند وسط الشمعة

      double stopSL  = NormalizeDouble(stopPrice  - slDist, digs);
      double stopTP  = NormalizeDouble(stopPrice  + tpDist, digs);
      double limitSL = NormalizeDouble(limitPrice - slDist, digs);
      double limitTP = NormalizeDouble(limitPrice + tpDist, digs);

      // Buy Stop
      if(trade.BuyStop(lot, stopPrice, _Symbol, stopSL, stopTP, ORDER_TIME_GTC, 0, EA_NAME))
         g_stopTicket = trade.ResultOrder();

      // Buy Limit — فقط لو المدى كافي (أكبر من 50 نقطة = 0.50$)
      if(range >= 50.0 * pt && limitPrice > SymbolInfoDouble(_Symbol, SYMBOL_ASK) - 2*offset)
        {
         if(trade.BuyLimit(lot, limitPrice, _Symbol, limitSL, limitTP, ORDER_TIME_GTC, 0, EA_NAME))
            g_limitTicket = trade.ResultOrder();
        }
     }
   else // SELL
     {
      double stopPrice  = NormalizeDouble(low1 - offset, digs);        // Sell Stop تحت الـ Low
      double limitPrice = NormalizeDouble(mid, digs);                   // Sell Limit عند وسط الشمعة

      double stopSL  = NormalizeDouble(stopPrice  + slDist, digs);
      double stopTP  = NormalizeDouble(stopPrice  - tpDist, digs);
      double limitSL = NormalizeDouble(limitPrice + slDist, digs);
      double limitTP = NormalizeDouble(limitPrice - tpDist, digs);

      // Sell Stop
      if(trade.SellStop(lot, stopPrice, _Symbol, stopSL, stopTP, ORDER_TIME_GTC, 0, EA_NAME))
         g_stopTicket = trade.ResultOrder();

      // Sell Limit — فقط لو المدى كافي
      if(range >= 50.0 * pt && limitPrice < SymbolInfoDouble(_Symbol, SYMBOL_BID) + 2*offset)
        {
         if(trade.SellLimit(lot, limitPrice, _Symbol, limitSL, limitTP, ORDER_TIME_GTC, 0, EA_NAME))
            g_limitTicket = trade.ResultOrder();
        }
     }

   g_pendingSignal  = signal;
   g_pendingBarTime = iTime(_Symbol, TF, 0);
   g_barsElapsed    = 0;
   g_totalTrades++;

   Print(EA_NAME, ": OCO placed | sig=", signal,
         " Stop=", g_stopTicket, " Limit=", g_limitTicket,
         " range=", DoubleToString(range, digs));
  }

//+------------------------------------------------------------------+
void ManagePositions()
  {
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=g_magic) continue;
      ulong  tk     = posInfo.Ticket();
      double profit = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();

      if(profit >= g_tpUSD)
        { trade.PositionClose(tk);
          Print(EA_NAME, ": TP $", DoubleToString(profit,2)); continue; }

      if(profit <= -(g_slUSD * 2.5))
        { trade.PositionClose(tk);
          Print(EA_NAME, ": EMERG SL $", DoubleToString(profit,2)); continue; }
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI = iRSI(_Symbol, TF, 7, PRICE_CLOSE);
   hATR = iATR(_Symbol, TF, 14);

   if(hRSI==INVALID_HANDLE || hATR==INVALID_HANDLE)
     { Print(EA_NAME, ": indicator init failed"); return(INIT_FAILED); }

   LoadSettings();
   CreateDashboard();
   Print(EA_NAME, " v", EA_VERSION, " | Magic=", g_magic, " | TF=", EnumToString(TF));
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   CancelPendingOrders();
   if(hRSI != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hATR != INVALID_HANDLE) IndicatorRelease(hATR);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ManagePositions();
   CheckOCO();

   datetime barTime = iTime(_Symbol, TF, 0);
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   if(barTime == g_lastBar)
     {
      UpdateDashboard(g_pendingSignal, 50, InTradingSession(), g_pendingSignal,
                      false, 0, CountMyPositions(), 0, spread);
      return;
     }

   // شمعة جديدة
   g_lastBar = barTime;
   LoadSettings();

   // عدّ الشمعات منذ وضع الأوردرات
   if(g_pendingBarTime != 0 && (g_stopTicket != 0 || g_limitTicket != 0))
     {
      g_barsElapsed++;
      if(g_barsElapsed >= PendingExpireCandles)
        {
         Print(EA_NAME, ": pending orders expired after ", g_barsElapsed, " candles");
         CancelPendingOrders();
        }
     }

   double rsi[], atr[], o[], h[], l[], c[];
   ArraySetAsSeries(rsi,true); ArraySetAsSeries(atr,true);
   ArraySetAsSeries(o,true);   ArraySetAsSeries(h,true);
   ArraySetAsSeries(l,true);   ArraySetAsSeries(c,true);

   if(CopyBuffer(hRSI, 0, 0, 3, rsi) < 3) return;
   if(CopyBuffer(hATR, 0, 0, 3, atr) < 3) return;
   if(CopyOpen (_Symbol,TF,0,3,o)    < 3) return;
   if(CopyHigh (_Symbol,TF,0,3,h)    < 3) return;
   if(CopyLow  (_Symbol,TF,0,3,l)    < 3) return;
   if(CopyClose(_Symbol,TF,0,3,c)    < 3) return;

   double atr1  = atr[1];
   double high1 = h[1], low1 = l[1], open1 = o[1], close1 = c[1];
   double pt    = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

   // ── إشارة الشمعة المغلقة ──
   int signal = 0;
   double bodySize = MathAbs(close1 - open1);

   // فلتر doji: تجاهل الشموع بجسم أقل من 30 نقطة
   if(bodySize >= 30.0 * pt)
     {
      if     (close1 > open1) signal =  1;  // شمعة خضراء → BUY
      else if(close1 < open1) signal = -1;  // شمعة حمراء → SELL
     }

   // فلتر الاتجاه
   if(g_direction ==  1 && signal == -1) signal = 0;
   if(g_direction == -1 && signal ==  1) signal = 0;

   bool spreadOK = (spread <= (long)g_maxSpread);
   bool slotsOK  = (CountMyPositions() < g_maxPositions);
   bool sessOK   = InTradingSession();
   bool limitOK  = !DailyLimitHit();
   bool allOK    = spreadOK && slotsOK && sessOK && limitOK && atr1 > 0.0;
   bool blocked  = !(spreadOK && slotsOK && sessOK && limitOK);

   // لو فيه إشارة معاكسة → ألغِ الأوردرات القديمة فوراً
   if(signal != 0 && g_pendingSignal != 0 && signal != g_pendingSignal)
     {
      Print(EA_NAME, ": opposite signal — cancelling old OCO");
      CancelPendingOrders();
     }

   // ضع أوردرات جديدة لو ما فيه أوردرات معلقة
   if(signal != 0 && allOK && g_botRunning &&
      g_stopTicket == 0 && g_limitTicket == 0)
     {
      PlacePendingOCO(signal, high1, low1, atr1);
     }

   UpdateDashboard(signal, rsi[1], sessOK, signal, blocked, 0,
                   CountMyPositions(), atr1, spread);
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
   int panelH = PAD+TITLE_H+5*8+16*ROW_H+PAD;
   string bg = DASH_PREFIX+"BG";
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

   int xK = PANEL_X+PAD; int y = PANEL_Y+PAD;
   DLabel("TITLE", EA_NAME+" v"+EA_VERSION+"  "+_Symbol, xK, y, clrGold, 10);
   y+=TITLE_H; DDivider("D0",y); y+=8;

   DLabel("K_MAGIC",  "Magic",       xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SIG",    "Signal",      xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DIR",    "Direction",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D1",y); y+=8;

   DLabel("K_STOP",   "Stop Ord",    xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_LIMIT",  "Limit Ord",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_BARS",   "Bars Left",   xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D2",y); y+=8;

   DLabel("K_SESS",   "Session",     xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SPREAD", "Spread",      xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_ATR",    "ATR(14)",     xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D3",y); y+=8;

   DLabel("K_POS",    "Positions",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_PNL",    "Float P&L",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_TRADES", "Placed",      xK,y,CLR_KEY); y+=ROW_H;
   DDivider("D4",y); y+=8;

   DLabel("K_TP",     "TP Target",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_SL",     "SL Target",   xK,y,CLR_KEY); y+=ROW_H;
   DLabel("K_DLIMIT", "Day P&L",     xK,y,CLR_KEY);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void UpdateDashboard(const int trend, const double rsi,
                     const bool sessOK, const int signal,
                     const bool blocked, const int cdSec,
                     const int posCount, const double atrVal,
                     const long spreadPts)
  {
   int xV = PANEL_X+155; int y = PANEL_Y+PAD+TITLE_H+8;

   DLabel("V_MAGIC", (string)g_magic, xV,y,CLR_HILITE); y+=ROW_H;

   string sTxt = signal>0?"BUY ▲ STOP+LIMIT":signal<0?"SELL ▼ STOP+LIMIT":"WAIT (doji/filter)";
   color  sClr = signal>0?CLR_GOOD:signal<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_SIG", sTxt, xV,y,sClr); y+=ROW_H;

   string dTxt = g_direction==1?"BUY ONLY":g_direction==-1?"SELL ONLY":"FREE";
   DLabel("V_DIR", dTxt, xV,y,CLR_HILITE); y+=ROW_H+8;

   // OCO orders status
   bool stopE = OrderExists(g_stopTicket);
   bool limE  = OrderExists(g_limitTicket);
   DLabel("V_STOP",  stopE ? "#"+(string)g_stopTicket  : "---", xV,y, stopE?CLR_GOOD:CLR_NEUTRAL); y+=ROW_H;
   DLabel("V_LIMIT", limE  ? "#"+(string)g_limitTicket : "---", xV,y, limE ?CLR_GOOD:CLR_NEUTRAL); y+=ROW_H;
   int barsLeft = MathMax(0, PendingExpireCandles - g_barsElapsed);
   DLabel("V_BARS",  (stopE||limE) ? (string)barsLeft+"bar" : "---", xV,y, barsLeft==1?clrOrange:CLR_NEUTRAL); y+=ROW_H+8;

   DLabel("V_SESS",  sessOK?"ACTIVE":"CLOSED", xV,y, sessOK?CLR_GOOD:CLR_BAD); y+=ROW_H;
   color spClr = spreadPts>(long)g_maxSpread?CLR_BAD:spreadPts>200?clrOrange:CLR_NEUTRAL;
   DLabel("V_SPREAD", (string)spreadPts+" pts", xV,y,spClr); y+=ROW_H;
   DLabel("V_ATR",    DoubleToString(atrVal,_Digits), xV,y,CLR_HILITE); y+=ROW_H+8;

   color pClr = posCount>=g_maxPositions?CLR_BAD:CLR_HILITE;
   DLabel("V_POS",    (string)posCount+" / "+(string)g_maxPositions, xV,y,pClr); y+=ROW_H;
   double pl = MyFloatingPL();
   color  plClr = pl>0?CLR_GOOD:pl<0?CLR_BAD:CLR_NEUTRAL;
   DLabel("V_PNL",    (pl>=0?"+":"")+DoubleToString(pl,2), xV,y,plClr); y+=ROW_H;
   DLabel("V_TRADES", (string)g_totalTrades+" orders", xV,y,CLR_NEUTRAL); y+=ROW_H+8;

   DLabel("V_TP",     "$"+DoubleToString(g_tpUSD,2), xV,y,CLR_GOOD); y+=ROW_H;
   DLabel("V_SL",     "$"+DoubleToString(g_slUSD,2), xV,y,CLR_BAD); y+=ROW_H;

   double dayPnL = AccountInfoDouble(ACCOUNT_BALANCE) - g_dayStartBalance;
   color  dayClr = dayPnL >= 0 ? CLR_GOOD : CLR_BAD;
   bool   lim    = DailyLimitHit();
   DLabel("V_DLIMIT", (dayPnL>=0?"+":"")+DoubleToString(dayPnL,2)+(lim?" LIMIT!":""), xV,y, lim?CLR_BAD:dayClr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
