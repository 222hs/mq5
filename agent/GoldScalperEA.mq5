//+------------------------------------------------------------------+
//|                                              GoldScalperEA.mq5   |
//|                                          GoldScalperX v8         |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "8.00"
#property strict

#include <Trade\Trade.mqh>

//--- Inputs
input double          LotSize      = 0.5;        // Lot size
input ENUM_TIMEFRAMES TF           = PERIOD_M1;  // Timeframe
input int             MaxPositions = 15;         // Max open positions
input int             CooldownSecs = 5;          // Cooldown between entries (sec)
input int             MaxSpread    = 500;        // Max spread (points)
input double          ATR_SL_Mult  = 1.5;        // ATR SL multiplier
input double          ATR_TP_Mult  = 2.5;        // ATR TP multiplier
input int             ADX_Period   = 14;         // ADX period
input double          ADX_MinLevel = 20.0;       // ADX minimum level

//--- Constants
#define DASH_PREFIX "GSX_D_"
#define GV_PREFIX   "GSX_"

//--- Globals
CTrade   trade;
long     g_magic          = 0;
int      hEMA8 = INVALID_HANDLE, hEMA21 = INVALID_HANDLE;
int      hRSI = INVALID_HANDLE, hADX = INVALID_HANDLE, hATR = INVALID_HANDLE;
datetime g_lastEntryTime  = 0;
int      g_totalTrades    = 0;
string   g_lastPattern    = "NONE";
string   g_lastSignal     = "NONE";

// effective settings (GV override or input fallback)
double   eff_LotSize;
int      eff_MaxSpread;
int      eff_MaxPositions;
int      eff_CooldownSecs;
bool     g_fromDashboard  = false;

//+------------------------------------------------------------------+
//| djb2 hash of symbol -> magic in 100000..999999                   |
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
//| Read settings from Global Variables with input fallback          |
//+------------------------------------------------------------------+
void LoadSettings()
  {
   g_fromDashboard = false;
   eff_LotSize      = LotSize;
   eff_MaxSpread    = MaxSpread;
   eff_MaxPositions = MaxPositions;
   eff_CooldownSecs = CooldownSecs;

   if(GlobalVariableCheck(GV_PREFIX + "LotSize"))
     { eff_LotSize = GlobalVariableGet(GV_PREFIX + "LotSize"); g_fromDashboard = true; }
   if(GlobalVariableCheck(GV_PREFIX + "MaxSpread"))
     { eff_MaxSpread = (int)GlobalVariableGet(GV_PREFIX + "MaxSpread"); g_fromDashboard = true; }
   if(GlobalVariableCheck(GV_PREFIX + "MaxPositions"))
     { eff_MaxPositions = (int)GlobalVariableGet(GV_PREFIX + "MaxPositions"); g_fromDashboard = true; }
   if(GlobalVariableCheck(GV_PREFIX + "CooldownSecs"))
     { eff_CooldownSecs = (int)GlobalVariableGet(GV_PREFIX + "CooldownSecs"); g_fromDashboard = true; }
  }

//+------------------------------------------------------------------+
//| Normalize lot to symbol volume constraints                       |
//+------------------------------------------------------------------+
double NormalizeLot(double lot)
  {
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(lotStep > 0)
      lot = MathFloor(lot / lotStep) * lotStep;
   lot = MathMax(minLot, MathMin(maxLot, lot));
   return NormalizeDouble(lot, 2);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic = MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber((ulong)g_magic);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hEMA8  = iMA(_Symbol, TF, 8, 0, MODE_EMA, PRICE_CLOSE);
   hEMA21 = iMA(_Symbol, TF, 21, 0, MODE_EMA, PRICE_CLOSE);
   hRSI   = iRSI(_Symbol, TF, 7, PRICE_CLOSE);
   hADX   = iADX(_Symbol, TF, ADX_Period);
   hATR   = iATR(_Symbol, TF, 14);

   if(hEMA8 == INVALID_HANDLE || hEMA21 == INVALID_HANDLE ||
      hRSI == INVALID_HANDLE || hADX == INVALID_HANDLE || hATR == INVALID_HANDLE)
     {
      Print("GoldScalperX v8: failed to create indicator handles");
      return INIT_FAILED;
     }

   LoadSettings();
   CreateDashboard();
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, DASH_PREFIX);
   if(hEMA8  != INVALID_HANDLE) IndicatorRelease(hEMA8);
   if(hEMA21 != INVALID_HANDLE) IndicatorRelease(hEMA21);
   if(hRSI   != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hADX   != INVALID_HANDLE) IndicatorRelease(hADX);
   if(hATR   != INVALID_HANDLE) IndicatorRelease(hATR);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Count positions of this EA on this symbol                        |
//+------------------------------------------------------------------+
int CountPositions()
  {
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == g_magic)
         cnt++;
     }
   return cnt;
  }

//+------------------------------------------------------------------+
double FloatingPL()
  {
   double pl = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == g_magic)
         pl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
   return pl;
  }

//+------------------------------------------------------------------+
//| Candlestick pattern detection on closed bar (index 1)            |
//+------------------------------------------------------------------+
string DetectPattern(bool &bullish, bool &bearish)
  {
   bullish = false;
   bearish = false;

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   if(CopyRates(_Symbol, TF, 0, 4, rates) < 4)
      return "NONE";

   double o1 = rates[1].open,  c1 = rates[1].close;
   double h1 = rates[1].high,  l1 = rates[1].low;
   double o2 = rates[2].open,  c2 = rates[2].close;

   double body1 = MathAbs(c1 - o1);
   double upperWick = h1 - MathMax(o1, c1);
   double lowerWick = MathMin(o1, c1) - l1;

   bool bull1 = c1 > o1;
   bool bear1 = c1 < o1;
   bool bull2 = c2 > o2;
   bool bear2 = c2 < o2;

   // Engulfing: candle[1] body fully covers candle[2] body
   bool bullEngulf = bull1 && bear2 && body1 > 0 &&
                     MathMax(o1, c1) >= MathMax(o2, c2) &&
                     MathMin(o1, c1) <= MathMin(o2, c2);
   bool bearEngulf = bear1 && bull2 && body1 > 0 &&
                     MathMax(o1, c1) >= MathMax(o2, c2) &&
                     MathMin(o1, c1) <= MathMin(o2, c2);

   // Pin bars: wick >= 2x body, opposite wick small
   bool bullPin = body1 > 0 && lowerWick >= 2.0 * body1 && upperWick <= body1 && bull1;
   bool bearPin = body1 > 0 && upperWick >= 2.0 * body1 && lowerWick <= body1 && bear1;

   if(bullEngulf) { bullish = true; return "BULL ENGULF"; }
   if(bearEngulf) { bearish = true; return "BEAR ENGULF"; }
   if(bullPin)    { bullish = true; return "BULL PIN";    }
   if(bearPin)    { bearish = true; return "BEAR PIN";    }
   return "NONE";
  }

//+------------------------------------------------------------------+
//| Get single indicator buffer value                                |
//+------------------------------------------------------------------+
double GetInd(int handle, int buffer, int shift)
  {
   double buf[];
   ArraySetAsSeries(buf, true);
   if(CopyBuffer(handle, buffer, shift, 1, buf) < 1)
      return 0.0;
   return buf[0];
  }

//+------------------------------------------------------------------+
//| Open a trade with ATR SL/TP clamped to stops level               |
//+------------------------------------------------------------------+
void OpenTrade(bool isBuy)
  {
   double atr = GetInd(hATR, 0, 1);
   if(atr <= 0) return;

   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (double)stopsLevel * point;

   double slDist = MathMax(atr * ATR_SL_Mult, minDist);
   double tpDist = MathMax(atr * ATR_TP_Mult, minDist);

   double lot = NormalizeLot(eff_LotSize);
   double sl, tp;

   if(isBuy)
     {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      sl = NormalizeDouble(ask - slDist, digits);
      tp = NormalizeDouble(ask + tpDist, digits);
      if(trade.Buy(lot, _Symbol, ask, sl, tp, "GSXv8"))
        {
         g_totalTrades++;
         g_lastEntryTime = TimeCurrent();
        }
     }
   else
     {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      sl = NormalizeDouble(bid + slDist, digits);
      tp = NormalizeDouble(bid - tpDist, digits);
      if(trade.Sell(lot, _Symbol, bid, sl, tp, "GSXv8"))
        {
         g_totalTrades++;
         g_lastEntryTime = TimeCurrent();
        }
     }
  }

//+------------------------------------------------------------------+
//| Manage open positions: smart close + ATR trailing (every tick)   |
//+------------------------------------------------------------------+
void ManagePositions()
  {
   double rsi   = GetInd(hRSI, 0, 0);
   double ema8  = GetInd(hEMA8, 0, 0);
   double ema21 = GetInd(hEMA21, 0, 0);
   double atr   = GetInd(hATR, 0, 0);

   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (double)stopsLevel * point;
   double trailDist = MathMax(atr * 1.0, minDist);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         PositionGetInteger(POSITION_MAGIC) != g_magic)
         continue;

      long   type   = PositionGetInteger(POSITION_TYPE);
      double openPr = PositionGetDouble(POSITION_PRICE_OPEN);
      double curSL  = PositionGetDouble(POSITION_SL);
      double curTP  = PositionGetDouble(POSITION_TP);
      double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

      if(type == POSITION_TYPE_BUY)
        {
         // Smart close: RSI extreme or EMA cross against position
         if(rsi > 78.0 || ema8 < ema21)
           {
            trade.PositionClose(ticket);
            continue;
           }
         // ATR trailing stop: only move in profit direction
         if(bid > openPr && atr > 0)
           {
            double newSL = NormalizeDouble(bid - trailDist, digits);
            if(newSL > curSL && newSL <= bid - minDist)
               trade.PositionModify(ticket, newSL, curTP);
           }
        }
      else if(type == POSITION_TYPE_SELL)
        {
         if(rsi < 22.0 || ema8 > ema21)
           {
            trade.PositionClose(ticket);
            continue;
           }
         if(ask < openPr && atr > 0)
           {
            double newSL = NormalizeDouble(ask + trailDist, digits);
            if((curSL == 0 || newSL < curSL) && newSL >= ask + minDist)
               trade.PositionModify(ticket, newSL, curTP);
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Check entry on new bar (bar-close based)                         |
//+------------------------------------------------------------------+
void CheckEntry()
  {
   bool bullPat = false, bearPat = false;
   g_lastPattern = DetectPattern(bullPat, bearPat);

   double ema8  = GetInd(hEMA8, 0, 1);
   double ema21 = GetInd(hEMA21, 0, 1);
   double rsi   = GetInd(hRSI, 0, 1);
   double adx   = GetInd(hADX, 0, 1);   // buffer 0 = main ADX line

   g_lastSignal = "NONE";

   if(adx <= ADX_MinLevel)
      return;

   bool buySignal  = bullPat && ema8 > ema21 && rsi >= 40.0 && rsi <= 70.0;
   bool sellSignal = bearPat && ema8 < ema21 && rsi >= 30.0 && rsi <= 60.0;

   if(!buySignal && !sellSignal)
      return;

   g_lastSignal = buySignal ? "BUY" : "SELL";

   // Filters
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > eff_MaxSpread)                              return;
   if(CountPositions() >= eff_MaxPositions)                return;
   if(TimeCurrent() - g_lastEntryTime < eff_CooldownSecs)  return;

   OpenTrade(buySignal);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   LoadSettings();
   ManagePositions();

   // New-bar detection
   static datetime lastBar = 0;
   datetime curBar = iTime(_Symbol, TF, 0);
   if(curBar != lastBar)
     {
      lastBar = curBar;
      CheckEntry();
     }

   UpdateDashboard();
  }

//+------------------------------------------------------------------+
//| Dashboard                                                        |
//+------------------------------------------------------------------+
void CreateDashLabel(const string name, int x, int y, const string text,
                     color clr, int fontSize)
  {
   string obj = DASH_PREFIX + name;
   if(ObjectFind(0, obj) < 0)
     {
      ObjectCreate(0, obj, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, obj, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, obj, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, obj, OBJPROP_YDISTANCE, y);
      ObjectSetString(0, obj, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, obj, OBJPROP_FONTSIZE, fontSize);
      ObjectSetInteger(0, obj, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, obj, OBJPROP_HIDDEN, true);
     }
   ObjectSetString(0, obj, OBJPROP_TEXT, text);
   ObjectSetInteger(0, obj, OBJPROP_COLOR, clr);
  }

void CreateDashboard()
  {
   string bg = DASH_PREFIX + "BG";
   if(ObjectFind(0, bg) < 0)
     {
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, bg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, 5);
      ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, 15);
      ObjectSetInteger(0, bg, OBJPROP_XSIZE, 250);
      ObjectSetInteger(0, bg, OBJPROP_YSIZE, 235);
      ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, C'15,15,25');
      ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, bg, OBJPROP_COLOR, clrDimGray);
      ObjectSetInteger(0, bg, OBJPROP_BACK, false);
      ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);
     }
   UpdateDashboard();
  }

void UpdateDashboard()
  {
   double ema8  = GetInd(hEMA8, 0, 0);
   double ema21 = GetInd(hEMA21, 0, 0);
   double rsi   = GetInd(hRSI, 0, 0);
   double adx   = GetInd(hADX, 0, 0);

   string trend = "FLAT";
   color  trendClr = clrSilver;
   if(ema8 > ema21) { trend = "UP";   trendClr = clrLime; }
   if(ema8 < ema21) { trend = "DOWN"; trendClr = clrOrangeRed; }

   int secsLeft = eff_CooldownSecs - (int)(TimeCurrent() - g_lastEntryTime);
   string entryStatus = (secsLeft > 0) ? StringFormat("COOLDOWN %ds", secsLeft) : "READY";
   color  entryClr    = (secsLeft > 0) ? clrOrange : clrLime;

   double pl = FloatingPL();
   color plClr = (pl >= 0) ? clrLime : clrOrangeRed;

   color sigClr = clrSilver;
   if(g_lastSignal == "BUY")  sigClr = clrLime;
   if(g_lastSignal == "SELL") sigClr = clrOrangeRed;

   int x = 15, y = 22, dy = 18;
   CreateDashLabel("L01", x, y,           "GoldScalperX v8 [" + _Symbol + "]",              clrGold,   10);
   CreateDashLabel("L02", x, y + dy,      "Magic:    " + (string)g_magic,                   clrSilver,  9);
   CreateDashLabel("L03", x, y + dy * 2,  "Trend:    " + trend,                             trendClr,   9);
   CreateDashLabel("L04", x, y + dy * 3,  StringFormat("RSI: %.1f  ADX: %.1f", rsi, adx),   clrSilver,  9);
   CreateDashLabel("L05", x, y + dy * 4,  "Pattern:  " + g_lastPattern,                     clrAqua,    9);
   CreateDashLabel("L06", x, y + dy * 5,  "Signal:   " + g_lastSignal,                      sigClr,     9);
   CreateDashLabel("L07", x, y + dy * 6,  "Entry:    " + entryStatus,                       entryClr,   9);
   CreateDashLabel("L08", x, y + dy * 7,  "Settings: " + (g_fromDashboard ? "Dashboard" : "Local"), clrSilver, 9);
   CreateDashLabel("L09", x, y + dy * 8,  StringFormat("Positions: %d / %d", CountPositions(), eff_MaxPositions), clrSilver, 9);
   CreateDashLabel("L10", x, y + dy * 9,  StringFormat("Float P&L: %.2f", pl),              plClr,      9);
   CreateDashLabel("L11", x, y + dy * 10, "Trades:   " + (string)g_totalTrades,             clrSilver,  9);
   CreateDashLabel("L12", x, y + dy * 11, "Spread:   " + (string)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), clrSilver, 9);

   ChartRedraw();
  }
//+------------------------------------------------------------------+
