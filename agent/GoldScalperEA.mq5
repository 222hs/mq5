//+------------------------------------------------------------------+
//|                                          GoldScalperX.mq5        |
//|                   Multi-Symbol Fast Scalping Expert Advisor      |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "4.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

input double           LotSize      = 0.01;
input int              TP           = 30;
input int              SL           = 40;
input int              MaxSpread    = 500;
input int              RSI_Period   = 7;
input int              EMA_Fast     = 8;
input int              EMA_Slow     = 21;
input int              MaxPositions = 3;
input int              CandleConf   = 2;
input ENUM_TIMEFRAMES  TF           = PERIOD_M1;  // التايمفريم

#define BOT_NAME    "GoldScalperX"
#define DASH_PREFIX "GSX_"
#define GV_PREFIX   "GSX_"

// Magic Number فريد لكل زوج (hash بسيط من اسم الرمز)
int g_magic = 0;

CTrade        trade;
CPositionInfo posInfo;

int    hRSI      = INVALID_HANDLE;
int    hEMAFast  = INVALID_HANDLE;
int    hEMASlow  = INVALID_HANDLE;

double g_rsi     = 0.0;
double g_emaFast = 0.0;
double g_emaSlow = 0.0;

double g_LotSize      = 0.01;
int    g_TP           = 30;
int    g_SL           = 40;
int    g_MaxSpread    = 500;
int    g_MaxPositions = 3;
int    g_CandleConf   = 2;

string   g_lastSignal     = "NONE";
datetime g_lastSignalTime = 0;
int      g_totalTrades    = 0;
bool     g_running        = false;
datetime g_lastBarTime    = 0;

//+------------------------------------------------------------------+
int MagicFromSymbol(string sym)
  {
   int h = 100000;
   for(int i = 0; i < StringLen(sym); i++)
      h = h * 31 + (int)StringGetCharacter(sym, i);
   return MathAbs(h) % 900000 + 100000; // 100000–999999
  }

double GV(string key, double fallback)
  {
   string name = GV_PREFIX + key;
   if(GlobalVariableCheck(name))
      return GlobalVariableGet(name);
   return fallback;
  }

void LoadSettings()
  {
   g_LotSize      = GV("LotSize",      LotSize);
   g_TP           = (int)GV("TP",           TP);
   g_SL           = (int)GV("SL",           SL);
   g_MaxSpread    = (int)GV("MaxSpread",    MaxSpread);
   g_MaxPositions = (int)GV("MaxPositions", MaxPositions);
   g_CandleConf   = (int)GV("CandleConf",  CandleConf);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);

   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI     = iRSI(_Symbol, TF, RSI_Period, PRICE_CLOSE);
   hEMAFast = iMA(_Symbol,  TF, EMA_Fast, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow = iMA(_Symbol,  TF, EMA_Slow, 0, MODE_EMA, PRICE_CLOSE);

   if(hRSI == INVALID_HANDLE || hEMAFast == INVALID_HANDLE || hEMASlow == INVALID_HANDLE)
     {
      Print(BOT_NAME, "[", _Symbol, "]: FAILED to create indicator handles");
      return(INIT_FAILED);
     }

   LoadSettings();
   g_running = true;
   CreateDashboard();
   Print(BOT_NAME, "[", _Symbol, "]: INIT v4 | Magic=", g_magic,
         " | TF=", EnumToString(TF),
         " | Lot=", DoubleToString(g_LotSize,2),
         " | TP=", g_TP, " SL=", g_SL);
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
   Print(BOT_NAME, "[", _Symbol, "]: STOPPED | Trades=", g_totalTrades);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime currentBar = iTime(_Symbol, TF, 0);
   if(currentBar == g_lastBarTime) { UpdateDashboard(); return; }
   g_lastBarTime = currentBar;

   LoadSettings();

   if(!UpdateIndicators()) { UpdateDashboard(); return; }

   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > g_MaxSpread) { UpdateDashboard(); return; }

   int bullCount = 0, bearCount = 0;
   for(int i = 1; i <= g_CandleConf; i++)
     {
      double o = iOpen(_Symbol, TF, i);
      double c = iClose(_Symbol, TF, i);
      if(c > o) bullCount++;
      else if(c < o) bearCount++;
     }

   bool buySignal  = (bullCount == g_CandleConf && g_emaFast > g_emaSlow && g_rsi >= 40.0 && g_rsi <= 70.0);
   bool sellSignal = (bearCount == g_CandleConf && g_emaFast < g_emaSlow && g_rsi >= 30.0 && g_rsi <= 60.0);

   bool hasBuy = false, hasSell = false;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == g_magic)
        {
         if(posInfo.PositionType() == POSITION_TYPE_BUY)  hasBuy  = true;
         if(posInfo.PositionType() == POSITION_TYPE_SELL) hasSell = true;
        }
     }

   int totalOpen = OpenPositionsCount();

   if(buySignal)
     {
      if(hasSell)
        {
         Print(BOT_NAME, "[", _Symbol, "]: REVERSAL -> Closing SELL | RSI=", DoubleToString(g_rsi,2));
         CloseAllPositions(POSITION_TYPE_SELL);
        }
      if(totalOpen < g_MaxPositions) OpenPosition(ORDER_TYPE_BUY);
     }
   else if(sellSignal)
     {
      if(hasBuy)
        {
         Print(BOT_NAME, "[", _Symbol, "]: REVERSAL -> Closing BUY | RSI=", DoubleToString(g_rsi,2));
         CloseAllPositions(POSITION_TYPE_BUY);
        }
      if(totalOpen < g_MaxPositions) OpenPosition(ORDER_TYPE_SELL);
     }

   UpdateDashboard();
  }

//+------------------------------------------------------------------+
bool UpdateIndicators()
  {
   double bufRSI[1], bufFast[1], bufSlow[1];
   if(CopyBuffer(hRSI,     0, 1, 1, bufRSI)  < 1) return(false);
   if(CopyBuffer(hEMAFast, 0, 1, 1, bufFast) < 1) return(false);
   if(CopyBuffer(hEMASlow, 0, 1, 1, bufSlow) < 1) return(false);
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
      sl = NormalizeDouble(price - g_SL * point, _Digits);
      tp = NormalizeDouble(price + g_TP * point, _Digits);
      if(trade.Buy(g_LotSize, _Symbol, price, sl, tp, BOT_NAME))
        {
         g_totalTrades++;
         g_lastSignal = "BUY"; g_lastSignalTime = TimeCurrent();
         Print(BOT_NAME, "[", _Symbol, "]: BUY @ ", DoubleToString(price,_Digits),
               " TP=", DoubleToString(tp,_Digits), " SL=", DoubleToString(sl,_Digits));
        }
      else
         Print(BOT_NAME, "[", _Symbol, "]: BUY FAILED | ", trade.ResultRetcodeDescription());
     }
   else
     {
      price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      sl = NormalizeDouble(price + g_SL * point, _Digits);
      tp = NormalizeDouble(price - g_TP * point, _Digits);
      if(trade.Sell(g_LotSize, _Symbol, price, sl, tp, BOT_NAME))
        {
         g_totalTrades++;
         g_lastSignal = "SELL"; g_lastSignalTime = TimeCurrent();
         Print(BOT_NAME, "[", _Symbol, "]: SELL @ ", DoubleToString(price,_Digits),
               " TP=", DoubleToString(tp,_Digits), " SL=", DoubleToString(sl,_Digits));
        }
      else
         Print(BOT_NAME, "[", _Symbol, "]: SELL FAILED | ", trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
void CloseAllPositions(ENUM_POSITION_TYPE type)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol &&
         posInfo.Magic() == g_magic && posInfo.PositionType() == type)
        {
         ulong  ticket = posInfo.Ticket();
         double profit = posInfo.Profit();
         if(trade.PositionClose(ticket))
            Print(BOT_NAME, "[", _Symbol, "]: CLOSED Ticket=", ticket,
                  " P=", DoubleToString(profit,2), "$");
         else
            Print(BOT_NAME, "[", _Symbol, "]: CLOSE FAILED Ticket=", ticket);
        }
     }
  }

//+------------------------------------------------------------------+
int OpenPositionsCount()
  {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == g_magic)
         count++;
   return(count);
  }

double FloatingProfit()
  {
   double profit = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == g_magic)
         profit += posInfo.Profit() + posInfo.Swap();
   return(profit);
  }

//+------------------------------------------------------------------+
void CreatePanel(string name, int x, int y, int w, int h)
  {
   ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER,       CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE,    x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE,    y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE,        w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE,        h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR,      C'20,20,30');
   ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, clrDimGray);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE,  BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_BACK,         false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE,   false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN,       true);
  }

void CreateLabel(string name, int x, int y)
  {
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER,    CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE,  9);
   ObjectSetString(0,  name, OBJPROP_FONT,      "Consolas");
   ObjectSetInteger(0, name, OBJPROP_COLOR,     clrWhite);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN,    true);
  }

void SetLabel(int idx, string text, color clr)
  {
   string name = DASH_PREFIX + "L" + IntegerToString(idx);
   ObjectSetString(0,  name, OBJPROP_TEXT,  text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
  }

void CreateDashboard()
  {
   CreatePanel(DASH_PREFIX + "BG", 10, 20, 300, 320);
   for(int i = 0; i < 14; i++)
      CreateLabel(DASH_PREFIX + "L" + IntegerToString(i), 20, 30 + i * 21);
   UpdateDashboard();
  }

void UpdateDashboard()
  {
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   string trend; color trendClr;
   if(g_emaFast > g_emaSlow)      { trend = "BULLISH"; trendClr = clrLime;  }
   else if(g_emaFast < g_emaSlow) { trend = "BEARISH"; trendClr = clrRed;   }
   else                           { trend = "NEUTRAL"; trendClr = clrWhite; }

   color rsiClr = clrWhite;
   if(g_rsi >= 40.0 && g_rsi <= 70.0 && g_emaFast > g_emaSlow) rsiClr = clrLime;
   else if(g_rsi >= 30.0 && g_rsi <= 60.0 && g_emaFast < g_emaSlow) rsiClr = clrRed;

   double profit   = FloatingProfit();
   color profitClr = (profit > 0.0 ? clrLime : (profit < 0.0 ? clrRed : clrWhite));
   color spreadClr = (spread > g_MaxSpread ? clrRed : clrLime);

   string lastSig = g_lastSignal;
   if(g_lastSignalTime > 0)
      lastSig += " @ " + TimeToString(g_lastSignalTime, TIME_MINUTES|TIME_SECONDS);

   bool usingGV = GlobalVariableCheck(GV_PREFIX + "LotSize");

   SetLabel(0,  "★ " + BOT_NAME + " [" + _Symbol + "] ★",                        clrGold);
   SetLabel(1,  "TF      : " + EnumToString(TF) + " | Magic=" + IntegerToString(g_magic), clrSilver);
   SetLabel(2,  "Status  : " + (g_running ? "RUNNING" : "STOPPED"),               g_running ? clrLime : clrRed);
   SetLabel(3,  "Settings: " + (usingGV ? "Dashboard ✓" : "Local defaults"),     usingGV ? clrLime : clrYellow);
   SetLabel(4,  "EMA" + IntegerToString(EMA_Fast) + "    : " + DoubleToString(g_emaFast,2), clrDeepSkyBlue);
   SetLabel(5,  "EMA" + IntegerToString(EMA_Slow) + "   : " + DoubleToString(g_emaSlow,2), clrOrange);
   SetLabel(6,  "RSI(" + IntegerToString(RSI_Period) + ")  : " + DoubleToString(g_rsi,2),  rsiClr);
   SetLabel(7,  "Trend   : " + trend,                                              trendClr);
   SetLabel(8,  "Confirm : " + IntegerToString(g_CandleConf) + " candles",        clrSilver);
   SetLabel(9,  "Lot/TP/SL: " + DoubleToString(g_LotSize,2) + " / " + IntegerToString(g_TP) + " / " + IntegerToString(g_SL), clrSilver);
   SetLabel(10, "Signal  : " + lastSig,                                            g_lastSignal=="BUY"?clrLime:g_lastSignal=="SELL"?clrRed:clrWhite);
   SetLabel(11, "Open    : " + IntegerToString(OpenPositionsCount()) + " / " + IntegerToString(g_MaxPositions), clrWhite);
   SetLabel(12, "P/L     : " + DoubleToString(profit,2) + " USD",                 profitClr);
   SetLabel(13, "Spread  : " + IntegerToString((int)spread) + " pts",             spreadClr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
