//+------------------------------------------------------------------+
//|                                          GoldScalperX_M1.mq5     |
//|                        XAUUSD M1 Fast Scalping Expert Advisor    |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

input double LotSize    = 0.01;
input int    TP         = 30;
input int    SL         = 40;
input int    MaxSpread  = 500;
input int    RSI_Period = 7;
input int    EMA_Fast   = 8;
input int    EMA_Slow   = 21;
input int    MaxPositions = 5;   // أقصى عدد صفقات مفتوحة في نفس الوقت

#define MAGIC_NUMBER 999111
#define BOT_NAME     "GoldScalperX M1"
#define DASH_PREFIX  "GSX_"

CTrade        trade;
CPositionInfo posInfo;

int    hRSI      = INVALID_HANDLE;
int    hEMAFast  = INVALID_HANDLE;
int    hEMASlow  = INVALID_HANDLE;

double g_rsi     = 0.0;
double g_emaFast = 0.0;
double g_emaSlow = 0.0;

string   g_lastSignal     = "NONE";
datetime g_lastSignalTime = 0;
int      g_totalTrades    = 0;
bool     g_running        = false;

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(MAGIC_NUMBER);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI     = iRSI(_Symbol, PERIOD_M1, RSI_Period, PRICE_CLOSE);
   hEMAFast = iMA(_Symbol, PERIOD_M1, EMA_Fast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow = iMA(_Symbol, PERIOD_M1, EMA_Slow, 0, MODE_EMA, PRICE_CLOSE);

   if(hRSI == INVALID_HANDLE || hEMAFast == INVALID_HANDLE || hEMASlow == INVALID_HANDLE)
     {
      Print(BOT_NAME, ": FAILED to create indicator handles");
      return(INIT_FAILED);
     }

   g_running = true;
   CreateDashboard();
   Print(BOT_NAME, ": INITIALIZED | Symbol=", _Symbol, " | Magic=", MAGIC_NUMBER,
         " | Lot=", DoubleToString(LotSize, 2), " | TP=", TP, " SL=", SL);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   g_running = false;
   if(hRSI     != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hEMAFast != INVALID_HANDLE) IndicatorRelease(hEMAFast);
   if(hEMASlow != INVALID_HANDLE) IndicatorRelease(hEMASlow);
   ObjectsDeleteAll(0, DASH_PREFIX);
   ChartRedraw();
   Print(BOT_NAME, ": STOPPED | TotalTrades=", g_totalTrades);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   if(!UpdateIndicators()) { UpdateDashboard(); return; }

   double candleOpen  = iOpen(_Symbol, PERIOD_M1, 0);
   double candleClose = iClose(_Symbol, PERIOD_M1, 0);
   bool bullCandle = (candleClose > candleOpen);
   bool bearCandle = (candleClose < candleOpen);

   bool buySignal  = (bullCandle && g_emaFast > g_emaSlow && g_rsi >= 40.0 && g_rsi <= 70.0);
   bool sellSignal = (bearCandle && g_emaFast < g_emaSlow && g_rsi >= 30.0 && g_rsi <= 60.0);

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   bool hasBuy = false, hasSell = false;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == MAGIC_NUMBER)
        {
         if(posInfo.PositionType() == POSITION_TYPE_BUY)  hasBuy  = true;
         if(posInfo.PositionType() == POSITION_TYPE_SELL) hasSell = true;
        }
     }

   if(spread > MaxSpread) { UpdateDashboard(); return; }

   int totalOpen = OpenPositionsCount();

   if(buySignal)
     {
      if(hasSell)
        {
         Print(BOT_NAME, ": REVERSAL -> Closing SELL to open BUY | RSI=", DoubleToString(g_rsi, 2));
         CloseAllPositions(POSITION_TYPE_SELL);
        }
      if(totalOpen < MaxPositions) OpenPosition(ORDER_TYPE_BUY);
     }
   else if(sellSignal)
     {
      if(hasBuy)
        {
         Print(BOT_NAME, ": REVERSAL -> Closing BUY to open SELL | RSI=", DoubleToString(g_rsi, 2));
         CloseAllPositions(POSITION_TYPE_BUY);
        }
      if(totalOpen < MaxPositions) OpenPosition(ORDER_TYPE_SELL);
     }

   UpdateDashboard();
  }

//+------------------------------------------------------------------+
bool UpdateIndicators()
  {
   double bufRSI[1], bufFast[1], bufSlow[1];
   if(CopyBuffer(hRSI, 0, 0, 1, bufRSI) < 1)      return(false);
   if(CopyBuffer(hEMAFast, 0, 0, 1, bufFast) < 1) return(false);
   if(CopyBuffer(hEMASlow, 0, 0, 1, bufSlow) < 1) return(false);
   g_rsi     = bufRSI[0];
   g_emaFast = bufFast[0];
   g_emaSlow = bufSlow[0];
   return(true);
  }

//+------------------------------------------------------------------+
void OpenPosition(ENUM_ORDER_TYPE type)
  {
   double price, sl, tp;
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

   if(type == ORDER_TYPE_BUY)
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      sl = NormalizeDouble(price - SL * point, _Digits);
      tp = NormalizeDouble(price + TP * point, _Digits);
      if(trade.Buy(LotSize, _Symbol, price, sl, tp, BOT_NAME))
        {
         g_totalTrades++;
         g_lastSignal = "BUY"; g_lastSignalTime = TimeCurrent();
         Print(BOT_NAME, ": BUY OPENED | Price=", DoubleToString(price,_Digits),
               " SL=", DoubleToString(sl,_Digits), " TP=", DoubleToString(tp,_Digits),
               " | RSI=", DoubleToString(g_rsi,2), " Ticket=", trade.ResultOrder());
        }
      else
         Print(BOT_NAME, ": BUY FAILED | ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
     }
   else
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      sl = NormalizeDouble(price + SL * point, _Digits);
      tp = NormalizeDouble(price - TP * point, _Digits);
      if(trade.Sell(LotSize, _Symbol, price, sl, tp, BOT_NAME))
        {
         g_totalTrades++;
         g_lastSignal = "SELL"; g_lastSignalTime = TimeCurrent();
         Print(BOT_NAME, ": SELL OPENED | Price=", DoubleToString(price,_Digits),
               " SL=", DoubleToString(sl,_Digits), " TP=", DoubleToString(tp,_Digits),
               " | RSI=", DoubleToString(g_rsi,2), " Ticket=", trade.ResultOrder());
        }
      else
         Print(BOT_NAME, ": SELL FAILED | ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
void CloseAllPositions(ENUM_POSITION_TYPE type)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol &&
         posInfo.Magic() == MAGIC_NUMBER && posInfo.PositionType() == type)
        {
         ulong  ticket = posInfo.Ticket();
         double profit = posInfo.Profit();
         if(trade.PositionClose(ticket))
            Print(BOT_NAME, ": CLOSED | Ticket=", ticket,
                  " Type=", (type==POSITION_TYPE_BUY?"BUY":"SELL"),
                  " Profit=", DoubleToString(profit,2), " USD");
         else
            Print(BOT_NAME, ": CLOSE FAILED | Ticket=", ticket, " ", trade.ResultRetcodeDescription());
        }
     }
  }

//+------------------------------------------------------------------+
int OpenPositionsCount()
  {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == MAGIC_NUMBER)
         count++;
   return(count);
  }

double FloatingProfit()
  {
   double profit = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == MAGIC_NUMBER)
         profit += posInfo.Profit() + posInfo.Swap();
   return(profit);
  }

//+------------------------------------------------------------------+
void CreatePanel(string name, int x, int y, int w, int h)
  {
   ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, C'20,20,30');
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, clrDimGray);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
  }

void CreateLabel(string name, int x, int y)
  {
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
  }

void SetLabel(int idx, string text, color clr)
  {
   string name = DASH_PREFIX + "L" + IntegerToString(idx);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
  }

void CreateDashboard()
  {
   CreatePanel(DASH_PREFIX + "BG", 10, 20, 270, 255);
   for(int i = 0; i < 11; i++)
      CreateLabel(DASH_PREFIX + "L" + IntegerToString(i), 20, 30 + i * 22);
   UpdateDashboard();
  }

void UpdateDashboard()
  {
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   string trend; color trendClr;
   if(g_emaFast > g_emaSlow)      { trend = "BULLISH"; trendClr = clrLime; }
   else if(g_emaFast < g_emaSlow) { trend = "BEARISH"; trendClr = clrRed;  }
   else                           { trend = "NEUTRAL"; trendClr = clrWhite; }

   color rsiClr = clrWhite;
   if(g_rsi >= 40.0 && g_rsi <= 70.0 && g_emaFast > g_emaSlow) rsiClr = clrLime;
   else if(g_rsi >= 30.0 && g_rsi <= 60.0 && g_emaFast < g_emaSlow) rsiClr = clrRed;

   double profit = FloatingProfit();
   color profitClr = (profit > 0.0 ? clrLime : (profit < 0.0 ? clrRed : clrWhite));
   color spreadClr = (spread > MaxSpread ? clrRed : clrLime);

   string lastSig = g_lastSignal;
   if(g_lastSignalTime > 0)
      lastSig += " @ " + TimeToString(g_lastSignalTime, TIME_MINUTES|TIME_SECONDS);

   SetLabel(0,  "★ " + BOT_NAME + " ★",                                          clrGold);
   SetLabel(1,  "Status  : " + (g_running ? "RUNNING" : "STOPPED"),              g_running ? clrLime : clrRed);
   SetLabel(2,  "EMA8    : " + DoubleToString(g_emaFast, 2),                     clrDeepSkyBlue);
   SetLabel(3,  "EMA21   : " + DoubleToString(g_emaSlow, 2),                     clrOrange);
   SetLabel(4,  "RSI(" + IntegerToString(RSI_Period) + ")  : " + DoubleToString(g_rsi, 2), rsiClr);
   SetLabel(5,  "Trend   : " + trend,                                             trendClr);
   SetLabel(6,  "Signal  : " + lastSig,                                           g_lastSignal=="BUY"?clrLime:g_lastSignal=="SELL"?clrRed:clrWhite);
   SetLabel(7,  "Open    : " + IntegerToString(OpenPositionsCount()) + " trades", clrWhite);
   SetLabel(8,  "P/L     : " + DoubleToString(profit, 2) + " USD",               profitClr);
   SetLabel(9,  "Total   : " + IntegerToString(g_totalTrades) + " trades",       clrWhite);
   SetLabel(10, "Spread  : " + IntegerToString((int)spread) + " pts",            spreadClr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
