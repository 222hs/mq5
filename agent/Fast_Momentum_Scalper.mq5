//+------------------------------------------------------------------+
//|                                        Fast_Momentum_Scalper.mq5 |
//|                                  Copyright 2026, Hussein Tech    |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, Hussein Tech"
#property link      "https://www.mql5.com"
#property version   "1.10"
#property strict

//--- إعدادات
input group "--- إعدادات الاسكالبينج السريع ---"
input double InpLotSize          = 0.1;
input int    InpTakeProfitPoints = 50;
input int    InpStopLossPoints   = 100;
input int    InpMinCandleSize    = 30;

//--- dashboard
#define DP   "FMS_"
#define PX   10
#define PY   10
#define PW   270
#define RH   21
#define PAD  16
#define TH   26
#define CLR_BG      C'12,12,22'
#define CLR_BORDER  clrDimGray
#define CLR_DIV     C'50,50,70'
#define CLR_KEY     C'120,120,150'
#define CLR_GOOD    clrLime
#define CLR_BAD     clrOrangeRed
#define CLR_HILITE  clrDeepSkyBlue
#define CLR_NEUTRAL clrSilver

//--- globals
ulong    magicNumber  = 888111;
datetime lastTradeTime= 0;
int      g_totalTrades= 0;
double   g_totalProfit= 0.0;
int      g_wins       = 0;
int      g_losses     = 0;

//+------------------------------------------------------------------+
// Dashboard helpers
//+------------------------------------------------------------------+
void DLabel(const string id, const string txt, const int x, const int y,
            const color clr, const int fs = 9)
  {
   string nm = DP + id;
   if(ObjectFind(0, nm) < 0)
     {
      ObjectCreate(0, nm, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, nm, OBJPROP_CORNER,    CORNER_LEFT_UPPER);
      ObjectSetInteger(0, nm, OBJPROP_BACK,      false);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,    true);
      ObjectSetInteger(0, nm, OBJPROP_ZORDER,    1);
      ObjectSetString (0, nm, OBJPROP_FONT,      "Consolas");
     }
   ObjectSetInteger(0, nm, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nm, OBJPROP_COLOR,     clr);
   ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,  fs);
   ObjectSetString (0, nm, OBJPROP_TEXT,      txt);
  }

void DDivider(const string id, const int y)
  {
   string nm = DP + id;
   if(ObjectFind(0, nm) < 0)
     {
      ObjectCreate(0, nm, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, nm, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
      ObjectSetInteger(0, nm, OBJPROP_XDISTANCE,  PX + PAD);
      ObjectSetInteger(0, nm, OBJPROP_XSIZE,      PW - 2*PAD);
      ObjectSetInteger(0, nm, OBJPROP_YSIZE,      1);
      ObjectSetInteger(0, nm, OBJPROP_BGCOLOR,    CLR_DIV);
      ObjectSetInteger(0, nm, OBJPROP_BORDER_TYPE,BORDER_FLAT);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      CLR_DIV);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       false);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, nm, OBJPROP_ZORDER,     1);
     }
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, y);
  }

void CreateDashboard()
  {
   int rows   = 15;
   int panelH = PAD + TH + 4*7 + rows*RH + PAD;
   string bg  = DP + "BG";
   if(ObjectFind(0, bg) < 0)
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0,bg,OBJPROP_CORNER,     CORNER_LEFT_UPPER);
   ObjectSetInteger(0,bg,OBJPROP_XDISTANCE,  PX);
   ObjectSetInteger(0,bg,OBJPROP_YDISTANCE,  PY);
   ObjectSetInteger(0,bg,OBJPROP_XSIZE,      PW);
   ObjectSetInteger(0,bg,OBJPROP_YSIZE,      panelH);
   ObjectSetInteger(0,bg,OBJPROP_BGCOLOR,    CLR_BG);
   ObjectSetInteger(0,bg,OBJPROP_BORDER_TYPE,BORDER_FLAT);
   ObjectSetInteger(0,bg,OBJPROP_COLOR,      CLR_BORDER);
   ObjectSetInteger(0,bg,OBJPROP_WIDTH,      1);
   ObjectSetInteger(0,bg,OBJPROP_BACK,       false);
   ObjectSetInteger(0,bg,OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0,bg,OBJPROP_HIDDEN,     true);
   ObjectSetInteger(0,bg,OBJPROP_ZORDER,     0);

   int xK = PX + PAD;
   int y  = PY + PAD;
   DLabel("TITLE", "Fast Momentum Scalper  " + _Symbol, xK, y, clrGold, 10);
   y += TH; DDivider("D0", y); y += 7;

   // keys column
   DLabel("K_STATUS",  "Status",    xK, y, CLR_KEY); y += RH;
   DLabel("K_SIGNAL",  "Signal",    xK, y, CLR_KEY); y += RH;
   DLabel("K_CANDLE",  "Candle Δ",  xK, y, CLR_KEY); y += RH;
   DDivider("D1", y); y += 7;

   DLabel("K_POS",     "Positions", xK, y, CLR_KEY); y += RH;
   DLabel("K_PNL",     "Float P&L", xK, y, CLR_KEY); y += RH;
   DLabel("K_ENTRY",   "Entry",     xK, y, CLR_KEY); y += RH;
   DDivider("D2", y); y += 7;

   DLabel("K_TRADES",  "Trades",    xK, y, CLR_KEY); y += RH;
   DLabel("K_WINS",    "Wins",      xK, y, CLR_KEY); y += RH;
   DLabel("K_LOSSES",  "Losses",    xK, y, CLR_KEY); y += RH;
   DLabel("K_TPROFIT", "Total P&L", xK, y, CLR_KEY); y += RH;
   DLabel("K_WINRATE", "Win Rate",  xK, y, CLR_KEY); y += RH;
   DDivider("D3", y); y += 7;

   DLabel("K_TP",      "TP pts",    xK, y, CLR_KEY); y += RH;
   DLabel("K_SL",      "SL pts",    xK, y, CLR_KEY); y += RH;
   DLabel("K_LOT",     "Lot",       xK, y, CLR_KEY); y += RH;
   DLabel("K_SPREAD",  "Spread",    xK, y, CLR_KEY);
   ChartRedraw();
  }

void UpdateDashboard(int signal, double candlePts, int posCount,
                     double floatPL, bool ready, long spread)
  {
   int xV = PX + 145;
   int y  = PY + PAD + TH + 7;

   // Status
   string stTxt = ready ? "READY" : "WAITING";
   color  stClr = ready ? CLR_GOOD : CLR_NEUTRAL;
   DLabel("V_STATUS", stTxt, xV, y, stClr); y += RH;

   // Signal
   string sigTxt = signal > 0 ? "BUY ▲" : signal < 0 ? "SELL ▼" : "NONE";
   color  sigClr = signal > 0 ? CLR_GOOD : signal < 0 ? CLR_BAD : CLR_NEUTRAL;
   DLabel("V_SIGNAL", sigTxt, xV, y, sigClr); y += RH;

   // Candle momentum
   color cClr = candlePts >= InpMinCandleSize ? CLR_GOOD : CLR_NEUTRAL;
   DLabel("V_CANDLE", DoubleToString(candlePts, 0) + " pts", xV, y, cClr); y += RH + 7;

   // Positions
   color pClr = posCount > 0 ? CLR_HILITE : CLR_NEUTRAL;
   DLabel("V_POS", (string)posCount, xV, y, pClr); y += RH;

   // Float P&L
   color plClr = floatPL > 0 ? CLR_GOOD : floatPL < 0 ? CLR_BAD : CLR_NEUTRAL;
   DLabel("V_PNL", (floatPL >= 0 ? "+" : "") + DoubleToString(floatPL, 2) + "$", xV, y, plClr); y += RH;

   // Entry
   string entTxt = posCount > 0 ? "IN TRADE" : ready ? "WATCHING" : "COOLDOWN";
   color  entClr = posCount > 0 ? CLR_HILITE : ready ? CLR_GOOD : CLR_NEUTRAL;
   DLabel("V_ENTRY", entTxt, xV, y, entClr); y += RH + 7;

   // Stats
   DLabel("V_TRADES",  (string)g_totalTrades,                           xV, y, CLR_NEUTRAL); y += RH;
   DLabel("V_WINS",    (string)g_wins,                                   xV, y, CLR_GOOD);    y += RH;
   DLabel("V_LOSSES",  (string)g_losses,                                 xV, y, CLR_BAD);     y += RH;
   color tpClr = g_totalProfit >= 0 ? CLR_GOOD : CLR_BAD;
   DLabel("V_TPROFIT", (g_totalProfit>=0?"+":"") + DoubleToString(g_totalProfit,2)+"$", xV, y, tpClr); y += RH;
   double wr = g_totalTrades > 0 ? (double)g_wins / g_totalTrades * 100.0 : 0.0;
   color  wrClr = wr >= 50 ? CLR_GOOD : CLR_BAD;
   DLabel("V_WINRATE", DoubleToString(wr, 1) + "%", xV, y, wrClr); y += RH + 7;

   // Settings
   DLabel("V_TP",     (string)InpTakeProfitPoints + " pts", xV, y, CLR_GOOD);    y += RH;
   DLabel("V_SL",     (string)InpStopLossPoints   + " pts", xV, y, CLR_BAD);     y += RH;
   DLabel("V_LOT",    DoubleToString(InpLotSize, 2),         xV, y, CLR_HILITE);  y += RH;
   color spClr = spread > 30 ? CLR_BAD : CLR_NEUTRAL;
   DLabel("V_SPREAD", (string)spread + " pts",               xV, y, spClr);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
int CountOpenPositions()
  {
   int count = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(PositionGetSymbol(i)==_Symbol && PositionGetInteger(POSITION_MAGIC)==(long)magicNumber)
         count++;
   return count;
  }

double FloatingPL()
  {
   double pl = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
      if(PositionGetSymbol(i)==_Symbol && PositionGetInteger(POSITION_MAGIC)==(long)magicNumber)
         pl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   return pl;
  }

//+------------------------------------------------------------------+
void ExecuteFastOrder(ENUM_ORDER_TYPE type)
  {
   MqlTradeRequest request = {};
   MqlTradeResult  result  = {};

   double price = (type==ORDER_TYPE_BUY)
                  ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                  : SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // الحد الأدنى المسموح به للرمز
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long   freezeLevel= SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minDist    = MathMax((double)(stopsLevel + freezeLevel + 5), 10.0) * _Point;

   double slDist = MathMax(InpStopLossPoints   * _Point, minDist);
   double tpDist = MathMax(InpTakeProfitPoints * _Point, minDist);

   double sl = (type==ORDER_TYPE_BUY)
               ? price - slDist
               : price + slDist;
   double tp = (type==ORDER_TYPE_BUY)
               ? price + tpDist
               : price - tpDist;

   request.action       = TRADE_ACTION_DEAL;
   request.symbol       = _Symbol;
   request.volume       = InpLotSize;
   request.type         = type;
   request.price        = price;
   request.sl           = NormalizeDouble(sl, _Digits);
   request.tp           = NormalizeDouble(tp, _Digits);
   request.deviation    = 5;
   request.magic        = magicNumber;
   request.comment      = "FMS";
   request.type_filling = ORDER_FILLING_IOC;

   if(OrderSend(request, result))
     { g_totalTrades++; Print("FMS: ", EnumToString(type), " opened #", result.order); }
   else
      Print("FMS: error ", GetLastError(), " / ", result.retcode);
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &request,
                        const MqlTradeResult      &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(trans.deal_type != DEAL_TYPE_BUY && trans.deal_type != DEAL_TYPE_SELL) return;
   // نحسب الصفقات المغلقة فقط (entry=1 = close)
   if(HistoryDealSelect(trans.deal))
     {
      long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT)
        {
         double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                       + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                       + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
         g_totalProfit += profit;
         if(profit > 0) g_wins++;
         else           g_losses++;
        }
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   CreateDashboard();
   Print("Fast Momentum Scalper v1.10 | TP=", InpTakeProfitPoints,
         " SL=", InpStopLossPoints, " Lot=", InpLotSize);
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, DP);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   if(CopyRates(_Symbol, _Period, 0, 1, rates) < 1) return;

   double candleOpen  = rates[0].open;
   double candleClose = rates[0].close;
   double priceDiff   = MathAbs(candleClose - candleOpen) / _Point;
   long   spread      = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   int    posCount    = CountOpenPositions();
   double floatPL     = FloatingPL();
   bool   coolOK      = (TimeCurrent() - lastTradeTime >= 2);

   int signal = 0;
   if(priceDiff >= InpMinCandleSize)
     {
      if(candleClose > candleOpen) signal =  1;
      else if(candleClose < candleOpen) signal = -1;
     }

   bool ready = (posCount == 0 && coolOK && priceDiff >= InpMinCandleSize);
   UpdateDashboard(signal, priceDiff, posCount, floatPL, ready, spread);

   if(posCount > 0 || !coolOK) return;
   if(priceDiff < InpMinCandleSize) return;

   if(signal == 1)
     { ExecuteFastOrder(ORDER_TYPE_BUY);  lastTradeTime = TimeCurrent(); }
   else if(signal == -1)
     { ExecuteFastOrder(ORDER_TYPE_SELL); lastTradeTime = TimeCurrent(); }
  }
//+------------------------------------------------------------------+
